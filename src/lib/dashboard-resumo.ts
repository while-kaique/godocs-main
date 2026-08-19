/**
 * Mapeamento linha-da-planilha → resumo da listagem — módulo PURO (sem import de servidor).
 *
 * Mora fora de `dashboard-admin.functions.ts` pelo mesmo motivo de `coluna-chave.ts`: quem
 * precisa deste mapeamento não é só a tela. O **espelho da planilha** (`sheet-espelho.ts`,
 * server) recorta destas MESMAS colunas o `linha_resumo` que a listagem lê, e um módulo
 * server não pode importar de outro que puxe o mundo inteiro sem criar ciclo. FONTE ÚNICA:
 * `dashboard-admin.functions.ts` re-exporta tudo daqui (os call sites e os testes de sempre
 * continuam importando de lá).
 *
 * ⚠️ Coluna nova lida pelo `mapResumo` TEM de entrar em `COLUNAS_RESUMO` — senão ela existe
 * na `linha` (completa) mas não no recorte, e a listagem mostraria vazio enquanto a ficha
 * mostra o valor. O teste de ida-e-volta (`mapResumo(linhaCheia)` == `mapResumo(recorte)`)
 * existe para essa omissão falhar no CI em vez de degradar a tela em silêncio.
 */
import type { SheetRow } from '@/lib/google/sheets';
import { parseDataFlexivel } from '@/lib/format-date';
import { valorDaColuna, chaveColuna } from '@/lib/coluna-chave';
import { COLUNA_ESTADO_LIDER } from '@/lib/aprovacoes-parecer';

// ─── Parsers de célula ───────────────────────────────────────────────────────

/** Texto da célula: trim, tratando vazio / "—" / "-" como ausência. */
export function texto(valor: string | undefined): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  return s === '' || s === '—' || s === '-' ? null : s;
}

/**
 * Inverso do `texto` para ESCRITA: o que a triagem grava numa coluna de TEXTO nunca vai
 * como célula em branco — vazio (ou já "—"/"-") vira **"—"**, o mesmo padrão do
 * `padronizarLinha` do sync (`src/lib/google/sync.ts`). Sem isso, o admin que APAGA o
 * motivo deixava a célula suja/vazia, fora do padrão da planilha. Pura.
 */
export function ouTraco(valor: string | null | undefined): string {
  return texto(valor ?? undefined) ?? '—';
}

/**
 * Número pt-BR tolerante: "R$ 1.234,56", "418,2" e "10.5". Regra: se há vírgula, ela é
 * o decimal e o ponto é milhar; só ponto → decimal. (Mesma regra do sync reverso.)
 */
export function numero(valor: string | undefined): number | null {
  if (valor == null) return null;
  let s = String(valor)
    .trim()
    .replace(/r\$\s*/gi, '')
    .replace(/\s/g, '');
  if (s === '' || s === '—' || s === '-') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Chave normalizada do status (minúsculas, sem espaço sobrando) — é a mesma chave que
 * o `StatusBadge` consome, então rótulo/ícone/cor saem de um lugar só. Célula vazia
 * (ou "—") → `null`, que o badge mostra como "—". NUNCA cai no status do SQLite.
 */
export function chaveStatus(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const s = String(valor).trim();
  if (s === '' || s === '—' || s === '-') return null;
  return s.toLowerCase();
}

function ehSim(valor: string | undefined): boolean {
  const s = texto(valor)?.toLowerCase() ?? '';
  return s === 'sim' || s === 's' || s === 'true' || s === '1';
}

/**
 * Índice de busca: minúsculas e SEM acento, para "reembolso" achar "Reembôlso" e
 * "helen" achar "Helén". É pré-computado no servidor (uma vez por leitura) para a
 * filtragem no cliente ser só `includes` — a busca precisa responder na tecla.
 */
export function chaveBusca(...partes: (string | null | undefined)[]): string {
  return partes
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ─── Tipos expostos ao frontend ──────────────────────────────────────────────

/**
 * Linha da tabela. Deliberadamente ENXUTA: os memoriais e as justificativas somam
 * vários KB por projeto e só são necessários no detalhe — mandar tudo na listagem
 * faria a tela baixar megabytes para exibir 25 linhas.
 *
 * ⚠️ **Campo que a LISTAGEM não desenha não entra aqui** (medido em prod, 17/08/2026, 639
 * projetos): a resposta pesava **563,6 KB** e `observacoes` sozinho era **160 KB (28%)** —
 * o parecer do analisador, que a tabela nunca mostrou e que a ficha relê do detalhe. Com
 * `Atualizado Em`, `Saving Horas` e `Ferramenta` (esta ainda LIDA, mas só para o índice de
 * busca) fora do payload, caiu para ~352 KB. Aqui cada campo é multiplicado por ~600, e o
 * caminho é lento por VOLUME, não por leitura da planilha — a listagem lê o espelho
 * (SQLite) desde 11/08. Antes de acrescentar campo, pergunte onde ele é DESENHADO.
 */
export type ProjetoDashboardResumo = {
  id: string;
  nome: string | null;
  autor: string | null;
  email: string | null;
  area: string | null;
  status: string | null; // valor cru da planilha (para regravar sem perder o texto)
  statusChave: string | null; // normalizado (StatusBadge)
  dataSubmissao: string | null;
  dataOrdenacao: number | null; // epoch ms — ordenação estável no cliente
  ganhoTotal: number | null;
  savingReais: number | null;
  receitaMensal: number | null;
  complexidade: string | null;
  tipos: string | null;
  especial: boolean;
  /**
   * Estado da pré-aprovação do líder — coluna "Pré-status" da tabela (pedido do Luis,
   * 05/08/2026: dar para saber se o líder já decidiu sem abrir a ficha). É o rótulo CRU
   * da planilha; quem traduz para chip é `ChipEstadoParecer`. Cabe na listagem enxuta
   * porque é um rótulo curto — a JUSTIFICATIVA (multi-linha) segue só no detalhe.
   */
  aprovacaoLider: string | null;
  /**
   * Nota da triagem (coluna manual "Estrelas") — número CRU da planilha, sem teto: a escala
   * é aberta (pedido do Luis, 17/08/2026) e há notas 7/8/10 gravadas. `null` = célula vazia,
   * que é diferente de `0` ("olhei e não dei estrela"). Cabe na listagem enxuta porque é um
   * número: é ele que sustenta o filtro por faixa e a coluna da tabela.
   */
  estrelas: number | null;
  busca: string;
};

// ─── Recorte para o espelho ──────────────────────────────────────────────────

/**
 * As ÚNICAS colunas de que a LISTAGEM precisa — a lista declarada que o espelho usa para
 * montar o `linha_resumo`. Tudo que não está aqui só existe na `linha` completa (ficha de
 * triagem), e é isso que impede a listagem de arrastar os memoriais de ~600 projetos numa
 * consulta só (o gotcha de 32 MiB de RPC que já derrubou o Investigador).
 *
 * ⚠️ Fonte única com o `mapResumo` logo abaixo: coluna que ele passar a ler entra AQUI no
 * mesmo commit (o teste de ida-e-volta cobra).
 */
export const COLUNAS_RESUMO: readonly string[] = [
  'ID Projeto',
  'Projeto',
  'Nome Completo',
  'Email',
  'Área',
  'Ferramenta',
  'Data Submissão',
  'Status',
  'Ganho Total',
  'Saving Reais',
  'Receita Mensal',
  'Complexidade',
  'Tipos Projeto',
  'Especial?',
  'Estrelas',
  COLUNA_ESTADO_LIDER,
];

/**
 * Versão do RECORTE. ⚠️ Entra na impressão digital da linha (`hashLinha`), então **bumpar
 * aqui força um re-espelhamento único de todas as linhas** no próximo sync.
 *
 * Por que é necessário: o hash existe para não reescrever linha que não mudou, e o
 * `linha_resumo` é derivado destas colunas. Acrescentar uma coluna sem bumpar deixaria as
 * ~600 linhas que ninguém editou com o recorte ANTIGO — a coluna existiria no código e
 * viria vazia na tela, para sempre.
 */
export const VERSAO_RECORTE_RESUMO = 2;

/**
 * Recorta de uma linha da planilha só as `COLUNAS_RESUMO`.
 *
 * ⚠️ O casamento é TOLERANTE (`chaveColuna`) e a chave PRESERVADA é a do cabeçalho REAL:
 * o cabeçalho de prod/staging tem "Aprovação do **Lider**" (sem acento) e um recorte por
 * nome exato deixaria o Pré-status de fora — o mesmo bug de 05/08/2026, agora no espelho.
 */
export function recortarResumo(row: SheetRow): Record<string, string> {
  const campos = row as Record<string, string>;
  const alvos = new Set(COLUNAS_RESUMO.map((c) => chaveColuna(c)));
  const out: Record<string, string> = {};
  for (const [chaveReal, valor] of Object.entries(campos)) {
    if (valor == null) continue;
    if (alvos.has(chaveColuna(chaveReal))) out[chaveReal] = valor;
  }
  return out;
}

// ─── Mapeamento ──────────────────────────────────────────────────────────────

export function mapResumo(row: SheetRow): ProjetoDashboardResumo | null {
  const id = texto(row['ID Projeto']);
  if (!id) return null; // linha sem ID não é projeto (separador, rodapé, lixo)

  const nome = texto(row['Projeto']);
  const autor = texto(row['Nome Completo']);
  const email = texto(row['Email']);
  const area = texto(row['Área']);
  // ⚠️ Lida, mas NÃO devolvida: a ferramenta só serve ao índice de busca (é por isso que
  // "n8n" acha o projeto), e mandá-la também como campo próprio custava 18 KB por listagem
  // sem nenhuma célula na tabela. Por isso `Ferramenta` continua em `COLUNAS_RESUMO`.
  const ferramenta = texto(row['Ferramenta']);
  const dataSubmissao = texto(row['Data Submissão']);
  const d = parseDataFlexivel(dataSubmissao);

  return {
    id,
    nome,
    autor,
    email,
    area,
    status: texto(row['Status']),
    statusChave: chaveStatus(row['Status']),
    dataSubmissao,
    dataOrdenacao: d ? d.getTime() : null,
    ganhoTotal: numero(row['Ganho Total']),
    savingReais: numero(row['Saving Reais']),
    receitaMensal: numero(row['Receita Mensal']),
    complexidade: texto(row['Complexidade']),
    tipos: texto(row['Tipos Projeto']),
    especial: ehSim(row['Especial?']),
    // ⚠️ Casamento TOLERANTE: o cabeçalho real de prod/staging é "Aprovação do Lider"
    // (sem acento) e `row['Aprovação do Líder']` devolveria `undefined` — a coluna
    // nasceria vazia para todo projeto. Ver `coluna-chave.ts`.
    aprovacaoLider: texto(valorDaColuna(row as Record<string, string>, COLUNA_ESTADO_LIDER)),
    // Nota crua, sem teto: "8" na planilha vale 8 (a escala é aberta desde 17/08/2026).
    estrelas: numero(row['Estrelas']),
    // O que a busca alcança: nome do projeto, autor, e-mail, id, área e ferramenta.
    busca: chaveBusca(nome, autor, email, id, area, ferramenta),
  };
}

/** Ordena por data de submissão (mais recente primeiro); sem data vai para o fim. */
export function ordenarPorDataDesc(a: ProjetoDashboardResumo, b: ProjetoDashboardResumo): number {
  if (a.dataOrdenacao == null && b.dataOrdenacao == null) {
    return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
  }
  if (a.dataOrdenacao == null) return 1;
  if (b.dataOrdenacao == null) return -1;
  return b.dataOrdenacao - a.dataOrdenacao;
}

export function contarPorStatus(projetos: ProjetoDashboardResumo[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of projetos) {
    const k = p.statusChave ?? 'sem_status';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ─── Agrupamento por autor (compartilhado com a aba de aprovação de pendentes) ──

/**
 * Chave estável do autor: e-mail em minúsculas; sem e-mail, o nome; sem nada, `'sem-autor'`.
 * É por e-mail para dois homônimos não caírem juntos e a mesma pessoa não se partir por acento.
 * FONTE ÚNICA — usada pela aba `/aprovacoes-pendentes` e pelo filtro "2+ projetos" do dashboard.
 */
export function chaveAutor(p: ProjetoDashboardResumo): string {
  const email = (p.email ?? '').trim().toLowerCase();
  if (email) return email;
  return (p.autor ?? '').trim().toLowerCase() || 'sem-autor';
}

/**
 * Mantém só os projetos cujo AUTOR tem 2+ na lista dada. A contagem é sobre o conjunto que
 * chega (já filtrado pelas outras dimensões), então "quem tem vários" respeita os demais
 * filtros — o toggle revela quem tem mais de um projeto para validar tudo de uma vez.
 */
export function apenasAutoresComMultiplos(
  projetos: ProjetoDashboardResumo[],
): ProjetoDashboardResumo[] {
  const conta = new Map<string, number>();
  for (const p of projetos) conta.set(chaveAutor(p), (conta.get(chaveAutor(p)) ?? 0) + 1);
  return projetos.filter((p) => (conta.get(chaveAutor(p)) ?? 0) >= 2);
}
