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
 * Teto de estrela para o piso poder reprovar.
 *
 * ⚠️ **Medido contra o gabarito do dono do produto (08/09/2026):** dos **137** projetos que ele
 * reprovou à mão em 04/09 pela régua de impacto, **137 tinham 0★. Sem exceção.** Ou seja, a régua
 * que ele aplicou nunca foi só o piso — era piso **E** nota baixa, e o piso sozinho é mais largo
 * que o julgamento que ele exerceu.
 *
 * O que a estrela poupa, medido na base de prod: **10 projetos APROVADOS** que o piso sozinho
 * reprovaria e que têm 2★ a 4★ — `Funil R&S` (4★), `Onboarding & Integração` (3★), `Portal de
 * Admissão` (2★), `Agente de Waitlists` (3★)… quase todos de Gente & Gestão e processo, que é
 * exatamente a família em que **o valor não está no dinheiro** (o ganho imensurável da régua).
 * Reprovar um 4★ porque ele move R$ 89,70/mês seria aplicar o eixo errado.
 *
 * Relatório: `docs/baselines/rodadas/piso-impacto-precisao-08-09.json`.
 */
export const TETO_ESTRELA_REPROVAVEL = 1;

/**
 * A régua COMPOSTA da reprovação por impacto: o número é irrelevante **e** o projeto é baixo.
 * PURA.
 *
 * ⚠️ **Sem estrela declarada, a régua VALE** (`estrela` ausente/`null` → reprovável): é o estado
 * da maioria dos projetos que a rodada de 04/09 pegou, e exigir estrela para reprovar tornaria o
 * piso inerte justamente em quem ninguém avaliou. Quem poupa é a nota ALTA, não a ausência dela.
 * ⚠️ A ordem importa: sem número não há reprovação por impacto (ver `abaixoDoPisoDeImpacto`).
 */
export function reprovaPeloPiso(input: {
  impactoMensal: number | null | undefined;
  /** Nota humana (coluna "Estrelas"); na falta dela, a recomendada pelo agente. */
  estrela?: number | null;
  piso?: number;
  tetoEstrela?: number;
}): boolean {
  if (!abaixoDoPisoDeImpacto(input.impactoMensal, input.piso ?? PISO_IMPACTO_MENSAL)) return false;
  const teto = input.tetoEstrela ?? TETO_ESTRELA_REPROVAVEL;
  const e = input.estrela;
  if (typeof e !== 'number' || !Number.isFinite(e)) return true;
  return e <= teto;
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
