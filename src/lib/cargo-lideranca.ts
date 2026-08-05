// Régua da ISENÇÃO de pré-aprovação pelo CARGO (D20, decisão do Luis 05/08/2026).
// Módulo PURO (sem rede, sem env) — roda no worker e nos scripts de relatório.
//
// A régua: TODO MUNDO responde ao líder que tiver; quem tem cargo de **coordenador
// para cima** (coordenador · gerente · head · diretor/diretoria · superintendente ·
// sócio · C-level) NÃO precisa de pré-aprovação. Supervisor NÃO isenta — o exemplo
// que fechou a decisão: a analista Fablícia é pré-aprovada pela supervisora Kelly, a
// Kelly pelo gerente João Conde, e o gerente é isento.
//
// ⚠️ Por que NÃO é mais "aparece como `leader` de um time ativo" (a régua D11
// original): a TeamGuide pendura um nó por pessoa na árvore ("[TRANSPORTES] TIME
// FABRICIA LIMA"), então uma ANALISTA figurava como `leader` e saía isenta sem
// ninguém aprovar — 21 das 64 linhas pendentes de 05/08/2026 caíam nisso.
// ⚠️ E também não é "tem liderado no índice": 22 pessoas com cargo de IC lideram
// gente de fato (Team Líder Cx com 12 liderados), e pela régua do cargo elas
// CONTINUAM em fila — é o cargo que decide, não o tamanho do time.

const DIACRITICOS = /[̀-ͯ]/g;

/** minúsculo, sem acento — o cargo é digitado à mão na TeamGuide (349 variações). */
const normalizar = (s?: string | null) =>
  (s ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cargos que ISENTAM, como fragmentos de palavra DECLARADOS (fonte única — não
 * redigitar em prompt, script ou tela; alterar AQUI).
 *
 * ⚠️ Casam por PALAVRA (fronteira), nunca por pedaço solto: `soci` dentro de
 * "Assistente de **Soci**al Media" e de "Redes **Soci**ais" fazia 3 pessoas
 * virarem sócias por acidente.
 */
export const CARGOS_LIDERANCA: readonly string[] = [
  'coordenador', // + coordenadora/coordenadores
  'gerente',
  'head',
  'diretor', // + diretora/diretoria
  'superintendente',
  'presidente',
  'socio', // + socia/socios; "Co-fundador" NÃO entra (é cargo de especialista aqui)
  'ceo',
  'coo',
  'cto',
  'cfo',
  'cpo',
  'cmo',
  'cro',
  'vp',
  'chief',
];

/**
 * EXCEÇÕES: o cargo carrega a palavra de chefia mas gerencia um OFÍCIO, não gente
 * (decisão do Luis, 05/08/2026, olhando o organograma). Casam por trecho — pegam
 * "Diretor de Arte **PL II**" e "Gerente de Projetos **B2B**".
 *
 * ⚠️ `coordenador de projetos` e `coordenadora de produtos` NÃO são exceção: são
 * coordenação e lideram gente de fato (5 e 3 liderados). Se um dia virarem, é uma
 * linha aqui.
 * ⚠️ Não dá para inferir isso do sufixo de senioridade: "Coordenadora de Ilustração
 * e Cadastro **PL**" é coordenadora de verdade (isenta). A lista é na mão.
 */
export const EXCECOES_CARGO_LIDERANCA: readonly string[] = [
  'diretor de arte',
  'diretora de arte',
  'gerente de projeto', // cobre "Gerente de Projetos" e "…Projetos B2B"
  'diretor de projeto',
  'gerente de produto',
  'diretor de produto',
];

const PADROES = CARGOS_LIDERANCA.map(
  (p) => new RegExp(`(?:^|[^a-z0-9])${p}[a-z]*(?:[^a-z0-9]|$)`),
);

/**
 * O cargo isenta de pré-aprovação? Função PURA e única régua (server + relatório).
 * Cargo vazio/desconhecido → `false`: sem cargo, o seguro é passar pelo líder.
 */
export function ehCargoDeLideranca(cargo?: string | null): boolean {
  const c = normalizar(cargo);
  if (!c) return false;
  if (EXCECOES_CARGO_LIDERANCA.some((e) => c.includes(e))) return false;
  return PADROES.some((re) => re.test(c));
}
