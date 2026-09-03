// Cérebro B — a ESTRELA (T13). Módulo PURO: prompt + normalização da saída do LLM.
//
// D20: a régua é gate determinístico e NENHUM critério muda. O prompt NÃO redigita critério —
// concatena `descreverReguaAgente()` + `descreverEscape()` (fonte única `estrelas-regua.ts`). O
// agente raciocina em cima dela e conclui com racional e EVIDÊNCIA citada do dossiê.
// D14: sem evidência citada o critério não vale — a nota cai um nível e a saída é marcada.
// D9/D11: nota humana ≥6 é âncora congelada; discordância vira CONTESTAÇÃO registrada, nunca nota.
// A DISTRIBUIÇÃO ESPERADA não entra no prompt (viraria cota — foi o defeito do T1).
import {
  TETO_AGENTE,
  PISO_ZERO,
  NIVEL_ZERO,
  GATILHOS_ESCAPE,
  descreverReguaAgente,
  descreverEscape,
  nivelDe,
  aplicarPromocao,
  escapeValido,
  montarContestacao,
  REGRAS_DO_PORQUE,
  contarFrases,
  CONTESTACAO_MAX_FRASES,
  type ChavePisoZero,
  type ChaveGatilhoEscape,
  type Contestacao,
} from '@/lib/estrelas-regua';
import { tipoValido, nivelValido, descreverCategorizacao } from '@/lib/categorizacao-projeto';

export type Mensagem = { role: 'system' | 'user' | 'assistant'; content: string };
export type VizinhoTexto = { id: string; nome: string; nota: number; similaridade: number; resumo: string };

export type SaidaEstrela = {
  nota: number;
  criterio_aplicado: string;
  desqualificador: ChavePisoZero | null;
  evidencias: string[];
  sem_evidencia: boolean;
  promocao: { aplicada: boolean; dependente: string | null };
  escape: { indicado: boolean; valido: boolean; evidencias: Partial<Record<ChaveGatilhoEscape, string>> };
  tipo: string | null;
  nivel: string | null;
  racional: string;
  contestacao: Contestacao | null;
  ancora_congelada: boolean;
  sinais: { temEvidenciaCitada: boolean; temVizinhos: boolean };
};

export const RACIONAL_MAX = 600;
/** Nota humana a partir da qual o projeto é âncora congelada (D9). */
export const NOTA_ANCORA_CONGELADA = 6;

const FORMATO_JSON = `FORMATO DE RESPOSTA — responda APENAS com um objeto JSON, sem texto fora dele:
{
  "nota": <inteiro 0 a ${TETO_AGENTE} quando escape.indicado=false; quando true, a nota que você acha dentro de 6 a 10 — o comitê humano decide o número final>,
  "criterio_aplicado": "<verbo do nível: Experimenta | Informa | Executa | Garante | Decide | Assume>",
  "desqualificador": "<quando nota 0: a chave do piso — ${PISO_ZERO.map((p) => p.chave).join(' | ')} — senão null>",
  "evidencias": ["<citação LITERAL do dossiê que sustenta o critério>", "..."],
  "dependente_nomeado": "<nome do projeto/processo que depende deste como fonte, ou null>",
  "escape": { "indicado": <bool>, "por_que_nao": "<OBRIGATÓRIO quando indicado=false: qual gatilho falta e por quê, em uma frase>", "evidencias": { "${GATILHOS_ESCAPE[0].chave}": "<citação>", "${GATILHOS_ESCAPE[1].chave}": "<citação>" } },
  "tipo": "<dashboard | app | automacao | agente | sistema>",
  "nivel": "<deterministico | inteligente | autonomo>",
  "racional": "<2 a 3 frases curtas, até 600 caracteres, em português comum: o que o projeto faz, por que este nível e não o de cima, o que faria subir. Sem o vocabulário interno da régua — ver COMO ESCREVER O PORQUÊ.>",
  "gatilho_que_falhou": "<só quando o dossiê traz uma nota humana MAIOR que a sua: qual critério/gatilho dela não se sustenta, com a citação>"
}`;

const DISCIPLINA = `${REGRAS_DO_PORQUE}

DISCIPLINA:
- Raciocine em cima da régua, mas NÃO a reescreva: cada nível é o texto acima, e você conclui a partir dele com um racional que faça sentido no contexto deste projeto.
- Ter saving medido NÃO zera. Só zera se o projeto se RESUME ao número (ou cai em outro item do piso).
- O dossiê da base legada vem SÓ da planilha: não ter anexo, documentação compilada ou "prova de uso" nele NÃO é sinal de que o projeto está parado. "fora_de_uso" só vale quando o dossiê DIZ que parou, está em staging, é POC ou foi descontinuado. Julgue o que o projeto faz pelo que está descrito; a triagem humana avaliou com esse mesmo material.
- Toda nota acima de 0 exige pelo menos UMA citação literal do dossiê em "evidencias". Sem citação, o critério não vale.
- A classe do artefato é pista, não decisão. Os exemplos reais de cada nível são âncoras de comparação.
- Promoção +1 só com o dependente NOMEADO (nome do projeto/processo). "Poderá ser consultado" não é dependente.
- Escape 6–10: você só INDICA a faixa, citando os DOIS gatilhos. O número dentro de 6–10 é do comitê humano, nunca seu.
- ⚠️ O PASSO 1 é obrigatório e a resposta dele vai no JSON SEMPRE. Recusar o escape sem dizer qual gatilho falta é resposta incompleta.
- ⚠️ Uma PLATAFORMA (outros projetos a consomem por API, MCP, integração; vários times constroem sobre ela) é o caso em que a régua de 0–5 mede a coisa errada: ela não "assume um processo", ela SUSTENTA muitos. Avalie-a pelo escape.
- Se o dossiê traz nota humana maior que a sua, não a copie: registre em "gatilho_que_falhou" o que não se sustenta, com citação. A decisão fica com o comitê.`;

export function buildPromptEstrela(args: {
  dossieTexto: string;
  vizinhos: VizinhoTexto[];
  ferramentasTexto?: string | null;
  /**
   * A objeção do CÉTICO DA ESTRELA, na segunda volta. ⚠️ É uma objeção a RESPONDER, não uma
   * ordem: o cérebro pode manter a nota se tiver evidência — o que ele não pode é ignorá-la.
   * Sem isto, a "volta" seria a mesma pergunta ao mesmo modelo e daria a mesma resposta.
   */
  objecaoDoCetico?: string | null;
}): Mensagem[] {
  const system = [
    // ⚠️ **A ORDEM aqui é o conserto de um defeito MEDIDO** (03/09/2026, 65 especiais de
    // produção): a abertura dizia "recomenda a estrela (0 a 5)" e o escape vinha DEPOIS da
    // régua, como apêndice. Resultado: só 8 das 65 leituras sequer o mencionaram — o modelo
    // resolvia a nota dentro da cadeia 1–5 e parava. O «PIAPP» (10★ humano), uma plataforma
    // sobre a qual 10 times constroem, saiu com **2★**: forçado no eixo da cadeia, virou
    // "produz insumo, alguém usa" = Informa + promoção.
    // ⚠️ E os dois eixos são DIFERENTES: a cadeia mede quanto de UM processo o projeto assume;
    // o escape mede QUANTOS processos existem por causa dele. Plataforma não cabe no primeiro.
    // Por isso o escape virou o PASSO 1, com resposta obrigatória — inclusive quando é "não".
    'Você é o avaliador de ESTRELAS do GoDocs: lê o dossiê de um projeto de automação/IA do Gogroup e recomenda a estrela de 0 a 10, com evidência citada. A estrela paga o impacto que a fórmula financeira não vê.',
    '',
    'VOCÊ DECIDE EM DOIS PASSOS, NESTA ORDEM:',
    '',
    'PASSO 1 — este projeto MUDA O JOGO (faixa 6–10)? Responda isso ANTES de pensar em qualquer nível de 0 a 5. São réguas DIFERENTES: a de 0–5 mede quanto de UM processo o projeto assume; a de 6–10 mede QUANTOS processos existem por causa dele e quão irreversível é essa dependência. Uma plataforma sobre a qual outros times constroem não cabe na primeira — ela é candidata natural à segunda.',
    '',
    descreverEscape(),
    '',
    'PASSO 2 — se o PASSO 1 for "não", só então posicione o projeto de 0 a 5 pela régua abaixo. Em "escape.indicado": false, o campo "escape.por_que_nao" é OBRIGATÓRIO: diga em uma frase qual dos dois gatilhos falta e por quê. Não é permitido pular o PASSO 1 em silêncio.',
    '',
    descreverReguaAgente(),
    '',
    descreverCategorizacao(),
    '',
    DISCIPLINA,
    ...(args.ferramentasTexto ? ['', args.ferramentasTexto] : []),
    '',
    FORMATO_JSON,
  ].join('\n');

  const vizinhosTxt = args.vizinhos.length
    ? args.vizinhos
        .map(
          (v) =>
            `- ${v.nome} (nota humana ${v.nota}★, similaridade ${v.similaridade.toFixed(2)}): ${v.resumo}`,
        )
        .join('\n')
    : 'Nenhum vizinho com nota humana foi encontrado para este projeto (sem vizinhos). Ancore só na régua e nos exemplos reais dela.';

  const user = [
    'PROJETOS PARECIDOS JÁ AVALIADOS POR HUMANOS (âncoras de comparação — posicione o projeto RELATIVO a eles, justificando a diferença):',
    vizinhosTxt,
    '',
    'DOSSIÊ DO PROJETO:',
    args.dossieTexto,
    ...(args.objecaoDoCetico
      ? [
          '',
          'OBJEÇÃO DO CÉTICO À SUA NOTA ANTERIOR — responda a ela:',
          args.objecaoDoCetico,
          'Se a objeção procede, corrija a nota. Se não procede, MANTENHA a nota e diga no racional qual evidência do dossiê a derruba. Concordar sem evidência é pior que discordar com ela.',
        ]
      : []),
    '',
    'Recomende a estrela deste projeto no formato pedido.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── normalização ──────────────────────────────────────────────────────────────

const CHAVES_PISO = new Set<string>(PISO_ZERO.map((p) => p.chave));
// ⚠️ sem `\b`: em JS ele é ASCII-only e nunca casa depois de "poderá" (acento). Gotcha registrado no CLAUDE.md.
const PROMESSA = /(?:^|\s)(poder[aá]|poderia|abre portas|potencial|futur[oa]|eventualmente|talvez)(?:\s|$|[.,;:!?])/i;

function verboDe(nota: number): string {
  if (nota <= 0) return NIVEL_ZERO.verbo.toLowerCase();
  return (nivelDe(nota)?.verbo ?? NIVEL_ZERO.verbo).toLowerCase();
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0);
}

function cortar(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function primeirasFrases(texto: string, n: number): string {
  const frases = texto
    .split(/(?<=[.!?])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
  return frases.slice(0, n).join(' ');
}

export function normalizarSaidaEstrela(
  bruto: unknown,
  ctx: { temVizinhos: boolean; notaHumana: number | null },
): SaidaEstrela | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const n = Number(o.nota);
  if (o.nota === undefined || o.nota === null || o.nota === '' || !Number.isFinite(n)) return null;
  let nota = Math.max(0, Math.min(TETO_AGENTE, Math.round(n)));

  const evidencias = strings(o.evidencias);
  let sem_evidencia = false;
  if (nota > 0 && evidencias.length === 0) {
    nota -= 1;
    sem_evidencia = true;
  }

  // Promoção: só com dependente NOMEADO (não promessa) e nunca acima do teto.
  const depCru = typeof o.dependente_nomeado === 'string' ? o.dependente_nomeado.trim() : '';
  const dependente = depCru && !PROMESSA.test(depCru) ? depCru : null;
  const notaAntes = nota;
  if (dependente) nota = aplicarPromocao(nota, true);
  const promocao = { aplicada: nota !== notaAntes, dependente: dependente && nota !== notaAntes ? dependente : null };

  // Escape: só a partir do topo da faixa do agente e só com os DOIS gatilhos citados.
  const escCru = o.escape && typeof o.escape === 'object' ? (o.escape as Record<string, unknown>) : {};
  const evEsc: Partial<Record<ChaveGatilhoEscape, string>> = {};
  const evCru = escCru.evidencias && typeof escCru.evidencias === 'object' ? (escCru.evidencias as Record<string, unknown>) : {};
  for (const g of GATILHOS_ESCAPE) {
    const v = evCru[g.chave];
    if (typeof v === 'string' && v.trim()) evEsc[g.chave] = v.trim();
  }
  const indicadoCru = escCru.indicado === true || escCru.indicado === 'true';
  const valido = indicadoCru && nota >= TETO_AGENTE && escapeValido({ sugestao: TETO_AGENTE + 1, evidencias: evEsc });
  const escape = { indicado: valido, valido, evidencias: evEsc };

  const criterio_aplicado = verboDe(nota);
  const desqCru = typeof o.desqualificador === 'string' ? o.desqualificador.trim() : '';
  const desqualificador = nota === 0 && CHAVES_PISO.has(desqCru) ? (desqCru as ChavePisoZero) : null;

  const racionalCru = typeof o.racional === 'string' && o.racional.trim() ? o.racional.trim() : '';
  const racional = cortar(racionalCru || `Nível ${nota} (${criterio_aplicado}) sem racional do modelo.`, RACIONAL_MAX);

  const tipo = tipoValido(o.tipo);
  const nivel = nivelValido(o.nivel);

  const ancora_congelada = ctx.notaHumana !== null && ctx.notaHumana >= NOTA_ANCORA_CONGELADA;
  let contestacao: Contestacao | null = null;
  if (ctx.notaHumana !== null && nota < ctx.notaHumana) {
    const gatilho =
      typeof o.gatilho_que_falhou === 'string' && o.gatilho_que_falhou.trim() ? o.gatilho_que_falhou.trim() : criterio_aplicado;
    const racionalContest =
      contarFrases(racional) > CONTESTACAO_MAX_FRASES ? primeirasFrases(racional, CONTESTACAO_MAX_FRASES) : racional;
    contestacao = montarContestacao({
      notaHumana: ctx.notaHumana,
      notaRegua: nota,
      criterioAplicado: criterio_aplicado,
      gatilhoQueFalhou: gatilho,
      racional: racionalContest,
      evidencia: evidencias[0] ?? '',
    });
  }

  return {
    nota,
    criterio_aplicado,
    desqualificador,
    evidencias,
    sem_evidencia,
    promocao,
    escape,
    tipo,
    nivel,
    racional,
    contestacao,
    ancora_congelada,
    sinais: { temEvidenciaCitada: evidencias.length > 0, temVizinhos: ctx.temVizinhos },
  };
}

/** Saída honesta quando o LLM não devolveu JSON utilizável: zero, sem evidência, acusando o fallback. */
export function saidaEstrelaFallback(
  motivo: string,
  ctx: { temVizinhos: boolean; notaHumana: number | null },
): SaidaEstrela {
  return {
    nota: 0,
    criterio_aplicado: NIVEL_ZERO.verbo.toLowerCase(),
    desqualificador: null,
    evidencias: [],
    sem_evidencia: true,
    promocao: { aplicada: false, dependente: null },
    escape: { indicado: false, valido: false, evidencias: {} },
    tipo: null,
    nivel: null,
    racional: `Fallback: o agente da estrela não devolveu uma saída utilizável (${motivo}). Nota não avaliada; conferir na triagem.`,
    contestacao: null,
    ancora_congelada: ctx.notaHumana !== null && ctx.notaHumana >= NOTA_ANCORA_CONGELADA,
    sinais: { temEvidenciaCitada: false, temVizinhos: ctx.temVizinhos },
  };
}
