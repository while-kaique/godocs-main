/**
 * PISO DE MATERIALIDADE do time de avaliação (D4/D4.2 do plano de calibragem) — módulo PURO.
 *
 * A mesa procurava **inflação** em quatro eixos (horas, valor, precedente, evidência) e nunca
 * perguntava se o ganho era **irrelevante**: `avaliacao-financeira.ts` tinha TETO de materialidade
 * (R$ 5.000/mês → decisão humana) e **nenhum PISO**, então um projeto de R$ 18,16/mês voltava
 * `veredito: 'ok'` com confiança 0,9. Foi por esse eixo que o dono do produto reprovou **137
 * projetos à mão em 04/09/2026** (`docs/baselines/rodadas/snapshot-reprovacao-04-09.json`: 137
 * alvos, TODOS com `statusAntes: "Aprovado"`).
 *
 * ⚠️ **Régua declarada, não juízo do LLM.** Esta é a porta MECÂNICA da reprovação (D4, porta i): o
 * número entra, a régua responde, e nenhum agente opina. É o que sustenta o invariante do repo
 * "rejeição mecânica sobrepõe aprovação do LLM, nunca o contrário".
 *
 * ⚠️ **Ausência de número NÃO é ganho abaixo do piso.** `0`/`null` significa "não há ganho
 * declarado" — projeto ESPECIAL não tem memorial financeiro por definição, e na v2 existe ganho
 * IMENSURÁVEL declarado de propósito. Reprovar por ausência reprovaria essas duas famílias
 * inteiras por um número que elas nunca prometeram ter. Quem diz a ALTURA de um projeto sem número
 * é a nota zero da régua de estrelas (que não é reprovação — D4.1).
 */

/**
 * Piso de impacto mensal (R$/mês). Abaixo dele o ganho é irrelevante para a empresa e o projeto
 * não se sustenta como projeto documentado.
 *
 * ⚠️ **Assunção declarada (D4.2):** é a régua que o dono do produto aplicou à mão em 04/09/2026,
 * quando reprovou 137 projetos por impacto baixo. Ele confirmou que *"isso é um piso"* sem cravar o
 * número, e este é o único valor já aplicado nesta base. O snapshot de 04/09 é o gabarito: o piso
 * está certo se reprovar aqueles 137 e mais ninguém. Se a fórmula do Líquido da v2 mudar o que
 * "R$ 100" significa, o número se revisa AQUI, num lugar só.
 */
export const PISO_IMPACTO_MENSAL = 100;

/**
 * O ganho mensal declarado fica abaixo do piso? PURA.
 *
 * `true` só quando há número POSITIVO e ele é menor que o piso. `0`, `null`, `undefined`, NaN e
 * negativo devolvem `false` — ver o aviso do topo: ausência de número não é ganho irrelevante.
 */
export function abaixoDoPisoDeImpacto(
  impactoMensal: number | null | undefined,
  piso: number = PISO_IMPACTO_MENSAL,
): boolean {
  if (typeof impactoMensal !== 'number' || !Number.isFinite(impactoMensal)) return false;
  if (impactoMensal <= 0) return false;
  return impactoMensal < piso;
}

/** R$ pt-BR com centavos — o piso julga valores pequenos, onde arredondar apaga o argumento. */
function reais(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A frase que acompanha a reprovação pelo piso — nomeia o número, o piso e o que fazer. PURA.
 * Fica junto da constante para que o motivo nunca seja redigitado em cada chamador.
 */
export function motivoPisoDeImpacto(
  impactoMensal: number,
  piso: number = PISO_IMPACTO_MENSAL,
): string {
  return `Impacto declarado de ${reais(impactoMensal)}/mês, abaixo do piso de ${reais(piso)}/mês. Um ganho desta ordem não sustenta o projeto como projeto documentado.`;
}

/**
 * Qual número o piso julga. PURA e num lugar só, para os dois lados do time não julgarem números
 * diferentes: o **Ganho Total mensal já materializado** e, na sua ausência (legado que nunca o
 * gravou), a MESMA régua de negócio que o produz — saving cheio + receita ÷ 10
 * (`ganhoTotalMensal`, `docs/business-rules.md`).
 *
 * ⚠️ **A régua do ÷10 não se "conserta" aqui.** Ela é decisão de produto com teste próprio; este
 * módulo só a REPETE para não deixar o piso cego em projeto legado. Se as duas fontes faltarem,
 * devolve `null` = "não há número declarado" (que não é ganho abaixo do piso).
 */
export function impactoMensalDeclarado(input: {
  ganhoTotalMensal?: number | null;
  savingReais?: number | null;
  receitaMensal?: number | null;
}): number | null {
  const g = input.ganhoTotalMensal;
  if (typeof g === 'number' && Number.isFinite(g)) return g;
  const saving = typeof input.savingReais === 'number' && Number.isFinite(input.savingReais) ? input.savingReais : null;
  const receita = typeof input.receitaMensal === 'number' && Number.isFinite(input.receitaMensal) ? input.receitaMensal : null;
  if (saving == null && receita == null) return null;
  return (saving ?? 0) + (receita ?? 0) / 10;
}

/**
 * Limite de estrela para o piso poder reprovar: a nota tem de ser **estritamente abaixo de 1** —
 * ou seja, **zero**.
 *
 * ⚠️ **Isto já esteve errado aqui, e o erro era MEU.** Eu tinha posto `1` como TETO (`<= 1`), o
 * que reprovava também os **1★**. O dono do produto corrigiu: *"você inventou o <= 1, eu falei
 * < 1"* — e ele havia escrito, antes, `(100 e com 0 estrelas)`. A diferença não é acadêmica: são
 * **6 projetos APROVADOS de 1★** (`RA Monitor`, `Controle de Vencimentos`, `[ECOMM] Alerta de
 * pedidos travados`, `Direcionador de Fórum`, `Pesquisa Satisfação Prima Vida`, `[DUDA] Cupons`)
 * que o `<= 1` derrubava **sem uma única evidência no gabarito**.
 *
 * ⚠️ **Medido contra o gabarito do dono do produto (08/09/2026):** dos **137** projetos que ele
 * reprovou à mão em 04/09 pela régua de impacto, **137 tinham 0★. Sem exceção.** Ou seja, a régua
 * que ele aplicou nunca foi só o piso — era piso **E** nota zero, e o piso sozinho é mais largo
 * que o julgamento que ele exerceu. Extrapolar para 1★ foi ir além do que o dado sustenta.
 *
 * O que a estrela poupa, medido na base de prod: **10 projetos APROVADOS** que o piso sozinho
 * reprovaria e que têm 2★ a 4★ — `Funil R&S` (4★), `Onboarding & Integração` (3★), `Portal de
 * Admissão` (2★), `Agente de Waitlists` (3★)… quase todos de Gente & Gestão e processo, que é
 * exatamente a família em que **o valor não está no dinheiro** (o ganho imensurável da régua).
 * Reprovar um 4★ porque ele move R$ 89,70/mês seria aplicar o eixo errado.
 *
 * Relatório: `docs/baselines/rodadas/piso-impacto-precisao-08-09.json`.
 */
export const ESTRELA_LIMITE_REPROVAVEL = 1;

/**
 * A régua COMPOSTA da reprovação por impacto: o número é irrelevante **e** o projeto é baixo.
 * PURA.
 *
 * ⚠️ **SEM NOTA AVALIADA, NÃO REPROVA (invertido em 09/09/2026 — decisão do Luis).** Este ponto
 * dizia o contrário, e o contrário estava errado por uma razão de DADO, não de régua: a coluna
 * "Estrelas" tem **463 de 750 linhas em `0`**, e esse `0` é o **estado inicial de uma coluna
 * manual** — ela já tinha ~426 zeros em 17/08/2026, antes de qualquer agente existir. Então a
 * perna "nota < 1" era verdadeira em **466 de 750** projetos e o piso decidia praticamente sem
 * filtro de nota. Palavras dele: *"tem mts projetos que sao 0 estrelas pq nao passaram pela
 * avaliação"*. E o próprio repo já discordava de si mesmo: o harness do retroativo só aceita
 * gabarito com `nota humana >= 1`, ou seja **trata 0 como "sem nota"** desde sempre.
 *
 * A régua nova, então: reprovar exige **veredito de nota em mãos**. Quem não foi avaliado vai para
 * conferência humana — nunca para reprovado.
 *
 * ⚠️ Corolário que NÃO pode ser desfeito por engano: `estrela` ausente/`null` → **`false`**. Quem
 * decide de onde vem essa nota é `notaParaOPiso` (abaixo), e é lá que o `0` humano é tratado como
 * default, não como julgamento.
 * ⚠️ A ordem importa: sem número não há reprovação por impacto (ver `abaixoDoPisoDeImpacto`).
 */
export function reprovaPeloPiso(input: {
  impactoMensal: number | null | undefined;
  /** A nota AVALIADA (ver `notaParaOPiso`) — nunca o `0` default da coluna manual. */
  estrela?: number | null;
  piso?: number;
  limiteEstrela?: number;
}): boolean {
  if (!abaixoDoPisoDeImpacto(input.impactoMensal, input.piso ?? PISO_IMPACTO_MENSAL)) return false;
  const limite = input.limiteEstrela ?? ESTRELA_LIMITE_REPROVAVEL;
  const e = input.estrela;
  // Sem nota avaliada não há o 2º eixo da régua composta → não reprova (ver o aviso acima).
  if (typeof e !== 'number' || !Number.isFinite(e)) return false;
  // ⚠️ `<`, não `<=`: nota 1 NÃO reprova. Ver o aviso da constante.
  return e < limite;
}

/** De onde a nota do piso saiu — entra no parecer, para a reprovação ser defensável. */
export type FonteDaNota = 'humana' | 'agente' | 'ausente';

/**
 * A nota que o piso pode usar, e de onde ela veio. PURA.
 *
 * ⚠️ **O `0` da coluna HUMANA não é veredito, é default** (463 de 750 linhas; ~426 já em 17/08,
 * antes de existir agente). Por isso ele NÃO entra como nota: cai para a do agente, e se não
 * houver nenhuma o resultado é `'ausente'` — que não reprova.
 * ⚠️ **Nota humana `>= 1` VENCE sempre** (é âncora, e a régua nunca reclassifica quem gente já
 * julgou).
 * ⚠️ **A faixa de escape `"6-10"` vira o piso dela (6)**: `Number("6-10")` é `NaN`, e NaN cairia
 * em "sem nota" justamente no caso que mais precisa ser poupado.
 */
export function notaParaOPiso(input: {
  humana?: number | null;
  /** A recomendação do agente, como está na planilha (número, faixa "6-10" ou vazio). */
  agente?: string | number | null;
  faixaEscapeMin?: number;
}): { nota: number | null; fonte: FonteDaNota } {
  const h = input.humana;
  if (typeof h === 'number' && Number.isFinite(h) && h >= ESTRELA_LIMITE_REPROVAVEL) {
    return { nota: h, fonte: 'humana' };
  }
  const bruta = String(input.agente ?? '').trim();
  if (bruta === '' || bruta === '—' || bruta === '-') return { nota: null, fonte: 'ausente' };
  if (bruta.includes('-')) return { nota: input.faixaEscapeMin ?? 6, fonte: 'agente' };
  const n = Number(bruta);
  if (!Number.isFinite(n)) return { nota: null, fonte: 'ausente' };
  return { nota: n, fonte: 'agente' };
}

/** A frase da reprovação composta — nomeia os DOIS eixos, porque são dois. */
export function motivoPisoComEstrela(
  impactoMensal: number,
  estrela: number | null | undefined,
  piso: number = PISO_IMPACTO_MENSAL,
): string {
  const base = motivoPisoDeImpacto(impactoMensal, piso);
  return typeof estrela === 'number' && Number.isFinite(estrela)
    ? `${base} E a nota do projeto é ${estrela}, ou seja, o ganho pequeno não vem acompanhado de altura em nenhum outro eixo.`
    : `${base} E o projeto não tem nota que aponte valor em outro eixo.`;
}
