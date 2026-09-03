// Google Sheets API v4 — append, update e leitura de linhas.

import { getAccessToken } from './auth';
import { assertNaoEhDefaultDeProd } from '../env';
import { chaveColuna } from '../coluna-chave';

const DEFAULT_SPREADSHEET_ID = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const DEFAULT_SHEET_NAME = 'GoDocs';
const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

function getSheetConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID || DEFAULT_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_TAB || DEFAULT_SHEET_NAME;
  // Staging COMPARTILHA a mesma planilha de prod (mesmo ID, de propósito), mas
  // grava numa ABA própria — a aba é o isolamento. Se a aba cair no default de
  // prod (env faltando), estaríamos escrevendo na aba de PRODUÇÃO → recusa.
  assertNaoEhDefaultDeProd(sheetName, DEFAULT_SHEET_NAME, 'GOOGLE_SHEETS_TAB (aba da planilha)');
  return { spreadsheetId, sheetName };
}

// ─── Nomes de coluna conhecidos pelo sistema ─────────────────────────────────
//
// Esta lista é a FONTE DE VERDADE dos NOMES de coluna que o sistema lê/escreve —
// NÃO da posição. O mapeamento posição↔coluna é feito em tempo de execução lendo
// o cabeçalho REAL da planilha (linha 1), por NOME (ver `fetchHeaderMap`). Assim,
// reordenar/inserir colunas na planilha não quebra o sync — basta o NOME bater.
//
// A ordem abaixo apenas documenta o layout atual da aba 'GoDocs' (A→AV). As letras
// são só referência humana — a posição real é resolvida por NOME em runtime.
//
// ⚠️ "Diff Horas / Antes" e "Diff Saving / Antes" são preenchidas manualmente
// pela equipe — o sistema NUNCA escreve nelas. Já "Memorial anterior" (AI) É
// escrita pelo sistema, mas SÓ na edição: recebe o memorial_calculo da versão
// imediatamente anterior (ver sync.ts → row['Memorial anterior']).
//
// PAPÉIS DOS PARTICIPANTES (3): "Participantes" (H) guarda os COAUTORES (value interno
// `coexecutor`); "Participantes 2" (I) os PARTICIPANTES (value interno `planejador`);
// "Contribuidor" (J) os CONTRIBUIDORES (value interno `contribuidor`). Um participante
// aparece em exatamente UMA das três. Coluna sem ninguém → "—". Ver sync.ts
// (derivarColunasPapeis). Papéis legados idealizador/referencia_tecnica caem em Contribuidor.
export const SHEET_COLUMNS = [
  'Data Submissão',                 // A
  'ID Projeto',                     // B
  'Data Criação',                   // C
  'Área',                           // D
  'Nome Completo',                  // E
  'Email',                          // F
  'Projeto',                        // G
  'Coautor',                        // H  (papel "Coautor" — value interno coexecutor)
  'Participante',                   // I  (papel "Participante" — value interno planejador)
  'Contribuidor',                   // J  (papel "Contribuidor" — value interno contribuidor)
  'Descrição',                      // L
  'URL',                            // M
  'Ferramenta',                     // N
  'Escopo',                         // O
  'Tipos de Ganho',                 // P  (v2: as 4 categorias de ganho)
  'Alguém Fazia?',                  // Q
  // Nota de 0 a 5 dada pela TRIAGEM humana — coluna **manual**, como as de Diff: nenhum
  // fluxo automático a escreve (nem o append, nem o analisador, nem o sync reverso), e o
  // único ponto que grava aqui é a ficha do `/dashboard`. Está mapeada só para o
  // `updateRowByProjectId` poder alcançá-la por NOME. Valores fora de 0-5 existem em
  // linhas antigas (7, 8, 10) e são PRESERVADOS até alguém regravar a nota.
  'Estrelas',
  'Custo Evitado Horas',            // R  (v2: horas liberadas — o braço de horas)
  'Custo Evitado Horas Reais',      // S  (R$ das horas liberadas — bruto)
  'Saving Efetivado',               // T  (v2: quanto a despesa era ANTES)
  'Evidência Saving Efetivado',     // U
  'Freq. Saving Efetivado',         // V
  'Impacto Bruto',                  // W  (v2: S + CE + R, sem pesos)
  'Freq. Custo Evitado',            // X
  'Memorial de Saving',             // Y
  'Custo Externo Mensal',           // Z
  'Receita Incremental',            // AA
  'Freq. Receita',                  // AB
  'Racional Receita',               // AC
  'Status',                         // AD
  'Impacto Líquido',                // AE (v2: 1,0·S + 0,5·CE + 0,1·R − C)
  'Complexidade',                   // AF (preenchida pelo analisador)
  // Eixo TIPO da categorização (item 5.4): o que o projeto É — Agente · Sistema · App ·
  // Dashboard · Automação. Escrita pelo ANALISADOR (nunca pelo append, que a inicializa em
  // "—"), rótulo legível vindo de `tipoParaSheet`. ⚠️ NÃO confundir com "Tipos de Ganho"
  // (as 4 categorias de ganho) nem com "Complexidade" — que é o eixo NÍVEL do mesmo item
  // 5.4, reaproveitada in-place em vez de virar coluna nova.
  'Tipo de Projeto',
  'Diff Horas / Antes',             // AG (manual — não escrever)
  'Diff Saving / Antes',            // AH (manual — não escrever)
  'Memorial anterior',              // AI (escrita pelo sistema só na edição)
  'Observações',                    // AJ (preenchida pelo analisador)
  'Ganho Imensurável',              // AK (v2: o ganho que não tem número)
  'Especial?',                      // AL
  'Atualizado Em',                  // AM (carimbo da última escrita do sistema)
  'Alocação Ganhos',                // AN (justificativa [2.4] do gate ≥44h — fatiada do memorial)
  'Usa AI Proxy',                   // AO (governança: 'Sim'/'Não' declarado no formulário)
  // Custos do projeto: serviços externos pagos que a solução consome pra rodar (ABATE).
  'Custo para Rodar',                     // valor R$ (pontual e mensal pelo valor cheio, sem ÷12)
  'Justificativa Custo para Rodar',       // detalhamento por serviço (nome/valor/recorrência/just.)
  'Freq. Custo para Rodar',               // recorrência marcada (Mensal/Pontual/Misto)
  // Split do saving (transparência) — colunas NUMÉRICAS: 0 quando não se aplica.
  'Saving Horas Real',              // carga humana real do split
  'Saving Horas Escalado',          // ganho por escala do split
  // Justificativa do agente para o split (cálculo + gatilhos que levaram aos números
  // acima) — coluna de TEXTO: fatiada do memorial (subseção "Carga real e ganho por
  // escala", ponto [2.5]); "—" quando o split não se aplica. Posição resolvida por nome
  // em runtime (fetchHeaderMap), então a ordem aqui é só documentação.
  'Racional Custo Evitado',
  // Análise do antiagente (crítico adversarial — F5). Coluna de TEXTO: "—" quando
  // ainda não há análise (F5 a preenche depois). Já mapeada p/ não ficar em branco.
  'Análise Antiagente',
  // ─── Critério de projeto (recorrência · contrafactual · rastreabilidade) ────
  // ⚠️ "Motivo Reenvio" é MANUAL — preenchida pela TRIAGEM humana no /dashboard; o
  // sync do sistema NUNCA a escreve (mesmo tratamento das colunas de Diff). Está
  // mapeada aqui só para o /dashboard poder gravá-la por nome.
  'Motivo Reenvio',
  // Motivo da reprovação: escrito pelo sistema quando a classificação é "claro não"
  // (nunca reprova sem motivo) e sobreponível pela triagem. "—" quando não se aplica.
  'Motivo Reprovado',
  // Classificação de elegibilidade + justificativa, SEMPRE preenchida pelo sistema
  // ("Claro sim — …" / "Claro não — …" / "Zona cinzenta — …"). Edição manual desta
  // coluna é sobrescrita na próxima submissão/resync.
  'Classificação',
  // ─── Pré-aprovação do líder (TeamGuide) ─────────────────────────────────────
  // "Pendente com <líder>" no append; "Aprovado por <líder> em dd/mm/aaaa" /
  // "Reprovado por <líder> em dd/mm/aaaa — <motivo>" quando o líder decide no
  // GoDocs; "—" quando não se aplica (autor é liderança, ou não tem líder).
  // ⚠️ A coluna precisa existir no cabeçalho das abas GoDocs e STAGING (mapeamento
  // por NOME — se faltar, é ignorada com aviso). NÃO bloqueia a triagem da RPA.
  'Aprovação do Líder',
  // Detalhe do parecer: quem decidiu, quando, as 3 respostas do checklist e o
  // comentário. A coluna acima fica só com o ESTADO (Pré-aprovado/Pré-pendente/
  // Pré-reprovado) — decisão do Luis, 03/08/2026.
  'Justificativa Aprovação do Líder',
  // ─── GoDocs v2 — as 3 perguntas que a v1 nunca fez (BE, BF, BG) ─────────────
  // As demais colunas da v2 são RENOMEAÇÕES in-place das da v1 (a régua D1 trocou os
  // conceitos de nome: o `Custo Evitado` da v1 — a empresa pagava e parou — é o SAVING
  // EFETIVADO da v2, e o saving por HORAS da v1 é o CUSTO EVITADO da v2). Renomear
  // cabeçalho não move célula e o casamento é por NOME, então as 578 linhas antigas
  // seguem legíveis sob o nome novo.
  // ─── Vínculo entre projetos (aglutinação, item 5.3) ─────────────────────────
  // Já existiam no cabeçalho da STAGING-V2 (BC/BD) antes deste código: o `ID Pai` fica na
  // linha do FILHO e o `ID Feature` na linha do PAI. ⚠️ Escritas SÓ pelo ACEITE humano no
  // painel de aglutinação — a sugestão do agente mora numa tabela INTERNA, porque palpite
  // gravado na planilha é indistinguível de fato declarado para quem lê depois.
  'ID Pai',
  'ID Feature',
  'Saving Efetivado Agora',         // BE (a 2ª ponta do par; o saving é a DIFERENÇA)
  'Custo Evitado Não Contratado',   // BF (a vaga não aberta, a consultoria não contratada)
  'Impacto Líquido Mensal',         // BG (o líquido normalizado no tempo — vai ao Gomoon)
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetRow = Partial<Record<SheetColumn, string>>;

// Índice 0-based → letra da coluna (0→A, 25→Z, 26→AA, 27→AB...).
export function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ─── Mapeamento por NOME a partir do cabeçalho real ──────────────────────────
//
// Lê a linha 1 da aba e devolve os nomes na ORDEM real + o mapa nome→letra. É a
// peça que torna o sync robusto a reordenação/inserção manual de colunas: nada
// aqui depende de posição fixa.
export type HeaderMap = {
  headers: string[];
  letterByName: Record<string, string>;
  /** Índice TOLERANTE (nome normalizado → letra). Ver `chaveColuna`. */
  letterByKey: Record<string, string>;
};

// A regra de casamento de nome de coluna vive em `@/lib/coluna-chave` (módulo PURO):
// o CLIENTE também precisa dela para achar a coluna do parecer do líder na ficha de
// triagem, e este arquivo é server-only (importa `./auth`). Reexportada aqui porque os
// chamadores e os testes de sempre a esperam neste módulo.
export { chaveColuna };

/**
 * Índice normalizado nome→X a partir de uma lista de nomes. Chave AMBÍGUA (dois
 * nomes distintos que normalizam igual) é DESCARTADA — fail-safe: melhor não
 * casar do que gravar na coluna errada.
 */
function indexarPorChave<T>(nomes: string[], valor: (nome: string, i: number) => T): Record<string, T> {
  const vezes = new Map<string, number>();
  for (const n of nomes) {
    if (!n) continue;
    const k = chaveColuna(n);
    vezes.set(k, (vezes.get(k) ?? 0) + 1);
  }
  const out: Record<string, T> = {};
  nomes.forEach((n, i) => {
    if (!n) return;
    const k = chaveColuna(n);
    // >1 = ambíguo (ou nome repetido): quem resolve é o match EXATO, não este índice.
    if (vezes.get(k) !== 1 || k in out) return;
    out[k] = valor(n, i);
  });
  return out;
}

/**
 * Resolve a letra da coluna: match EXATO primeiro (comportamento de sempre),
 * tolerante (acento/caixa/espaço) como rede. `undefined` = coluna não existe.
 */
export function resolverColunaLetra(map: HeaderMap, nome: string): string | undefined {
  return map.letterByName[nome] ?? map.letterByKey[chaveColuna(nome)];
}

export async function fetchHeaderMap(token: string, spreadsheetId: string, sheetName: string): Promise<HeaderMap> {
  const range = `'${sheetName}'!1:1`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets header read falhou (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as { values?: string[][] };
  const headers = (data.values?.[0] ?? []).map((h) => String(h ?? '').trim());
  const letterByName: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h && !(h in letterByName)) letterByName[h] = colLetter(i);
  });
  const letterByKey = indexarPorChave(headers, (_n, i) => colLetter(i));
  return { headers, letterByName, letterByKey };
}

// Ordena os valores (mapa nome→valor) conforme a ORDEM real do cabeçalho. Colunas
// sem valor entram vazias (preserva alinhamento). Função pura — testável.
//
// O casamento header↔valor é o mesmo do update: EXATO primeiro, tolerante a
// acento/caixa depois (`chaveColuna`) — senão o append repetiria o bug da coluna
// "Justificativa Aprovação do Lider".
export function orderValuesByHeaders(
  headers: string[],
  values: Partial<Record<string, string | number>>,
): (string | number)[] {
  const nomePorChave = indexarPorChave(Object.keys(values), (n) => n);
  // Cabeçalho ambíguo (2 colunas que normalizam igual) NÃO recebe valor pelo índice
  // tolerante — as duas casariam com a mesma chave e o valor seria escrito 2×.
  const chavePorHeader = indexarPorChave(headers, (n) => n);
  return headers.map((h) => {
    const chave = chaveColuna(h);
    const ambiguo = chavePorHeader[chave] == null;
    const nome = h in values ? h : ambiguo ? undefined : nomePorChave[chave];
    const v = nome == null ? undefined : values[nome];
    return v == null ? '' : v;
  });
}

/**
 * Nomes de coluna que o chamador mandou e o cabeçalho real NÃO tem (nem por match
 * tolerante) — os únicos que serão ignorados de fato. Puro, para o aviso do append.
 */
export function chavesForaDoCabecalho(
  headers: string[],
  values: Partial<Record<string, string | number>>,
): string[] {
  const letterByKey = indexarPorChave(headers, (_n, i) => colLetter(i));
  const map: HeaderMap = {
    headers,
    letterByName: Object.fromEntries(headers.map((h, i) => [h, colLetter(i)])),
    letterByKey,
  };
  return Object.keys(values).filter(
    (k) => values[k] != null && resolverColunaLetra(map, k) == null,
  );
}

// ─── Append: adiciona nova linha ao final da planilha ────────────────────────
//
// Recebe um mapa header→valor e o alinha à ordem REAL do cabeçalho (por nome).
// Colunas ausentes entram vazias. Chaves que não existem no cabeçalho são
// ignoradas (com aviso) — nunca escrevem na coluna errada.
export async function appendRow(values: Partial<Record<SheetColumn, string | number>>): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  const { headers } = await fetchHeaderMap(token, spreadsheetId, sheetName);
  if (headers.length === 0) {
    throw new Error('Sheets append abortado: cabeçalho da planilha está vazio.');
  }

  for (const key of chavesForaDoCabecalho(headers, values)) {
    console.warn(`[google/sheets] Coluna "${key}" não existe no cabeçalho da planilha — valor ignorado no append.`);
  }

  const rowValues = orderValuesByHeaders(headers, values);
  const range = `'${sheetName}'!A:${colLetter(headers.length - 1)}`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [rowValues] }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets append falhou (${resp.status}): ${text}`);
  }
}

// ─── Read: lê todas as linhas de dados da aba (Sheets → app) ─────────────────
//
// Usado pelo sync reverso (planilha = fonte de verdade) para atualizar o SQLite.
// Cada célula é chaveada pelo NOME REAL da coluna no cabeçalho (linha 1) — robusto
// a reordenação. Pula o cabeçalho e linhas totalmente vazias; só inclui células
// não-vazias.
export async function readAllRows(): Promise<SheetRow[]> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // Lê o bloco inteiro de A1 em diante; a 1ª linha é o cabeçalho real.
  const range = `'${sheetName}'!A1:ZZ`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets read falhou (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  if (rows.length < 2) return []; // só cabeçalho (ou vazia)

  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());

  const out: SheetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const v = row[idx];
      if (v != null && String(v).trim() !== '') obj[header] = String(v);
    });
    out.push(obj as SheetRow);
  }
  return out;
}

// ─── Update: atualiza linha existente por ID Projeto ─────────────────────────
//
// O ID é estável e único (ex.: 'legado-270'), então não quebra se o nome do
// projeto mudar. Tanto a coluna do ID quanto as colunas a atualizar são
// resolvidas por NOME a partir do cabeçalho real — robusto a reordenação.
// Atualiza apenas as colunas informadas; as demais (inclusive manuais) ficam
// intactas.
//
// Retorno: `false` SOMENTE no caminho "ID Projeto não encontrado na planilha" —
// isto é, a linha não existe e há uma recuperação possível (o chamador pode cair
// para `appendRow`, como faz a IDA em `google/sync.ts`). Todos os outros
// desfechos devolvem `true` = "nada a recuperar": sucesso, nenhuma coluna
// gravável, e também o abort por cabeçalho sem a coluna "ID Projeto" (aí não se
// pode afirmar que a linha falta, e apendar arriscaria duplicar). O retorno é
// ADITIVO — os chamadores que o ignoram seguem com o comportamento de antes.
// ⚠️ Nenhuma leitura extra do Sheets: a busca do ID já acontecia aqui.
export async function updateRowByProjectId(
  projetoId: string,
  updates: Partial<Record<SheetColumn, string | number>>,
): Promise<boolean> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // 0. Resolver as letras das colunas pelo cabeçalho real (exato, com rede
  //    tolerante a acento/caixa — ver `resolverColunaLetra`).
  const mapa = await fetchHeaderMap(token, spreadsheetId, sheetName);
  const idCol = resolverColunaLetra(mapa, 'ID Projeto');
  if (!idCol) {
    console.warn('[google/sheets] Coluna "ID Projeto" não encontrada no cabeçalho — update abortado.');
    return true; // sem a coluna do ID não se afirma que a linha falta → nada a recuperar
  }

  // 1. Ler a coluna do ID para achar o número da linha.
  const searchRange = `'${sheetName}'!${idCol}:${idCol}`;
  const searchUrl = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(searchRange)}`;

  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchResp.ok) {
    const text = await searchResp.text();
    throw new Error(`Sheets read falhou (${searchResp.status}): ${text}`);
  }

  const searchData = (await searchResp.json()) as { values?: string[][] };
  const rows = searchData.values ?? [];

  // Encontrar a linha (1-indexed; pula header na posição 0). Match case-insensitive:
  // linhas legadas inseridas na mão usam ID em MAIÚSCULAS (ex.: "LEGADO-270"),
  // enquanto o ID do banco é minúsculo ("legado-270").
  const alvo = projetoId.trim().toLowerCase();
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0]?.trim().toLowerCase() === alvo) {
      rowNumber = i + 1; // Sheets é 1-indexed
      break;
    }
  }

  if (rowNumber === -1) {
    console.warn(`[google/sheets] ID Projeto "${projetoId}" não encontrado na planilha para update`);
    return false; // linha ausente — o chamador pode recuperar por append
  }

  // 2. Montar ranges/valores para o batch update (coluna resolvida por nome).
  const data: { range: string; values: (string | number)[][] }[] = [];
  for (const [columnName, value] of Object.entries(updates)) {
    if (value == null) continue;
    const col = resolverColunaLetra(mapa, columnName);
    if (!col) {
      console.warn(`[google/sheets] Coluna "${columnName}" não existe no cabeçalho da planilha, pulando`);
      continue;
    }
    data.push({
      range: `'${sheetName}'!${col}${rowNumber}`,
      values: [[value]],
    });
  }

  if (data.length === 0) return true; // a linha existe; só não havia coluna gravável

  // 3. Batch update.
  const batchUrl = `${BASE_URL}/${spreadsheetId}/values:batchUpdate`;
  const batchResp = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });

  if (!batchResp.ok) {
    const text = await batchResp.text();
    throw new Error(`Sheets batch update falhou (${batchResp.status}): ${text}`);
  }

  return true; // linha encontrada e atualizada
}
