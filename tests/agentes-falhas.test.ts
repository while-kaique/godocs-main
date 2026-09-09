/**
 * AGENTIC LOGGING — as falhas dos agentes que não podem passar caladas.
 *
 * Pedido do Luis (09/09/2026): *"devemos ter agentic logging para sabermos se os agentes vao falhar
 * nesses tipos de falha e outras importantes ou nao. Pois nao podemos sofrer falha silenciosa"*.
 *
 * O caso de origem é medido: o harness do retroativo lia a chave de embeddings ERRADA, tomou 401 em
 * série, gerou 0 vetores, e o time julgou 12 projetos SEM UM ÚNICO VIZINHO — com o relatório
 * saindo completo no fim, acusando "achatamento suspeito" como se o defeito fosse a régua.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FALHAS_AGENTE,
  chaveCooldown,
  definirRelatorDeFalhas,
  descreverFalha,
  deveAlertar,
  reportarFalhaDeAgente,
  textoAlertaFalha,
  type ClasseFalha,
  type ContextoFalha,
} from '@/lib/agentes-falhas';

describe('o catálogo é declarado e completo', () => {
  it('toda classe tem rótulo e SINTOMA escritos', () => {
    // O `sintoma` é o campo que evita rediagnosticar do zero: ele diz o que se veria se a falha
    // passasse calada. Classe sem sintoma é classe que não ensina nada em plantão.
    for (const f of FALHAS_AGENTE) {
      expect(f.rotulo.length, f.classe).toBeGreaterThan(15);
      expect(f.sintoma.length, f.classe).toBeGreaterThan(40);
      expect(['alerta', 'registro']).toContain(f.severidade);
    }
  });

  it('não há classe duplicada', () => {
    const vistos = FALHAS_AGENTE.map((f) => f.classe);
    expect(new Set(vistos).size).toBe(vistos.length);
  });

  it('`deveAlertar` segue a severidade declarada, e classe desconhecida NÃO alerta', () => {
    for (const f of FALHAS_AGENTE) {
      expect(deveAlertar(f.classe)).toBe(f.severidade === 'alerta');
    }
    expect(deveAlertar('inventada' as ClasseFalha)).toBe(false);
    expect(descreverFalha('inventada' as ClasseFalha)).toBeNull();
  });

  it('as 3 falhas que MUDAM a nota sem avisar são de ALERTA', () => {
    // Régua do arquivo: alerta quando a falha muda o resultado de um julgamento sem dizer que
    // mudou. Estas três já custaram medição errada nesta base.
    expect(deveAlertar('embedding_indisponivel')).toBe(true);
    expect(deveAlertar('rag_sem_vizinho')).toBe(true);
    expect(deveAlertar('dossie_sem_financeiro')).toBe(true);
  });

  it('o fallback do índice só REGISTRA — é degradação prevista e coberta', () => {
    expect(deveAlertar('indice_indisponivel')).toBe(false);
  });
});

describe('cooldown por CLASSE, nunca por projeto', () => {
  it('a chave ignora o projeto', () => {
    // ⚠️ Um backfill de 750 projetos com a chave de embeddings fora mandaria 750 mensagens no
    // Chat, todas dizendo a mesma coisa. Quem conta as repetições é o `alertarErroIntegracao`.
    expect(chaveCooldown('rag_sem_vizinho')).toBe('agente:rag_sem_vizinho');
    expect(chaveCooldown('rag_sem_vizinho')).not.toContain('legado');
  });
});

describe('o texto do alerta é acionável', () => {
  it('leva onde, projeto, detalhe e o sintoma', () => {
    const { titulo, detalhe } = textoAlertaFalha('embedding_indisponivel', {
      onde: 'embeddings.gerarEmbeddingsLote',
      projetoId: 'legado-075',
      detalhe: 'HTTP 401',
    });
    expect(titulo).toMatch(/Embeddings indispon/);
    expect(detalhe).toContain('embeddings.gerarEmbeddingsLote');
    expect(detalhe).toContain('legado-075');
    expect(detalhe).toContain('HTTP 401');
    expect(detalhe).toMatch(/Se passar calado:/);
  });

  it('classe não catalogada não vira mensagem vazia', () => {
    const { titulo } = textoAlertaFalha('nova' as ClasseFalha, {});
    expect(titulo).toMatch(/não catalogada/);
  });
});

describe('o relator é um HOOK, e o caminho sem ele é idêntico', () => {
  let erros: unknown[][] = [];
  beforeEach(() => {
    erros = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void erros.push(a));
  });
  afterEach(() => {
    definirRelatorDeFalhas(null);
    vi.restoreAllMocks();
  });

  it('sem relator instalado NÃO lança e ainda deixa rastro grepável no log', () => {
    // É o que torna a falha visível no Godeploy mesmo antes de existir tabela — e é o caminho dos
    // scripts de rodada, que não têm banco.
    expect(() =>
      reportarFalhaDeAgente({ classe: 'rag_sem_vizinho', onde: 'teste' }),
    ).not.toThrow();
    expect(erros.length).toBe(1);
    expect(String(erros[0][0])).toContain('[falha-agente] rag_sem_vizinho');
  });

  it('com relator instalado, ele recebe o contexto inteiro', () => {
    const vistos: ContextoFalha[] = [];
    definirRelatorDeFalhas((c) => vistos.push(c));
    reportarFalhaDeAgente({
      classe: 'dossie_sem_financeiro',
      onde: 'avaliacao-normais.computarVotos',
      projetoId: 'abc',
      detalhe: 'nada chegou',
    });
    expect(vistos).toHaveLength(1);
    expect(vistos[0]).toMatchObject({
      classe: 'dossie_sem_financeiro',
      onde: 'avaliacao-normais.computarVotos',
      projetoId: 'abc',
    });
  });

  it('relator que EXPLODE não derruba quem reportou', () => {
    // Reportar é acessório: não pode derrubar o julgamento que já aconteceu (mesma disciplina de
    // `registrarNoAgente` e `registrarAtividade`).
    definirRelatorDeFalhas(() => {
      throw new Error('banco fora');
    });
    expect(() => reportarFalhaDeAgente({ classe: 'formato_invalido', onde: 'x' })).not.toThrow();
  });
});

describe('canários de fiação — onde o silêncio acontecia', () => {
  const ler = (p: string) => readFileSync(p, 'utf8');

  it('os 3 caminhos de falha do `embeddings.ts` REPORTAM, não só logam', () => {
    // Antes: `console.warn`/`console.error` + `return null`. Em prod isso é um log que ninguém lê,
    // e a consequência (nota achatada) aparece como defeito de régua.
    const src = ler('src/lib/embeddings.ts');
    expect(src).toContain("reportarFalhaDeAgente");
    expect((src.match(/reportarFalhaDeAgente\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("classe: 'embedding_indisponivel'");
  });

  it('`embeddings.ts` NÃO importa o gravador (nem SQLite, nem Chat)', () => {
    // É o que permite os scripts de rodada — que não têm banco — usarem embedding sem arrastar
    // o mundo. O hook é o molde do `setDemoBackend` do `api-client.ts`.
    const src = ler('src/lib/embeddings.ts');
    expect(src).toContain("from '@/lib/agentes-falhas'");
    expect(src).not.toContain('agentes-falhas.functions');
    expect(src).not.toContain('client.server');
  });

  it('a queda do Pinecone e o zero-vizinho são reportados no classificador', () => {
    const src = ler('src/lib/especial-classificador.functions.ts');
    expect(src).toContain("classe: 'indice_indisponivel'");
    expect(src).toContain("classe: 'rag_sem_vizinho'");
    expect(src).toContain("classe: 'formato_invalido'");
  });

  it('a mesa reporta dossiê SEM financeiro — o bug de 08/09 não volta calado', () => {
    const src = ler('src/lib/avaliacao-normais.functions.ts');
    expect(src).toContain("classe: 'dossie_sem_financeiro'");
    // A checagem exige a linha do espelho existir: sem linha o problema é outro (id que não casa).
    expect(src).toMatch(/linhaEspelho &&\s*\n\s*projeto\.especial !== 1/);
  });

  it('o worker instala o relator DEPOIS de registrar o `waitUntil`', () => {
    // A gravação vai em `runBackground`; sem o waitUntil registrado ela seria cancelada — e a
    // falha que avisa sobre falhas silenciosas não pode ser a próxima falha silenciosa.
    const src = ler('src/worker.ts');
    const iWait = src.indexOf('g.__waitUntil = ');
    const iRelator = src.indexOf('garantirRelatorDeFalhas();');
    expect(iWait).toBeGreaterThan(0);
    expect(iRelator).toBeGreaterThan(iWait);
  });

  it('o alerta prefere o WATCHDOG e NUNCA cai no webhook default de projetos', () => {
    const src = ler('src/lib/alertas.functions.ts');
    expect(src).toContain('GOOGLE_CHAT_WEBHOOK_URL_WATCHDOG');
    // O fallback é o canal de Ajuda; sem nenhum dos dois, PULA (erro de sistema no grupo das
    // submissões foi bug real deste repo).
    expect(src).toContain('GOOGLE_CHAT_WEBHOOK_URL_AJUDA');
    expect(src).toMatch(/if \(!webhookUrl\) return;/);
  });

  it('a rota de saúde existe e é de ADMIN', () => {
    const src = ler('src/worker.ts');
    const i = src.indexOf('/api/admin/agentes-saude');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 220)).toContain('requireAdmin');
  });
});

// ─── Ponta a ponta contra o banco REAL (better-sqlite3 em memória, mesmo `initSchema`) ─────────
//
// Prova o caminho inteiro: detector → linha durável → painel de saúde. Sem isto, o único sinal de
// que a gravação funciona seria um console.error — que é exatamente o que este arquivo combate.
describe('o caminho da gravação existe de verdade', () => {
  it('registra, agrega por classe e devolve exemplos', async () => {
    const { criarDbMemoria } = await import('./helpers/db-memoria');
    await criarDbMemoria();
    const { registrarFalhaDeAgente, saudeDosAgentes } = await import(
      '@/lib/agentes-falhas.functions'
    );

    await registrarFalhaDeAgente({
      classe: 'embedding_indisponivel',
      onde: 'embeddings.gerarEmbeddingsLote',
      detalhe: 'HTTP 401',
    });
    await registrarFalhaDeAgente({
      classe: 'embedding_indisponivel',
      onde: 'embeddings.gerarEmbeddingsLote',
      detalhe: 'HTTP 401',
    });
    await registrarFalhaDeAgente({
      classe: 'indice_indisponivel',
      onde: 'especial-classificador.recuperarVizinhos',
      projetoId: 'legado-075',
    });

    const s = await saudeDosAgentes({ horas: 24 });
    expect(s.ok).toBe(true);
    expect(s.total).toBe(3);
    const emb = s.por_classe.find((l) => l.classe === 'embedding_indisponivel');
    expect(emb?.total).toBe(2);
    expect(emb?.alerta).toBe(true);
    expect(emb?.sintoma).toMatch(/ACHATAM|vizinho/);
    const idx = s.por_classe.find((l) => l.classe === 'indice_indisponivel');
    expect(idx?.alerta).toBe(false); // degradação prevista → só registra
    expect(s.exemplos.length).toBe(3);
    expect(s.exemplos.some((e) => e.projeto_id === 'legado-075')).toBe(true);
  });

  it('a classe de ALERTA marca `alertou`, a de registro não', async () => {
    const { criarDbMemoria } = await import('./helpers/db-memoria');
    await criarDbMemoria();
    const { registrarFalhaDeAgente, saudeDosAgentes } = await import(
      '@/lib/agentes-falhas.functions'
    );
    await registrarFalhaDeAgente({ classe: 'rag_sem_vizinho', onde: 'x' });
    await registrarFalhaDeAgente({ classe: 'teto_ferramentas', onde: 'y' });
    const s = await saudeDosAgentes({ horas: 24 });
    const porClasse = new Map(s.exemplos.map((e) => [e.classe, e.alertou]));
    expect(porClasse.get('rag_sem_vizinho')).toBe(1);
    expect(porClasse.get('teto_ferramentas')).toBe(0);
  });
});
