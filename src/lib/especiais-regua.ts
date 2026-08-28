/**
 * Régua de ESTRELAS dos projetos — módulo PURO e **FONTE ÚNICA** do texto.
 *
 * Origem: `RUBRICA_ESTRELAS.md` (força-tarefa do JV, 18/08/2026), validada contra os 644
 * projetos da aba GoDocs. Vive aqui porque três consumidores precisam do MESMO texto: a tela
 * `/especiais` (a régua ao lado do julgamento), o prompt do agente classificador (peça 4) e os
 * testes. ⚠️ **Não redigite a régua em prompt nem em tela — altere estas constantes.**
 *
 * ## O que a estrela é (e o que ela NÃO é)
 * Nota qualitativa **0–10** dada na AUDITORIA, nunca pelo autor. No score do impacto, o R$/horas
 * declarado já paga sua própria faixa (0–30) e a estrela vale até **70** — ela existe porque hora
 * declarada infla. ⚠️ **Premiar R$ alto com estrela alta é contar o mesmo ganho duas vezes**: é o
 * erro que esta régua existe para impedir, e vale para a tela e para o agente.
 *
 * ## Por que a CURVA importa mais que a definição de cada nível
 * A base real é dura: **≥3 estrelas é top 4%** dos 644 projetos e **≥5 é top 1%**. Uma régua sem
 * curva vira inflação em duas semanas — se uma rodada de recomendações sair muito mais generosa
 * que `CURVA_BASE`, o defeito está na régua (ou no juiz), não na base.
 */

/** Faixas de tier (badge por estrela, máximo entre os projetos da pessoa). */
export const TIERS = [
  { chave: 'bronze', rotulo: 'Bronze', de: 1, ate: 2 },
  { chave: 'prata', rotulo: 'Prata', de: 3, ate: 4 },
  { chave: 'ouro', rotulo: 'Ouro', de: 5, ate: 6 },
  { chave: 'diamante', rotulo: 'Diamante', de: 7, ate: 10 },
] as const;

export type TierChave = (typeof TIERS)[number]['chave'];

/** Teto da escala. Acima disso é erro de digitação, não nota. */
export const NOTA_MAX = 10;

/**
 * A definição de cada nível — as âncoras da escala. É contra estas frases (e contra os projetos
 * fixados como régua na tela) que uma nota nova se posiciona.
 */
export const NIVEIS: { nota: number; titulo: string; definicao: string }[] = [
  { nota: 0, titulo: 'Não pontua', definicao: 'Peça única, sem recorrência nem evidência, ou teste.' },
  { nota: 1, titulo: 'Útil e local', definicao: 'Automação de rotina própria, rastro fraco. É o piso mais comum da base.' },
  { nota: 2, titulo: 'Sólida', definicao: 'Recorrente, ponteiro verificável, serve um time inteiro.' },
  { nota: 3, titulo: 'Prata', definicao: 'Inteligência no fluxo + recorrência + evidência + adoção por outras pessoas.' },
  { nota: 4, titulo: 'Prata alta', definicao: 'Reuso multi-área OU risco material (fiscal/jurídico) OU ganho estrutural claro.' },
  { nota: 5, titulo: 'Ouro', definicao: 'Plataforma ou produto interno, autonomia, várias áreas usando, ponteiro auditável.' },
  { nota: 6, titulo: 'Ouro alto', definicao: 'O mesmo do 5, com alcance ou autonomia acima da média da faixa.' },
  { nota: 7, titulo: 'Diamante', definicao: 'Muda a operação de forma estrutural, escala de grupo, usuários reais fora do time.' },
  { nota: 8, titulo: 'Diamante alto', definicao: 'O mesmo do 7, com adoção ou impacto estrutural mais amplo.' },
  { nota: 9, titulo: 'Excepcional', definicao: 'Topo absoluto da base.' },
  { nota: 10, titulo: 'Excepcional', definicao: 'Topo absoluto — hoje 1 projeto em 644.' },
];

/** O que vale estrela. Ordem = ordem em que a auditoria olha. */
export const CRITERIOS = [
  { titulo: 'Recorrência real', texto: 'Roda de novo sozinho (cron, gatilho, uso contínuo) — não é peça única.' },
  { titulo: 'Rastreabilidade', texto: 'Existe relatório, painel, base ou log NOMEADO onde conferir o ponteiro movido.' },
  { titulo: 'Contrafactual', texto: 'Se desligar, alguém nomeado sente e o processo piora de forma perceptível.' },
  { titulo: 'Complexidade técnica', texto: 'automação < inteligência (IA no fluxo) < autonomia (decide e age sozinho).' },
  { titulo: 'Alcance e reuso', texto: '1 pessoa < 1 time < área < várias áreas ou marcas < grupo.' },
  { titulo: 'Qualidade de execução', texto: 'Em produção, documentado, memorial honesto — admitir limite conta A FAVOR.' },
  { titulo: 'Risco evitado', texto: 'Fiscal, jurídico, financeiro ou de segurança.' },
  { titulo: 'Especiais', texto: 'Sem R$, a estrela é o ÚNICO pagamento: valor estratégico e uso real mandam.' },
] as const;

/** O que derruba para 0–1, por mais bem escrito que o memorial esteja. */
export const DERRUBA = [
  'O entregável é o próprio documento ou planilha, sem uso recorrente.',
  'Teste ou POC abandonada.',
  'Memorial sem ponteiro verificável E sem contrafactual.',
  'Automação que só substitui uma tarefa do próprio autor, de baixa frequência.',
  'Projeto duplicado ou ressubmissão do mesmo escopo.',
] as const;

/**
 * A distribuição REAL da aba GoDocs (644 linhas, 18/08/2026) — a régua contra a qual uma rodada
 * de recomendações se compara. `null` é a célula vazia (nunca auditada), diferente do 0.
 */
export const CURVA_BASE: Record<string, number> = {
  '0': 426,
  vazio: 100,
  '1': 62,
  '2': 22,
  '3': 20,
  '4': 5,
  '5': 3,
  '7': 1,
  '8': 1,
  '10': 1,
};

/** Total auditado (tudo menos as células vazias) — denominador dos percentuais abaixo. */
export const TOTAL_AUDITADO = Object.entries(CURVA_BASE)
  .filter(([k]) => k !== 'vazio')
  .reduce((s, [, v]) => s + v, 0);

/** Quantos por cento da base estão em `nota` ou acima. É o "top X%" que a tela mostra. */
export function percentilAcimaDe(nota: number): number {
  const acima = Object.entries(CURVA_BASE)
    .filter(([k]) => k !== 'vazio' && Number(k) >= nota)
    .reduce((s, [, v]) => s + v, 0);
  return (acima / TOTAL_AUDITADO) * 100;
}

/**
 * Percentual de uma curva QUALQUER em `nota` ou acima — a versão genérica de `percentilAcimaDe`.
 *
 * ⚠️ Existe porque **a população muda a leitura da mesma nota**: na base inteira ≥3★ é top 4%, e
 * entre os especiais AUDITADOS é **41,7%** (`CURVA_ESPECIAIS_AUDITADOS`, `especiais-calibrador.ts`).
 * Dizer "top 4%" a quem julga só especiais faz 3★ soar absurdo — foi o que travou o revisor
 * adversarial em refutar 17 de 17 (medido 28/08/2026, ver `docs/plans/painel-agentes-especiais.md`).
 */
export function percentilNaCurva(curva: Record<string, number>, nota: number): number {
  const pares = Object.entries(curva).filter(([k]) => k !== 'vazio');
  const total = pares.reduce((s, [, v]) => s + v, 0);
  if (!total) return 0;
  const acima = pares.filter(([k]) => Number(k) >= nota).reduce((s, [, v]) => s + v, 0);
  return (acima / total) * 100;
}

/** `raridadeDe` para uma curva/população declarada. `rotulo` nomeia a população na frase. */
export function raridadeNaCurva(
  curva: Record<string, number>,
  nota: number,
  rotulo: string,
): string | null {
  if (nota <= 1) return null;
  const pct = percentilNaCurva(curva, nota);
  if (pct >= 50) return null;
  return `${nota}+ = top ${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% ${rotulo}`;
}

/** Frase curta de raridade para o cabeçalho da coluna ("top 4% da base"). */
export function raridadeDe(nota: number): string | null {
  if (nota <= 1) return null;
  const pct = percentilAcimaDe(nota);
  if (pct >= 50) return null;
  return `${nota}+ = top ${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% da base`;
}

export function tierDe(nota: number | null): (typeof TIERS)[number] | null {
  if (nota == null || nota < 1) return null;
  return TIERS.find((t) => nota >= t.de && nota <= t.ate) ?? TIERS[TIERS.length - 1];
}

export function definicaoDe(nota: number | null): string | null {
  if (nota == null) return null;
  return NIVEIS.find((n) => n.nota === nota)?.definicao ?? null;
}

// ─── Recomendação do avaliador (importada ou, na peça 4, do agente) ──────────

/** Confiança declarada por quem avaliou — nunca vira número, é selo de leitura. */
export type Confianca = 'alta' | 'media' | 'baixa';

export type AvaliacaoEspecial = {
  projeto_id: string;
  /** A nota recomendada. NUNCA é gravada sozinha na planilha: é sugestão. */
  estrelas_recomendada: number;
  confianca: Confianca;
  /** Por que esta faixa, por que não sobe e o que faria subir. */
  leitura: string | null;
  /** A recomendação foi contestada no passe adversarial (nota ≥3 revista). */
  contestada: boolean;
  /** De onde veio: o lote importado, ou o agente (com o modelo que a produziu). */
  origem: string | null;
  modelo: string | null;
  criado_em: string | null;
};

/**
 * O delta entre o que está gravado e o que foi recomendado — o número que faz a triagem
 * olhar. `null` quando não há recomendação, ou quando o projeto ainda não tem nota (aí o
 * "delta" seria a própria recomendação e enganaria).
 */
export function deltaRecomendacao(
  atual: number | null,
  avaliacao: AvaliacaoEspecial | undefined,
): number | null {
  if (!avaliacao || atual == null) return null;
  const d = avaliacao.estrelas_recomendada - atual;
  return d === 0 ? null : d;
}

/** Rótulo do delta com sinal explícito ("+2", "−1") — nunca só cor. */
export function rotuloDelta(delta: number | null): string | null {
  if (delta == null) return null;
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

export const ROTULO_CONFIANCA: Record<Confianca, string> = {
  alta: 'confiança alta',
  media: 'confiança média',
  baixa: 'confiança baixa',
};
