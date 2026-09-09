// CATÁLOGO DECLARADO das falhas dos agentes que NÃO podem passar caladas — módulo PURO.
//
// ⚠️ **Por que existe** (pedido do Luis, 09/09/2026: *"devemos ter agentic logging para sabermos se
// os agentes vao falhar nesses tipos de falha e outras importantes ou nao. Pois nao podemos sofrer
// falha silenciosa"*). O caso que motivou é medido e caro: o harness do retroativo lia a chave de
// embeddings ERRADA (`LLM_FALLBACK`, revogada) em vez da `LLM_EMBEDDINGS_KEY` do app, tomou **401
// em série**, gerou **0 vetores** e o time julgou 12 projetos **sem um único vizinho** — e o
// relatório saiu COMPLETO, com as notas achatadas em 0, acusando "achatamento suspeito" como se o
// defeito fosse a régua. Nada no caminho gritou: `gerarEmbeddingsLote` faz `console.error` e
// devolve `null`, que em prod é um log que ninguém lê.
//
// A régua deste arquivo: **degradação silenciosa é falha**. Um agente que responde com menos
// material do que deveria não erra visivelmente — ele erra com aparência de resultado, e é isso
// que envenena a calibragem.
//
// ⚠️ **Catálogo FECHADO de propósito.** Classe nova é DECISÃO: entra aqui, com o `sintoma` (o que
// se veria se ela passasse calada) escrito, senão o próximo diagnóstico recomeça do zero. É a
// mesma disciplina de `PISTAS_PROJECAO` e `CARGOS_LIDERANCA`.

/** As classes de falha reconhecidas. Ampliar é decisão — ver o aviso no topo. */
export type ClasseFalha =
  | 'embedding_indisponivel'
  | 'rag_sem_vizinho'
  | 'indice_indisponivel'
  | 'formato_invalido'
  | 'teto_ferramentas'
  | 'dossie_sem_financeiro'
  | 'sem_nota_avaliada'
  | 'tarefa_cancelada';

export type Severidade = 'alerta' | 'registro';

export type DescricaoFalha = {
  classe: ClasseFalha;
  /** Frase curta que vira o título do alerta. */
  rotulo: string;
  /**
   * `'alerta'` manda mensagem no Chat do watchdog (com cooldown); `'registro'` só grava.
   * A régua: alerta quando a falha MUDA O RESULTADO de um julgamento sem dizer que mudou.
   */
  severidade: Severidade;
  /** O que se veria se ela passasse calada. É o campo que evita rediagnosticar do zero. */
  sintoma: string;
};

/**
 * ⚠️ FONTE ÚNICA. A ordem é a de gravidade percebida, não é lida por ninguém.
 */
export const FALHAS_AGENTE: readonly DescricaoFalha[] = [
  {
    classe: 'embedding_indisponivel',
    rotulo: 'Embeddings indisponíveis — a memória vetorial dos agentes está fora',
    severidade: 'alerta',
    sintoma:
      'Sem vetor não há vizinho, e sem vizinho as notas ACHATAM (medido: 12 de 12 projetos em 0★, ' +
      'viés −1,43). O agente continua respondendo e o relatório continua saindo, então o sintoma ' +
      'aparece como "a régua está errada", não como "a integração caiu".',
  },
  {
    classe: 'rag_sem_vizinho',
    rotulo: 'Agente julgou SEM nenhum vizinho de referência',
    severidade: 'alerta',
    sintoma:
      'A nota sai sem precedente contra o que se comparar. Já medido nesta base: sem vizinho a ' +
      'média cai para ~3,6★, com vizinho ~4,9★ — a MESMA régua e o mesmo projeto.',
  },
  {
    classe: 'indice_indisponivel',
    rotulo: 'Índice vetorial (Pinecone) fora — caiu no cosseno em JS',
    severidade: 'registro',
    sintoma:
      'O fallback funciona e a resposta sai correta, então nada quebra na cara de ninguém. Mas o ' +
      'filtro `tem_nota_humana` é do SERVIDOR do índice: no fallback o anti-feedback-loop fica ' +
      'mais fraco. Só registra — degradação prevista e coberta.',
  },
  {
    classe: 'formato_invalido',
    rotulo: 'Resposta do agente não pôde ser lida (formato inválido após as tentativas)',
    severidade: 'alerta',
    sintoma:
      'O projeto fica sem nota/veredito e o lote segue adiante. Perder é a decisão certa (inventar ' +
      'nota é pior), mas perder CALADO faz a base encolher sem ninguém notar.',
  },
  {
    classe: 'teto_ferramentas',
    rotulo: 'Agente estourou o teto de chamadas de ferramenta sem concluir',
    severidade: 'registro',
    sintoma:
      'O agente conclui com o que juntou até ali — um parecer mais pobre, com a mesma aparência de ' +
      'um parecer completo.',
  },
  {
    classe: 'dossie_sem_financeiro',
    rotulo: 'Dossiê chegou ao agente SEM o financeiro do projeto',
    severidade: 'alerta',
    sintoma:
      'Foi o bug de 08/09/2026: a mesa lia o dinheiro em vocabulário da v1 e recebia tudo `null`, ' +
      'o financeiro respondia "sem dados" e o piso de impacto NUNCA disparava — 41,4% de erro ' +
      'grave no retroativo, com o agente aprovando o que a triagem reprovou.',
  },
  {
    classe: 'sem_nota_avaliada',
    rotulo: 'Projeto de impacto baixo chegou à régua SEM nota avaliada',
    severidade: 'registro',
    sintoma:
      'A régua composta poupa o projeto (é o certo — reprovar exige veredito de nota em mãos), mas ' +
      '"não reprovou" e "ninguém avaliou" ficariam indistinguíveis. É exatamente esta fila que o ' +
      'time de agentes precisa alcançar: 463 das 750 linhas de prod têm 0★ default na coluna manual.',
  },
  {
    classe: 'tarefa_cancelada',
    rotulo: 'Trabalho em background cancelado antes de terminar',
    severidade: 'alerta',
    sintoma:
      'O `waitUntil` do Godeploy corta a tarefa depois da resposta: o botão prometeu a estrela, a ' +
      'requisição voltou 202 e a estrela nunca chegou (medido: 2 de 4 chamadas respondidas de ~30).',
  },
] as const;

const PORCLASSE = new Map<ClasseFalha, DescricaoFalha>(FALHAS_AGENTE.map((f) => [f.classe, f]));

export function descreverFalha(classe: ClasseFalha): DescricaoFalha | null {
  return PORCLASSE.get(classe) ?? null;
}

/** PURA. `true` só para as classes que mudam o resultado sem avisar. */
export function deveAlertar(classe: ClasseFalha): boolean {
  return PORCLASSE.get(classe)?.severidade === 'alerta';
}

/**
 * A chave de COOLDOWN do alerta. PURA.
 *
 * ⚠️ **Por CLASSE, nunca por projeto.** Um backfill de 750 projetos com a chave de embeddings
 * fora mandaria 750 mensagens no Chat — e a informação é a mesma em todas. Quem conta as
 * repetições é o `alertarErroIntegracao` (ele diz "Nª ocorrência desde o último aviso").
 */
export function chaveCooldown(classe: ClasseFalha): string {
  return `agente:${classe}`;
}

/** O corpo do alerta: rótulo + onde + o sintoma que ele evita rediagnosticar. PURA. */
export function textoAlertaFalha(
  classe: ClasseFalha,
  ctx: { onde?: string | null; projetoId?: string | null; detalhe?: string | null },
): { titulo: string; detalhe: string } {
  const d = PORCLASSE.get(classe);
  const titulo = d?.rotulo ?? `Falha não catalogada: ${classe}`;
  const linhas: string[] = [];
  if (ctx.onde) linhas.push(`Onde: ${ctx.onde}`);
  if (ctx.projetoId) linhas.push(`Projeto: ${ctx.projetoId}`);
  if (ctx.detalhe) linhas.push(`Detalhe: ${String(ctx.detalhe).slice(0, 500)}`);
  if (d?.sintoma) linhas.push(`Se passar calado: ${d.sintoma}`);
  return { titulo, detalhe: linhas.join('\n') };
}

// ─── O RELATOR (hook instalável) ──────────────────────────────────────────────
//
// ⚠️ **Por que hook e não import direto.** Quem detecta a falha são módulos BAIXOS
// (`embeddings.ts`, `pinecone.ts`), e fazê-los importar o gravador arrastaria o SQLite e o cliente
// de Chat para dentro de qualquer consumidor de embedding — inclusive os scripts de rodada, que
// não têm banco. O molde é o `setDemoBackend` do `api-client.ts`: o caminho fica IDÊNTICO quando
// não há relator instalado (só o `console.error`), e quem instala é o worker, uma vez.

export type ContextoFalha = {
  classe: ClasseFalha;
  /** Módulo/função onde a falha foi detectada, para o alerta ser acionável. */
  onde: string;
  projetoId?: string | null;
  detalhe?: string | null;
  cicloId?: string | null;
};

export type RelatorDeFalhas = (ctx: ContextoFalha) => void;

let relator: RelatorDeFalhas | null = null;

/** Instala (ou remove, com `null`) o relator. Idempotente. */
export function definirRelatorDeFalhas(r: RelatorDeFalhas | null): void {
  relator = r;
}

/** Só para teste. */
export function __relatorInstalado(): boolean {
  return relator != null;
}

/**
 * Reporta uma falha de agente. **NUNCA lança** — reportar é acessório e não pode derrubar o
 * julgamento que já aconteceu (a mesma disciplina de `registrarNoAgente` e `registrarAtividade`).
 *
 * ⚠️ O `console.error` sai SEMPRE, com prefixo estável (`[falha-agente]`), mesmo sem relator: é o
 * que torna a falha visível nos logs do Godeploy e grepável.
 */
export function reportarFalhaDeAgente(ctx: ContextoFalha): void {
  try {
    const alvo = [ctx.onde, ctx.projetoId ? `projeto=${ctx.projetoId}` : null, ctx.detalhe]
      .filter(Boolean)
      .join(' · ');
    console.error(`[falha-agente] ${ctx.classe} · ${alvo}`);
    relator?.(ctx);
  } catch (e) {
    console.error('[falha-agente] o próprio relator falhou (ignorado):', e);
  }
}
