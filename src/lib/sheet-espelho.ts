/**
 * ESPELHO da planilha dentro do SQLite (server-only).
 *
 * ## Por que existe
 * As telas de listagem liam o Google Sheets **em tempo de request**: `listarMeusProjetos`
 * fazia um `readAllRows()` da planilha INTEIRA por load de página (~2 s, e a cota de 60
 * leituras/min é compartilhada com prod), e a triagem do `/dashboard` escondia a mesma
 * leitura atrás de um cache de 60 s com SWR. Aqui a planilha é copiada para uma tabela
 * (`sheet_espelho`) pelo sync reverso, e as telas leem SÓ daqui.
 *
 * ## O que NÃO muda
 * A planilha continua **fonte da verdade** e o **único lugar onde se edita**. O espelho é
 * derivado: pode ser apagado e o próximo sync o reconstrói. Ele guarda a **linha crua**
 * (chaveada pelo nome REAL da coluna), então `mapResumo`, a ficha de triagem e o parser do
 * parecer do líder continuam trabalhando sobre um `SheetRow` — nenhuma regra de negócio
 * mudou de lugar.
 *
 * ## As duas invariantes que fazem isto ser seguro
 * 1. **Toda escrita nossa na planilha remenda o espelho na hora** (`espelharEscrita`) —
 *    senão uma submissão nova ficaria sem Status até o próximo cron. O cron é a REDE:
 *    esquecer um ponto de escrita custa ≤5 min de atraso, não uma mentira permanente.
 * 2. **O remendo sobrevive a um sync que começou antes dele** (`patch`/`escrito_em`) — a
 *    escrita e a releitura correm juntas, e um sync que leu a célula ANTIGA instalaria o
 *    valor velho por cima do que a triagem acabou de gravar ("o status voltava atrás").
 *    Era o que os `patchesEscritos` em memória faziam no dashboard-admin — agora vale para
 *    qualquer isolate, porque mora no banco.
 */
import type { SheetColumn, SheetRow } from '@/lib/google/sheets';
import { recortarResumo, VERSAO_RECORTE_RESUMO } from '@/lib/dashboard-resumo';
import {
  getEspelhoIndice,
  getEspelhoLinha,
  getEspelhoLinhasPorIds,
  getEspelhoResumos,
  upsertEspelhoLinha,
  deleteEspelhoLinha,
  getUltimaSyncRun,
  getUltimaSyncRunOk,
} from '@/integrations/db/client.server';

/** Chave do espelho: o "ID Projeto" em minúsculas (legado na planilha vem em MAIÚSCULAS). */
export function chaveProjeto(id: string): string {
  return String(id ?? '').trim().toLowerCase();
}

/**
 * Impressão digital do conteúdo da linha — é ela que evita escrita à toa: com o cron de 5
 * min, linha que não mudou não gera UPDATE, então o custo em regime é ~1 leitura da
 * planilha e zero escritas.
 *
 * FNV-1a em duas variantes concatenadas (~64 bits). Não é criptográfico de propósito:
 * `crypto.subtle` é assíncrono e isto roda ~600× por corrida. Uma colisão significaria
 * "achamos que nada mudou" até a próxima edição daquela linha — risco aceito e declarado.
 *
 * ⚠️ A `VERSAO_RECORTE_RESUMO` entra no hash: o `linha_resumo` é DERIVADO do recorte, então
 * coluna nova na listagem precisa de um re-espelhamento único — sem isso, linha que ninguém
 * editou ficaria com o recorte antigo e a coluna nasceria vazia na tela para sempre.
 */
export function hashLinha(row: Record<string, string>): string {
  const canonico = JSON.stringify([
    VERSAO_RECORTE_RESUMO,
    Object.keys(row)
      .sort()
      .map((k) => [k, row[k]]),
  ]);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonico.length; i++) {
    const c = canonico.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Carimbo (ISO com Z, ou `datetime('now')` do SQLite = `YYYY-MM-DD HH:MM:SS` em UTC sem Z)
 * → epoch ms. O sufixo `Z` é acrescentado no 2º formato: sem ele o JS interpretaria como
 * hora LOCAL e a comparação com `Date.now()` erraria por 3 h (o fuso do Fortaleza),
 * fazendo um remendo recente parecer antigo.
 */
export function carimboEspelhoMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const normalizado = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  const ms = Date.parse(normalizado);
  return Number.isFinite(ms) ? ms : null;
}

function agoraIso(): string {
  return new Date().toISOString();
}

/** Valores de escrita (número/string) → mapa de células string, ignorando ausentes. */
function normalizarValores(
  valores: Partial<Record<SheetColumn | string, string | number | null | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, v] of Object.entries(valores)) {
    if (v == null) continue;
    out[col] = String(v);
  }
  return out;
}

function parseLinha(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ─── Escrita pelo SYNC (planilha → espelho) ──────────────────────────────────

export type ResultadoEspelho = { espelhados: number; ignorados: number; erros: number };

/**
 * Espelha as linhas lidas da planilha.
 *
 * @param rows     linhas cruas (`readAllRows`) — as sem "ID Projeto" são ignoradas
 * @param inicioMs epoch em que a LEITURA da planilha começou. É o que decide se um remendo
 *                 nosso é mais novo que o snapshot em mãos: `escrito_em >= inicioMs`
 *                 significa que gravamos DEPOIS de a leitura começar, então a célula que
 *                 veio pode ser a antiga → o `patch` é reaplicado por cima e preservado.
 *                 Remendo mais VELHO que a leitura já está refletido na planilha (ou foi
 *                 legitimamente sobrescrito pela triagem) → o patch é descartado.
 */
export async function espelharLinhas(
  rows: ReadonlyArray<SheetRow>,
  inicioMs: number,
): Promise<ResultadoEspelho> {
  const r: ResultadoEspelho = { espelhados: 0, ignorados: 0, erros: 0 };
  const indice = new Map(
    (await getEspelhoIndice()).map((e) => [
      e.projeto_id,
      { hash: e.linha_hash, patch: e.patch, escritoEm: e.escrito_em },
    ]),
  );
  const lidoEm = agoraIso();

  for (const row of rows) {
    const id = chaveProjeto((row as Record<string, string>)['ID Projeto'] ?? '');
    if (!id) continue;
    try {
      const atual = indice.get(id);
      const escritoMs = carimboEspelhoMs(atual?.escritoEm);
      // Remendo mais novo que o início da leitura → a planilha pode não tê-lo ainda.
      const remendoVivo = escritoMs != null && escritoMs >= inicioMs;
      const patchVivo = remendoVivo ? parseLinha(atual?.patch) : {};

      const daPlanilha = normalizarValores(row as Record<string, string>);
      const linha = { ...daPlanilha, ...patchVivo };
      const hash = hashLinha(linha);

      // Nada mudou E não há remendo a preservar/limpar → não escreve (é o que deixa o cron
      // de 5 min barato). Quando havia remendo e ele expirou, precisamos gravar para zerar
      // o patch, mesmo com o hash igual.
      const patchAExpirar = atual?.patch != null && !remendoVivo;
      if (atual && atual.hash === hash && !patchAExpirar) {
        r.ignorados++;
        continue;
      }

      await upsertEspelhoLinha({
        projeto_id: id,
        linha: JSON.stringify(linha),
        linha_resumo: JSON.stringify(recortarResumo(linha as SheetRow)),
        linha_hash: hash,
        patch: remendoVivo ? JSON.stringify(patchVivo) : null,
        escrito_em: remendoVivo ? (atual?.escritoEm ?? null) : null,
        lido_em: lidoEm,
      });
      r.espelhados++;
    } catch (e) {
      r.erros++;
      console.error(`[sheet-espelho] falha ao espelhar ${id}:`, e);
    }
  }
  return r;
}

/**
 * Remove do espelho os projetos que não estão mais na planilha — é o que faz o projeto
 * apagado da aba desaparecer das telas (antes ele ficava "cinza" na lista do usuário).
 *
 * ⚠️ Chame SÓ com uma leitura bem-sucedida e não-vazia: `idsPlanilha` é o denominador da
 * verdade, e um conjunto vazio significaria "apague tudo".
 */
export async function removerEspelhoAusentes(idsPlanilha: ReadonlySet<string>): Promise<number> {
  if (idsPlanilha.size === 0) return 0;
  let removidos = 0;
  for (const e of await getEspelhoIndice()) {
    if (idsPlanilha.has(e.projeto_id)) continue;
    try {
      await deleteEspelhoLinha(e.projeto_id);
      removidos++;
    } catch (err) {
      console.error(`[sheet-espelho] falha ao remover ${e.projeto_id} do espelho:`, err);
    }
  }
  return removidos;
}

// ─── Escrita pelo APP (nossa escrita na planilha → remendo no espelho) ───────

/**
 * Remenda no espelho as células que ACABAMOS de gravar na planilha.
 *
 * Chamada por todo caminho que escreve no Sheets (triagem de status, descontinuar, IDA da
 * submissão, analisador, colunas do líder). Sem ela, o efeito da ação só apareceria na tela
 * depois do próximo cron — uma submissão nova nasceria sem Status.
 *
 * Nunca lança: um espelho desatualizado é conserto do próximo sync, e derrubar a ação do
 * usuário por causa do espelho seria trocar um problema pequeno por um grande.
 *
 * @param novaLinha `true` quando a linha está NASCENDO na planilha (append da submissão):
 *                  aí `valores` é a linha inteira e substitui o que houver.
 */
export async function espelharEscrita(
  projetoId: string,
  valores: Partial<Record<SheetColumn | string, string | number | null | undefined>>,
  opts?: { novaLinha?: boolean },
): Promise<void> {
  const id = chaveProjeto(projetoId);
  if (!id) return;
  try {
    const celulas = normalizarValores(valores);
    if (Object.keys(celulas).length === 0) return;

    const atual = opts?.novaLinha ? undefined : await getEspelhoLinha(id);
    const base = atual ? parseLinha(atual.linha) : {};
    const linha = { ...base, ...celulas, 'ID Projeto': base['ID Projeto'] ?? celulas['ID Projeto'] ?? projetoId };
    // O patch acumula as células que NÓS gravamos desde o último sync que as absorveu.
    const patch = { ...(atual ? parseLinha(atual.patch) : {}), ...celulas };

    await upsertEspelhoLinha({
      projeto_id: id,
      linha: JSON.stringify(linha),
      linha_resumo: JSON.stringify(recortarResumo(linha as SheetRow)),
      linha_hash: hashLinha(linha),
      patch: JSON.stringify(patch),
      escrito_em: agoraIso(),
      // `lido_em` continua sendo o carimbo da última vez que a PLANILHA foi lida: quem
      // mede a idade do espelho é o sync, não a nossa escrita.
      lido_em: atual?.lido_em ?? agoraIso(),
    });
  } catch (e) {
    console.error(`[sheet-espelho] falha ao remendar ${id} (o próximo sync corrige):`, e);
  }
}

// ─── Leitura pelas TELAS ─────────────────────────────────────────────────────

/**
 * Resumos de TODOS os projetos (listagem do `/dashboard`), já como `SheetRow` — quem
 * transforma em `ProjetoDashboardResumo` é o `mapResumo`, como antes.
 *
 * ⚠️ Só o `linha_resumo` (JSON curto) é selecionado: puxar a `linha` completa de ~600
 * projetos numa consulta é o anti-padrão de payload que derrubou o Investigador.
 */
export async function lerResumosEspelho(): Promise<{ linhas: SheetRow[]; lidoEmMs: number | null }> {
  const rows = await getEspelhoResumos();
  let lidoEmMs: number | null = null;
  const linhas: SheetRow[] = [];
  for (const r of rows) {
    linhas.push(parseLinha(r.linha_resumo) as SheetRow);
    const ms = carimboEspelhoMs(r.lido_em);
    if (ms != null && (lidoEmMs == null || ms > lidoEmMs)) lidoEmMs = ms;
  }
  return { linhas, lidoEmMs };
}

/** Linha COMPLETA de um projeto (ficha de triagem). `null` = não está na planilha. */
export async function lerLinhaEspelho(projetoId: string): Promise<SheetRow | null> {
  const row = await getEspelhoLinha(chaveProjeto(projetoId));
  return row ? (parseLinha(row.linha) as SheetRow) : null;
}

/**
 * Linhas completas de um conjunto de projetos, por id em minúsculas — é o que "Meus
 * Projetos" usa para pegar Status/motivos/"Atualizado Em" dos projetos DAQUELE usuário
 * (uma consulta com `IN`, nunca a tabela inteira e nunca uma leitura da planilha).
 */
export async function lerLinhasEspelho(projetoIds: string[]): Promise<Map<string, SheetRow>> {
  const out = new Map<string, SheetRow>();
  for (const r of await getEspelhoLinhasPorIds(projetoIds)) {
    out.set(r.projeto_id, parseLinha(r.linha) as SheetRow);
  }
  return out;
}

// ─── Saúde do espelho ────────────────────────────────────────────────────────

export type StatusEspelho = {
  /** Início da última corrida BEM-SUCEDIDA (define a idade real do espelho). */
  ultimoSyncOkMs: number | null;
  /** Idade do espelho em ms — `null` quando nunca sincronizou. */
  idadeMs: number | null;
  /** A última corrida falhou? (a anterior pode ter dado certo) */
  ultimaFalhou: boolean;
  ultimaRun: {
    gatilho: string;
    ok: boolean;
    total: number | null;
    espelhados: number | null;
    criados: number | null;
    atualizados: number | null;
    removidos: number | null;
    erros: number | null;
    duracaoMs: number | null;
    detalhe: string | null;
    iniciadoEm: string | null;
  } | null;
};

/**
 * Saúde do espelho — alimenta o "espelho de HH:MM" do `/dashboard` e a rota de
 * diagnóstico. O risco desta arquitetura é o sync morrer em silêncio e a tela seguir
 * mostrando dado velho como se fosse novo: é isto que o torna visível.
 */
export async function statusEspelho(): Promise<StatusEspelho> {
  const [ultima, ultimaOk] = await Promise.all([getUltimaSyncRun(), getUltimaSyncRunOk()]);
  const ultimoSyncOkMs = carimboEspelhoMs(ultimaOk?.iniciado_em);
  return {
    ultimoSyncOkMs,
    idadeMs: ultimoSyncOkMs == null ? null : Math.max(0, Date.now() - ultimoSyncOkMs),
    ultimaFalhou: ultima != null && ultima.ok !== 1,
    ultimaRun: ultima
      ? {
          gatilho: ultima.gatilho,
          ok: ultima.ok === 1,
          total: ultima.total,
          espelhados: ultima.espelhados,
          criados: ultima.criados,
          atualizados: ultima.atualizados,
          removidos: ultima.removidos,
          erros: ultima.erros,
          duracaoMs: ultima.duracao_ms,
          detalhe: ultima.detalhe,
          iniciadoEm: ultima.iniciado_em,
        }
      : null,
  };
}
