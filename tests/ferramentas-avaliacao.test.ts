// T12 — Ferramentas dos agentes de avaliação (plano `regua-estrelas-e-time-unificado.md`,
// §11.2 "Ferramentas dos agentes" e §11.3 "T12 — Ferramentas"). Lado PURO:
// `src/lib/avaliacao/ferramentas.ts`.
//
// O que este arquivo PRENDE:
//  (a) o CATÁLOGO das 7 ferramentas (nomes únicos, descrição, parâmetros) e o bloco de prompt
//      `descreverFerramentas`, que lista só as PERMITIDAS e as duas formas do protocolo
//      (`"acao":"tool"` para pedir ferramenta · `"acao":"concluir"` para terminar);
//  (b) `interpretarResposta` — o parser tolerante da resposta do LLM (JSON puro, JSON envolto
//      em markdown/prosa, `args` ausente vira `{}`), que REJEITA nome fora do catálogo/fora das
//      permitidas, ação desconhecida e texto sem JSON;
//  (c) `loopComFerramentas` — o loop agentic com TETO de chamadas (`MAX_CHAMADAS_TOOL`),
//      encerramento explícito ("conclua"), tolerância a ferramenta que lança (o erro vira
//      `tool_result` e o loop segue), correção de UMA resposta inválida (2 consecutivas encerram)
//      e LLM que rejeita → `erro_llm` sem NUNCA lançar;
//  (d) as ferramentas PURAS: teto CLT de 220 h/pessoa + gate de economia alta (≥44 h SÓ no
//      mensal), o ganho total com receita ÷10 (regra de negócio do repo) e a busca de duplicata
//      por nome normalizado (D8: só conta se o candidato tem ganho MEDIDO).
//
// Por quê: sem teto o loop vira gasto infinito de LLM; sem tolerância a erro uma ferramenta
// fora do ar derruba a avaliação inteira; e as ferramentas puras repetem réguas que o repo já
// tem (220 h, 44 h, ÷10) — divergir delas seria dar ao agente um número diferente do da planilha.
import { describe, it, expect, vi } from 'vitest';
import {
  CATALOGO_FERRAMENTAS,
  MAX_CHAMADAS_TOOL,
  descreverFerramentas,
  interpretarResposta,
  loopComFerramentas,
  checarPlausibilidadeHoras,
  calcularImpactoBasico,
  buscarDuplicataNaLista,
  type NomeFerramenta,
  type Mensagem,
} from '@/lib/avaliacao/ferramentas';

const NOMES_ESPERADOS: NomeFerramenta[] = [
  'consultar_vizinhos',
  'consultar_cargo',
  'historico_versoes',
  'buscar_duplicata',
  'checar_plausibilidade_horas',
  'calcular_impacto',
  'ler_evidencia',
];

const MENSAGENS_INICIAIS: Mensagem[] = [
  { role: 'system', content: 'Você é o avaliador.' },
  { role: 'user', content: 'Dossiê do projeto P1.' },
];

function pedido(nome: string, args?: Record<string, unknown>): string {
  return JSON.stringify(args === undefined ? { acao: 'tool', nome } : { acao: 'tool', nome, args });
}
function conclusao(resultado: unknown): string {
  return JSON.stringify({ acao: 'concluir', resultado });
}

/** LLM fake que devolve as respostas em sequência (a última repete se o loop pedir mais). */
function llmSequencial(respostas: string[]) {
  let i = 0;
  return vi.fn(async (_msgs: Mensagem[]) => {
    const r = respostas[Math.min(i, respostas.length - 1)];
    i++;
    return r;
  });
}

function mensagensUser(msgs: Mensagem[]): Mensagem[] {
  return msgs.filter((m) => m.role === 'user');
}

// =======================================================================================
// (a) Catálogo + descrição para o prompt
// =======================================================================================
describe('CATALOGO_FERRAMENTAS e descreverFerramentas', () => {
  it('tem exatamente as 7 ferramentas, com nomes únicos, descrição não vazia e parâmetros objeto', () => {
    expect(CATALOGO_FERRAMENTAS).toHaveLength(7);
    const nomes = CATALOGO_FERRAMENTAS.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(7);
    expect([...nomes].sort()).toEqual([...NOMES_ESPERADOS].sort());
    for (const f of CATALOGO_FERRAMENTAS) {
      expect(typeof f.descricao).toBe('string');
      expect(f.descricao.trim().length).toBeGreaterThan(0);
      expect(f.parametros).toBeTypeOf('object');
      expect(f.parametros).not.toBeNull();
      expect(Array.isArray(f.parametros)).toBe(false);
    }
  });

  it('MAX_CHAMADAS_TOOL default é 4', () => {
    expect(MAX_CHAMADAS_TOOL).toBe(4);
  });

  it('descreverFerramentas() cita as 7 e as duas formas do protocolo', () => {
    const texto = descreverFerramentas();
    for (const nome of NOMES_ESPERADOS) expect(texto).toContain(nome);
    expect(texto).toContain('"acao":"tool"');
    expect(texto).toContain('"acao":"concluir"');
  });

  it('descreverFerramentas(permitidas) lista só as permitidas', () => {
    const texto = descreverFerramentas(['consultar_cargo']);
    expect(texto).toContain('consultar_cargo');
    expect(texto).not.toContain('buscar_duplicata');
    // O protocolo continua descrito mesmo com 1 ferramenta só.
    expect(texto).toContain('"acao":"concluir"');
  });
});

// =======================================================================================
// (b) interpretarResposta
// =======================================================================================
describe('interpretarResposta', () => {
  it('JSON puro de pedido de ferramenta → PedidoTool com nome e args', () => {
    const r = interpretarResposta('{"acao":"tool","nome":"consultar_cargo","args":{"email":"a@x"}}');
    expect(r).toEqual({ acao: 'tool', nome: 'consultar_cargo', args: { email: 'a@x' } });
  });

  it('JSON envolto em bloco markdown ```json → ainda interpreta', () => {
    const raw = 'Vou consultar o cargo.\n```json\n{"acao":"tool","nome":"consultar_cargo","args":{"email":"b@x"}}\n```\nAguardando.';
    const r = interpretarResposta(raw);
    expect(r.acao).toBe('tool');
    if (r.acao === 'tool') {
      expect(r.nome).toBe('consultar_cargo');
      expect(r.args).toEqual({ email: 'b@x' });
    }
  });

  it('JSON com prosa antes e depois (sem cerca) → extrai o primeiro objeto balanceado', () => {
    const raw = 'Preciso da lista. {"acao":"tool","nome":"buscar_duplicata","args":{"nome":"Bot {X}"}} — obrigado.';
    const r = interpretarResposta(raw);
    expect(r.acao).toBe('tool');
    if (r.acao === 'tool') {
      expect(r.nome).toBe('buscar_duplicata');
      expect(r.args).toEqual({ nome: 'Bot {X}' });
    }
  });

  it('conclusão → Conclusao com o resultado intacto', () => {
    const r = interpretarResposta('{"acao":"concluir","resultado":{"nota":3}}');
    expect(r.acao).toBe('concluir');
    if (r.acao === 'concluir') {
      expect((r.resultado as { nota: number }).nota).toBe(3);
    }
  });

  it('nome fora do catálogo → invalida, com motivo citando o nome', () => {
    const r = interpretarResposta('{"acao":"tool","nome":"apagar_tudo","args":{}}');
    expect(r.acao).toBe('invalida');
    if (r.acao === 'invalida') expect(r.motivo).toContain('apagar_tudo');
  });

  it('nome do catálogo mas fora de `permitidas` → invalida', () => {
    const r = interpretarResposta(
      '{"acao":"tool","nome":"buscar_duplicata","args":{}}',
      ['consultar_cargo'],
    );
    expect(r.acao).toBe('invalida');
  });

  it('nome permitido com `permitidas` passado → PedidoTool normal', () => {
    const r = interpretarResposta('{"acao":"tool","nome":"consultar_cargo","args":{"email":"a@x"}}', [
      'consultar_cargo',
    ]);
    expect(r.acao).toBe('tool');
  });

  it('`args` ausente vira {} (não é inválido)', () => {
    const r = interpretarResposta('{"acao":"tool","nome":"historico_versoes"}');
    expect(r).toEqual({ acao: 'tool', nome: 'historico_versoes', args: {} });
  });

  it('texto sem JSON → invalida', () => {
    const r = interpretarResposta('Não sei o que fazer, me ajuda?');
    expect(r.acao).toBe('invalida');
    if (r.acao === 'invalida') expect(r.motivo.length).toBeGreaterThan(0);
  });

  it('ação desconhecida → invalida', () => {
    const r = interpretarResposta('{"acao":"outra"}');
    expect(r.acao).toBe('invalida');
  });
});

// =======================================================================================
// (c) loopComFerramentas
// =======================================================================================
describe('loopComFerramentas — caminho feliz', () => {
  it('2 ferramentas + conclusão na 3ª → resultado, 2 passos com retorno do executor, 3 chamadas', async () => {
    const chamarLlm = llmSequencial([
      pedido('consultar_cargo', { email: 'a@x' }),
      pedido('historico_versoes', { projeto_id: 'P1' }),
      conclusao({ nota: 4, parecer: 'ok' }),
    ]);
    const executar = vi.fn(async (nome: NomeFerramenta, args: Record<string, unknown>) => {
      if (nome === 'consultar_cargo') return { cargo: 'Analista', email: args.email };
      if (nome === 'historico_versoes') return { versoes: 2 };
      return null;
    });

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('concluiu');
    expect(r.resultado).toEqual({ nota: 4, parecer: 'ok' });
    expect(r.chamadas_llm).toBe(3);
    expect(chamarLlm).toHaveBeenCalledTimes(3);
    expect(executar).toHaveBeenCalledTimes(2);

    expect(r.passos).toHaveLength(2);
    expect(r.passos[0].nome).toBe('consultar_cargo');
    expect(r.passos[0].args).toEqual({ email: 'a@x' });
    expect(r.passos[0].retorno).toEqual({ cargo: 'Analista', email: 'a@x' });
    expect(r.passos[0].erro).toBeNull();
    expect(typeof r.passos[0].duracao_ms).toBe('number');
    expect(r.passos[0].duracao_ms).toBeGreaterThanOrEqual(0);
    expect(r.passos[1].nome).toBe('historico_versoes');
    expect(r.passos[1].retorno).toEqual({ versoes: 2 });
  });

  it('as mensagens finais têm, após cada pedido, o assistant cru e um user com JSON `tool_result`+`nome`', async () => {
    const raw1 = pedido('consultar_cargo', { email: 'a@x' });
    const raw2 = pedido('historico_versoes', { projeto_id: 'P1' });
    const chamarLlm = llmSequencial([raw1, raw2, conclusao({ nota: 1 })]);
    const executar = vi.fn(async (nome: NomeFerramenta) =>
      nome === 'consultar_cargo' ? { cargo: 'Analista' } : { versoes: 2 },
    );

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    // Prefixo intacto.
    expect(r.mensagens.slice(0, 2)).toEqual(MENSAGENS_INICIAIS);

    const idx1 = r.mensagens.findIndex((m) => m.role === 'assistant' && m.content === raw1);
    expect(idx1).toBeGreaterThan(1);
    const res1 = r.mensagens[idx1 + 1];
    expect(res1.role).toBe('user');
    const json1 = JSON.parse(res1.content);
    expect(json1).toHaveProperty('tool_result');
    expect(json1.nome).toBe('consultar_cargo');
    expect(json1.tool_result).toEqual({ cargo: 'Analista' });

    const idx2 = r.mensagens.findIndex((m) => m.role === 'assistant' && m.content === raw2);
    expect(idx2).toBeGreaterThan(idx1);
    const res2 = r.mensagens[idx2 + 1];
    expect(res2.role).toBe('user');
    const json2 = JSON.parse(res2.content);
    expect(json2.nome).toBe('historico_versoes');
    expect(json2.tool_result).toEqual({ versoes: 2 });

    // O LLM viu o histórico crescer: a 2ª chamada já continha o tool_result da 1ª.
    const msgsDaSegundaChamada = chamarLlm.mock.calls[1][0] as Mensagem[];
    expect(msgsDaSegundaChamada.some((m) => m.role === 'user' && m.content.includes('tool_result'))).toBe(true);
  });

  it('a chamada de `executar` recebe o nome e os args do pedido', async () => {
    const chamarLlm = llmSequencial([pedido('calcular_impacto', { saving_reais: 10 }), conclusao({ ok: true })]);
    const executar = vi.fn(async () => ({ ganho: 10 }));
    await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });
    expect(executar).toHaveBeenCalledWith('calcular_impacto', { saving_reais: 10 });
  });
});

describe('loopComFerramentas — teto de chamadas', () => {
  it('LLM que SEMPRE pede ferramenta com maxChamadas 2 → executa 2, manda encerramento, e fecha em `teto`', async () => {
    const chamarLlm = llmSequencial([pedido('consultar_cargo', { email: 'a@x' })]); // repete para sempre
    const executar = vi.fn(async () => ({ cargo: 'X' }));

    const r = await loopComFerramentas({
      chamarLlm,
      mensagensIniciais: MENSAGENS_INICIAIS,
      executar,
      maxChamadas: 2,
    });

    expect(executar).toHaveBeenCalledTimes(2);
    expect(r.passos).toHaveLength(2);
    expect(r.chamadas_llm).toBe(3); // 2 pedidos + 1 última chance
    expect(chamarLlm).toHaveBeenCalledTimes(3);
    expect(r.motivo_fim).toBe('teto');
    expect(r.resultado).toBeNull();

    // UMA mensagem user de encerramento, e ela foi entregue ao LLM na última chamada.
    const encerramento = mensagensUser(r.mensagens).filter((m) =>
      /conclua|sem mais ferramentas/i.test(m.content),
    );
    expect(encerramento).toHaveLength(1);
    const msgsUltimaChamada = chamarLlm.mock.calls[2][0] as Mensagem[];
    expect(msgsUltimaChamada.some((m) => m.role === 'user' && /conclua|sem mais ferramentas/i.test(m.content))).toBe(true);
  });

  it('atingido o teto, se o LLM conclui na última chance → `concluiu` com resultado', async () => {
    const chamarLlm = llmSequencial([
      pedido('consultar_cargo', { email: 'a@x' }),
      pedido('historico_versoes', { projeto_id: 'P1' }),
      conclusao({ nota: 2 }),
    ]);
    const executar = vi.fn(async () => ({}));

    const r = await loopComFerramentas({
      chamarLlm,
      mensagensIniciais: MENSAGENS_INICIAIS,
      executar,
      maxChamadas: 2,
    });

    expect(executar).toHaveBeenCalledTimes(2);
    expect(r.motivo_fim).toBe('concluiu');
    expect(r.resultado).toEqual({ nota: 2 });
    expect(r.chamadas_llm).toBe(3);
    expect(mensagensUser(r.mensagens).some((m) => /conclua|sem mais ferramentas/i.test(m.content))).toBe(true);
  });

  it('sem `maxChamadas`, o default é MAX_CHAMADAS_TOOL (4) execuções antes do encerramento', async () => {
    const chamarLlm = llmSequencial([pedido('consultar_cargo', { email: 'a@x' })]);
    const executar = vi.fn(async () => ({ cargo: 'X' }));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(executar).toHaveBeenCalledTimes(MAX_CHAMADAS_TOOL);
    expect(r.passos).toHaveLength(4);
    expect(r.chamadas_llm).toBe(5);
    expect(r.motivo_fim).toBe('teto');
    expect(r.resultado).toBeNull();
  });
});

describe('loopComFerramentas — ferramenta que lança', () => {
  it('erro do executor NÃO propaga: passo com `erro`, retorno null, LLM recebe tool_result {erro} e o loop segue', async () => {
    const chamarLlm = llmSequencial([
      pedido('consultar_vizinhos', { projeto_id: 'P1' }),
      conclusao({ nota: 0, parecer: 'sem vizinhos' }),
    ]);
    const executar = vi.fn(async () => {
      throw new Error('Pinecone fora do ar');
    });

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('concluiu');
    expect(r.resultado).toEqual({ nota: 0, parecer: 'sem vizinhos' });
    expect(r.passos).toHaveLength(1);
    expect(r.passos[0].retorno).toBeNull();
    expect(r.passos[0].erro).toBeTruthy();
    expect(r.passos[0].erro).toContain('Pinecone fora do ar');

    const resultadoAoLlm = mensagensUser(r.mensagens).find((m) => m.content.includes('tool_result'));
    expect(resultadoAoLlm).toBeDefined();
    const json = JSON.parse(resultadoAoLlm!.content);
    expect(json.tool_result).toHaveProperty('erro');
    expect(String(json.tool_result.erro)).toContain('Pinecone fora do ar');
  });
});

describe('loopComFerramentas — resposta inválida', () => {
  it('1ª inválida → mensagem user corretiva (cita JSON) e tenta de novo; válida em seguida segue normal', async () => {
    const chamarLlm = llmSequencial([
      'Hmm, deixa eu pensar…', // inválida
      pedido('consultar_cargo', { email: 'a@x' }),
      conclusao({ nota: 3 }),
    ]);
    const executar = vi.fn(async () => ({ cargo: 'Analista' }));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('concluiu');
    expect(r.resultado).toEqual({ nota: 3 });
    expect(r.passos).toHaveLength(1);
    expect(r.chamadas_llm).toBe(3);

    const corretiva = mensagensUser(r.mensagens).filter((m) => /JSON/.test(m.content) && !m.content.includes('tool_result'));
    expect(corretiva.length).toBeGreaterThanOrEqual(1);
    // A corretiva foi entregue ao LLM na 2ª chamada.
    const msgs2 = chamarLlm.mock.calls[1][0] as Mensagem[];
    expect(msgs2.some((m) => m.role === 'user' && /JSON/.test(m.content))).toBe(true);
  });

  it('2 inválidas consecutivas → `invalida`, resultado null, nada executado', async () => {
    const chamarLlm = llmSequencial(['prosa sem json', 'mais prosa sem json']);
    const executar = vi.fn(async () => ({}));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('invalida');
    expect(r.resultado).toBeNull();
    expect(r.passos).toHaveLength(0);
    expect(executar).not.toHaveBeenCalled();
    expect(r.chamadas_llm).toBe(2);
  });

  it('inválida, válida, inválida → não é "consecutiva": o loop corrige de novo e segue', async () => {
    const chamarLlm = llmSequencial([
      'prosa',
      pedido('consultar_cargo', { email: 'a@x' }),
      'prosa de novo',
      conclusao({ nota: 5 }),
    ]);
    const executar = vi.fn(async () => ({ cargo: 'X' }));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('concluiu');
    expect(r.resultado).toEqual({ nota: 5 });
    expect(r.chamadas_llm).toBe(4);
  });
});

describe('loopComFerramentas — LLM que rejeita e ferramenta não permitida', () => {
  it('`chamarLlm` rejeitando → `erro_llm`, resultado null, NUNCA lança', async () => {
    const chamarLlm = vi.fn(async () => {
      throw new Error('proxy 502');
    });
    const executar = vi.fn(async () => ({}));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('erro_llm');
    expect(r.resultado).toBeNull();
    expect(r.passos).toHaveLength(0);
    expect(executar).not.toHaveBeenCalled();
  });

  it('LLM rejeita no MEIO do loop (depois de uma ferramenta) → `erro_llm` preservando os passos já feitos', async () => {
    let n = 0;
    const chamarLlm = vi.fn(async () => {
      n++;
      if (n === 1) return pedido('consultar_cargo', { email: 'a@x' });
      throw new Error('timeout');
    });
    const executar = vi.fn(async () => ({ cargo: 'X' }));

    const r = await loopComFerramentas({ chamarLlm, mensagensIniciais: MENSAGENS_INICIAIS, executar });

    expect(r.motivo_fim).toBe('erro_llm');
    expect(r.resultado).toBeNull();
    expect(r.passos).toHaveLength(1);
  });

  it('`permitidas: [consultar_cargo]` e o LLM pede buscar_duplicata → tratado como inválida, NÃO executa', async () => {
    const chamarLlm = llmSequencial([
      pedido('buscar_duplicata', { nome: 'X' }),
      pedido('buscar_duplicata', { nome: 'X' }),
    ]);
    const executar = vi.fn(async () => ({}));

    const r = await loopComFerramentas({
      chamarLlm,
      mensagensIniciais: MENSAGENS_INICIAIS,
      executar,
      permitidas: ['consultar_cargo'],
    });

    expect(executar).not.toHaveBeenCalled();
    expect(r.passos).toHaveLength(0);
    expect(r.motivo_fim).toBe('invalida');
    expect(r.resultado).toBeNull();
  });
});

// =======================================================================================
// (d) Ferramentas PURAS
// =======================================================================================
describe('checarPlausibilidadeHoras', () => {
  it('Analista 250h acima do teto 220 + economia 280h mensal → alerta, economia alta, mensagem cita 220 e Analista', () => {
    const r = checarPlausibilidadeHoras({
      linhas: [
        { cargo: 'Analista', horas_antes: 250, horas_depois: 0 },
        { cargo: 'Supervisor', horas_antes: 40, horas_depois: 10 },
      ],
      tipo_saving: 'mensal',
    });
    expect(r.teto_por_pessoa).toBe(220);
    expect(r.total_antes).toBe(290);
    expect(r.total_depois).toBe(10);
    expect(r.economia).toBe(280);
    expect(r.linhas_acima_teto).toEqual([{ cargo: 'Analista', horas_antes: 250 }]);
    expect(r.economia_alta).toBe(true);
    expect(r.alerta).toBe(true);
    expect(r.mensagem).toContain('220');
    expect(r.mensagem).toContain('Analista');
  });

  it('linhas dentro do teto e economia 20h → sem alerta, sem economia alta', () => {
    const r = checarPlausibilidadeHoras({
      linhas: [{ cargo: 'Assistente', horas_antes: 30, horas_depois: 10 }],
      tipo_saving: 'mensal',
    });
    expect(r.economia).toBe(20);
    expect(r.linhas_acima_teto).toEqual([]);
    expect(r.economia_alta).toBe(false);
    expect(r.alerta).toBe(false);
  });

  it('economia ≥44h mensal SEM linha acima do teto → economia_alta true (o gate dos 44h é independente do teto)', () => {
    const r = checarPlausibilidadeHoras({
      linhas: [{ cargo: 'Analista', horas_antes: 100, horas_depois: 0 }],
      tipo_saving: 'mensal',
    });
    expect(r.linhas_acima_teto).toEqual([]);
    expect(r.economia_alta).toBe(true);
  });

  it('tipo_saving pontual → economia_alta false mesmo com 100h (gates mensais só valem no mensal)', () => {
    const r = checarPlausibilidadeHoras({
      linhas: [{ cargo: 'Analista', horas_antes: 100, horas_depois: 0 }],
      tipo_saving: 'pontual',
    });
    expect(r.economia).toBe(100);
    expect(r.economia_alta).toBe(false);
  });

  it('horas_antes null conta 0', () => {
    const r = checarPlausibilidadeHoras({
      linhas: [
        { cargo: 'A', horas_antes: null, horas_depois: null },
        { cargo: 'B', horas_antes: 10, horas_depois: 2 },
      ],
      tipo_saving: 'mensal',
    });
    expect(r.total_antes).toBe(10);
    expect(r.total_depois).toBe(2);
    expect(r.economia).toBe(8);
    expect(r.linhas_acima_teto).toEqual([]);
  });

  it('lista vazia → zeros e sem alerta', () => {
    const r = checarPlausibilidadeHoras({ linhas: [] });
    expect(r.total_antes).toBe(0);
    expect(r.total_depois).toBe(0);
    expect(r.economia).toBe(0);
    expect(r.linhas_acima_teto).toEqual([]);
    expect(r.economia_alta).toBe(false);
    expect(r.alerta).toBe(false);
    expect(typeof r.mensagem).toBe('string');
  });
});

describe('calcularImpactoBasico', () => {
  it('saving + custo evitado + receita÷10 − custo externo − custo do projeto = 1550', () => {
    const r = calcularImpactoBasico({
      saving_reais: 1000,
      custo_evitado_reais: 500,
      custo_externo_mensal: 100,
      custo_projeto_mensal: 50,
      receita_mensal: 2000,
    });
    expect(r.ganho_total_mensal).toBe(1550);
    expect(r.composicao).toEqual({
      saving: 1000,
      custo_evitado: 500,
      receita_ponderada: 200,
      custo_externo: 100,
      custo_projeto: 50,
    });
    expect(typeof r.formula).toBe('string');
    expect(r.formula.length).toBeGreaterThan(0);
    expect(/÷\s*10|\/\s*10/.test(r.formula)).toBe(true);
  });

  it('tudo null → 0 e composição zerada', () => {
    const r = calcularImpactoBasico({
      saving_reais: null,
      custo_evitado_reais: null,
      custo_externo_mensal: null,
      custo_projeto_mensal: null,
      receita_mensal: null,
    });
    expect(r.ganho_total_mensal).toBe(0);
    expect(r.composicao).toEqual({
      saving: 0,
      custo_evitado: 0,
      receita_ponderada: 0,
      custo_externo: 0,
      custo_projeto: 0,
    });
  });

  it('tudo ausente → 0 e composição zerada', () => {
    const r = calcularImpactoBasico({});
    expect(r.ganho_total_mensal).toBe(0);
    expect(r.composicao.receita_ponderada).toBe(0);
    expect(r.formula.length).toBeGreaterThan(0);
  });

  it('só receita → ganho = receita ÷ 10', () => {
    const r = calcularImpactoBasico({ receita_mensal: 5000 });
    expect(r.ganho_total_mensal).toBe(500);
    expect(r.composicao.receita_ponderada).toBe(500);
  });
});

describe('buscarDuplicataNaLista', () => {
  const alvo = { id: 'P9', nome: 'Bot de Faturamento V2' };

  it('candidato com o MESMO id nunca é duplicata (é o próprio projeto)', () => {
    const r = buscarDuplicataNaLista(alvo, [
      { id: 'P9', nome: 'Bot de Faturamento V2', saving_reais: 800, receita_mensal: null, status: 'Aprovado' },
    ]);
    expect(r).toEqual([]);
  });

  it('nome igual ignorando sufixo de versão, com ganho medido → duplicata com motivo citando o ganho', () => {
    const r = buscarDuplicataNaLista(alvo, [
      { id: 'L1', nome: 'Bot de Faturamento', saving_reais: 800, receita_mensal: null, status: 'Aprovado' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('L1');
    expect(r[0].nome).toBe('Bot de Faturamento');
    expect(r[0].motivo).toMatch(/800/);
  });

  it('normalização ignora acento, caixa, espaços extras e sufixos v2 / V2 / 2.0', () => {
    const candidatos = [
      { id: 'A', nome: '  bot   de  faturamento v2 ', saving_reais: 100, receita_mensal: null, status: 'Aprovado' },
      { id: 'B', nome: 'BOT DE FATURAMENTO 2.0', saving_reais: null, receita_mensal: 300, status: 'Pendente' },
      { id: 'C', nome: 'Bót de Faturaménto', saving_reais: 50, receita_mensal: null, status: null },
    ];
    const r = buscarDuplicataNaLista(alvo, candidatos);
    expect(r.map((d) => d.id).sort()).toEqual(['A', 'B', 'C']);
  });

  it('nome igual mas SEM ganho medido (saving e receita null) → NÃO é duplicata (D8)', () => {
    const r = buscarDuplicataNaLista(alvo, [
      { id: 'L2', nome: 'Bot de Faturamento', saving_reais: null, receita_mensal: null, status: 'Aprovado' },
    ]);
    expect(r).toEqual([]);
  });

  it('nome igual com receita medida (saving null) → é duplicata', () => {
    const r = buscarDuplicataNaLista(alvo, [
      { id: 'L3', nome: 'Bot de Faturamento', saving_reais: null, receita_mensal: 1200, status: 'Aprovado' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].motivo).toMatch(/1200|1\.200/);
  });

  it('nome diferente → não é duplicata', () => {
    const r = buscarDuplicataNaLista(alvo, [
      { id: 'L4', nome: 'Conciliação de Cartões', saving_reais: 900, receita_mensal: null, status: 'Aprovado' },
    ]);
    expect(r).toEqual([]);
  });

  it('lista vazia → []', () => {
    expect(buscarDuplicataNaLista(alvo, [])).toEqual([]);
  });
});
