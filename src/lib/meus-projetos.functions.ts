// Funções de negócio para "Meus Projetos" — lista e detalhe de projetos do usuário.
// O email do solicitante vem SEMPRE do header Godeploy (nunca do body/query).

import {
  getProjetosByOwnerEmail,
  getProjetoWithRelations,
  getProjetoById,
  getLatestVersionByProjeto,
  getChatMessages,
  excluirProjetoCascade,
  updateProjeto,
  parseJson,
} from '@/integrations/db/client.server';
import type { ProjetoRow } from '@/integrations/db/client.server';
import { syncOwnerRowsFromSheet } from '@/lib/google/sync-reverse';
import { isAdmin } from '@/lib/auth.functions';

export type MeuProjetoItem = {
  id: string;
  nome: string | null;
  status: string | null;
  tipos_projeto: string[];
  especial: boolean;
  area_nome: string | null;
  ganho_total_mensal: number | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  arquivos_nomes: string[];
  // "Atualizado Em" do Sheets (carimbo da última escrita do sistema). Vazio = o app
  // nunca escreveu na planilha p/ este projeto = legado pendente de edição.
  atualizado_em: string | null;
  // Legado pendente: submetido (não-rascunho) mas sem "Atualizado Em" no Sheets →
  // precisa ser editado/reenviado até o prazo para regularizar.
  pendente: boolean;
  // Papel do usuário neste projeto: 'owner' (submeteu) ou 'participante' (está nos
  // membros). NÃO determina sozinho a edição — um participante pode ser editor
  // delegado (ver `podeEditar`).
  papel: Papel;
  // Este usuário pode editar/reenviar o projeto? true = owner OU editor delegado.
  // (Na lista de "Meus Projetos" só há owner/participante, então true ⟺ owner|delegado.)
  podeEditar: boolean;
  // Participantes do projeto (emails, caso original preservado) — usados pelo dono/
  // editor delegado no popup de distribuição do poder de edição.
  membros: string[];
  // Participantes a quem o poder de edição foi delegado (subconjunto de `membros`).
  editores_delegados: string[];
  // Autoria (para exibir nos cards e no tooltip de transferência de autoria).
  responsavel_nome: string | null;
  responsavel_email: string | null;
};

// Prazo para regularizar legados (editar/reenviar até deixar de ter "Atualizado Em" vazio).
export const PRAZO_LEGADO = '30/06/2026';

export type VersaoSnapshot = {
  versao_num: number;
  acao: string;
  snapshot_projeto: {
    nome: string | null;
    descricao_breve: string | null;
    ferramenta: string | null;
    tipos_projeto: string[];
    area: string | null;
    saving_horas: number | null;
    saving_reais: number | null;
    tipo_saving: string | null;
    memorial_calculo: string | null;
    ganho_total_mensal: number | null;
    custo_externo_mensal: number | null;
    alguem_fazia: string | null;
  };
  snapshot_doc: {
    saving?: { memorial_calculo?: string | null };
    receita?: { memorial_calculo?: string | null };
  } | null;
  created_at: string | null;
};

export type MeuProjetoDetalhes = MeuProjetoItem & {
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  escopo: string | null;
  servico_externo: string | null;
  membros: string[];
  nome_projeto: string | null;
  data_criacao_projeto: string | null;
  descricao_breve: string | null;
  // Usa o AI Proxy interno? Necessário para o seed da EDIÇÃO repopular a etapa 2.
  usa_ai_proxy: string | null;
  contexto_especial: string | null;
  tipo_saving: string | null;
  saving_horas: number | null;
  saving_reais: number | null;
  custo_externo_mensal: number | null;
  alguem_fazia: string | null;
  // Custo evitado: necessários para o seed da EDIÇÃO repopular a etapa de saving
  // (sem eles a edição reabre a etapa de custo evitado em branco). 'sim'/'nao',
  // justificativa concatenada e itens (JSON [{nome,valor,recorrencia,justificativa}]).
  custo_evitado: string | null;
  custo_evitado_justificativa: string | null;
  custo_evitado_itens: string | null;
  memorial_calculo: string | null;
  documentacao: unknown | null;
  ultima_versao: VersaoSnapshot | null;
  // Pode editar? true = owner, editor delegado, ou admin RPA (sem ser participante).
  podeEditar: boolean;
};

// OWNER = quem submeteu (responsavel_email). Só o owner edita.
export function ehOwner(projeto: ProjetoRow, email: string): boolean {
  return (projeto.responsavel_email ?? '').trim().toLowerCase() === email.trim().toLowerCase();
}

// PARTICIPANTE = está na lista de membros, mas NÃO é o owner. Só visualiza.
export function ehParticipante(projeto: ProjetoRow, email: string): boolean {
  if (ehOwner(projeto, email)) return false;
  const alvo = email.trim().toLowerCase();
  const membros = parseJson<string[]>(projeto.membros) ?? [];
  return membros.some((m) => m.trim().toLowerCase() === alvo);
}

// Tem acesso de LEITURA (owner ou participante). Edição é do owner OU de um editor
// delegado (ehEditorDelegado).
export function temAcesso(projeto: ProjetoRow, email: string): boolean {
  return ehOwner(projeto, email) || ehParticipante(projeto, email);
}

// EDITOR DELEGADO = participante (membro) a quem o dono delegou o poder de edição
// (lista em `editores_delegados`). Pode editar/reenviar "como se fosse o dono".
// Interseção defensiva com `membros`: se a pessoa sai de `membros` (ex.: editado no
// Sheets), a delegação deixa de valer sozinha. O owner nunca é delegado (o poder dele
// vem de ehOwner) — a sanitização em `definirEditoresDelegados` já o remove da lista.
export function ehEditorDelegado(projeto: ProjetoRow, email: string): boolean {
  if (ehOwner(projeto, email)) return false;
  const alvo = email.trim().toLowerCase();
  if (!alvo) return false;
  const membros = parseJson<string[]>(projeto.membros) ?? [];
  if (!membros.some((m) => m.trim().toLowerCase() === alvo)) return false;
  const delegados = parseJson<string[]>(projeto.editores_delegados) ?? [];
  return delegados.some((d) => d.trim().toLowerCase() === alvo);
}

export type Papel = 'owner' | 'participante';

// "Atualizado Em" preenchido? Trata vazio/"—"/"-" como ausente (= legado pendente).
export function temAtualizadoEm(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v).trim();
  return s !== '' && s !== '—' && s !== '-';
}

// Resolve o "Atualizado Em" efetivo de um projeto: prefere o carimbo da PLANILHA
// (Sheets é a fonte da verdade) QUANDO preenchido; se a célula está vazia/ausente,
// cai no espelho SQLite. ⚠️ Crítico logo após uma edição — o submit grava o espelho
// SQLite na hora, mas o sync IDA para o Sheets roda em background; sem este fallback,
// a célula ainda vazia da planilha mantinha o legado como "pendente" até o sync
// terminar (exigia hard-refresh). Alinha com contarPendentes, que decide pelo SQLite.
export function resolverAtualizadoEm(
  sheetAt: string | null | undefined,
  sqliteAt: string | null | undefined,
): string | null {
  return temAtualizadoEm(sheetAt) ? sheetAt! : (sqliteAt ?? null);
}

// Projeto LEGADO? Só os ids no padrão "LEGADO-233" (importados antes do formulário)
// contam como pendentes. Projetos submetidos pelo app têm id aleatório (hex) e NUNCA
// são pendentes, mesmo sem "Atualizado Em" — a pendência só vale para regularizar legado.
function ehLegado(id: string): boolean {
  return id.toLowerCase().includes('legado');
}

function mapItem(
  p: ProjetoRow & { area_nome: string | null },
  atualizadoEm: string | null,
  papel: Papel,
  podeEditar: boolean,
  statusSheet?: string | null,
): MeuProjetoItem {
  const at = temAtualizadoEm(atualizadoEm) ? atualizadoEm : null;
  return {
    id: p.id,
    nome: p.nome,
    // O status SEMPRE vem da planilha (FONTE DA VERDADE) — nunca do SQLite.
    // - Rascunho é estado interno do app (nunca vai ao Sheets) → mantém 'rascunho'.
    // - Submetido: usa o "Status" do Sheets, normalizado p/ a chave do StatusBadge
    //   ("Pendente" → "pendente"). Se o projeto NÃO está na planilha (gap de sync) ou
    //   a leitura falhou, fica `null` → badge mostra "—" (NÃO cai no status do SQLite).
    // ⚠️ Hoje o Sheets grava sempre "Pendente" (regra TEMPORÁRIA), então submetidos
    // aparecem como "Pendente" até a regra ser encerrada.
    status:
      p.status === 'rascunho'
        ? 'rascunho'
        : statusSheet && statusSheet.trim()
          ? statusSheet.trim().toLowerCase()
          : null,
    tipos_projeto: parseJson<string[]>(p.tipos_projeto) ?? [],
    especial: p.especial === 1,
    area_nome: p.area_nome ?? p.area ?? null,
    ganho_total_mensal: p.ganho_total_mensal,
    created_at: p.created_at,
    updated_at: p.updated_at,
    submitted_at: p.submitted_at,
    arquivos_nomes: parseJson<string[]>(p.arquivos_nomes) ?? [],
    atualizado_em: at,
    // Pendente = LEGADO (id "LEGADO-…") e sem "Atualizado Em" no Sheets → precisa ser
    // editado/reenviado para regularizar. Owner E participante veem a pendência (a
    // mensagem na UI difere por papel: só o owner pode regularizar). O selo da home
    // (contarPendentes) segue contando só os do owner — é a lista de ações dele.
    pendente: ehLegado(p.id) && !at,
    papel,
    podeEditar,
    membros: parseJson<string[]>(p.membros) ?? [],
    editores_delegados: parseJson<string[]>(p.editores_delegados) ?? [],
    responsavel_nome: p.responsavel_nome ?? null,
    responsavel_email: p.responsavel_email ?? null,
  };
}

export async function listarMeusProjetos(email: string): Promise<MeuProjetoItem[]> {
  // Sheets é a fonte da verdade: antes de listar, espelha do Sheets os projetos
  // deste usuário (legados que só existem na planilha, edições manuais). Falha de
  // leitura da planilha não pode quebrar a tela — cai de volta no SQLite.
  // Reaproveita as linhas lidas para mapear o "Atualizado Em" de cada projeto.
  const atualizadoMap = new Map<string, string>();
  const statusMap = new Map<string, string>();
  try {
    const { rows } = await syncOwnerRowsFromSheet(email);
    for (const r of rows) {
      const id = (r['ID Projeto'] ?? '').trim().toLowerCase();
      if (id) {
        atualizadoMap.set(id, (r['Atualizado Em'] ?? '').trim());
        statusMap.set(id, (r['Status'] ?? '').trim());
      }
    }
  } catch (e) {
    console.error('[meus-projetos] sync sob demanda falhou, usando SQLite:', e);
  }
  const rows = await getProjetosByOwnerEmail(email);
  // Refiltro em JS para evitar falso-positivo de LIKE com emails que são substring de outro.
  // "Status": usa o valor recém-lido da planilha (Sheets é a fonte da verdade).
  // "Atualizado Em": resolverAtualizadoEm — planilha quando preenchida, senão o espelho
  // SQLite (ver nota na função). Garante que um legado recém-editado deixe de aparecer
  // como pendente sem esperar o sync IDA para o Sheets.
  return rows
    .filter((p) => temAcesso(p, email))
    .map((p) =>
      mapItem(
        p,
        resolverAtualizadoEm(atualizadoMap.get(p.id.toLowerCase()), p.atualizado_em),
        ehOwner(p, email) ? 'owner' : 'participante',
        // Na lista (só owner/participante), pode editar = owner OU editor delegado.
        ehOwner(p, email) || ehEditorDelegado(p, email),
        statusMap.get(p.id.toLowerCase()) ?? null,
      ),
    );
}

/**
 * Contagem de projetos PENDENTES (legados sem "Atualizado Em") do usuário — p/ o
 * selo da home. Conta tanto os do OWNER quanto os em que ele é PARTICIPANTE (a flag
 * aparece para ambos).
 *
 * Por padrão lê SÓ do SQLite (espelho do "Atualizado Em") → instantâneo. Com
 * `sync: true`, sincroniza do Sheets (FONTE DA VERDADE) antes de contar — usado pela
 * home para corrigir o selo quando o SQLite ainda não tem os legados do usuário
 * (a home chama os dois: o rápido p/ aparecer na hora, e o sync p/ ficar exato).
 */
export async function contarPendentes(
  email: string,
  opts?: { sync?: boolean },
): Promise<{ count: number; prazo: string }> {
  if (opts?.sync) {
    try {
      await syncOwnerRowsFromSheet(email);
    } catch (e) {
      console.error('[contarPendentes] sync sob demanda falhou, usando SQLite:', e);
    }
  }
  const rows = await getProjetosByOwnerEmail(email);
  const count = rows
    .filter((p) => temAcesso(p, email)) // owner OU participante
    .filter((p) => ehLegado(p.id) && !temAtualizadoEm(p.atualizado_em))
    .length;
  return { count, prazo: PRAZO_LEGADO };
}

/**
 * Exclui um RASCUNHO do usuário. Gate de ownership (email do header) + só permite
 * apagar projeto com status 'rascunho' (nunca submetido). Apaga em cascata.
 */
export async function excluirRascunho(email: string, projetoId: string): Promise<{ ok: true }> {
  const p = await getProjetoById(projetoId);
  if (!p) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  // Só o owner exclui o próprio rascunho (participante não tem rascunho de terceiro).
  if (!ehOwner(p, email)) throw Object.assign(new Error('Sem permissão para excluir este projeto.'), { status: 403 });
  if (p.status !== 'rascunho') {
    throw Object.assign(new Error('Apenas rascunhos podem ser excluídos.'), { status: 400 });
  }
  await excluirProjetoCascade(projetoId);
  return { ok: true };
}

/**
 * Define a lista de EDITORES DELEGADOS de um projeto — participantes que podem
 * editar/reenviar como se fossem o dono. Quem pode gerenciar a lista: o dono OU um
 * editor já delegado (cascata, conforme decidido com o usuário). A lista é sanitizada
 * para conter apenas emails que são participantes atuais (`membros`), sem duplicatas e
 * sem o dono (o poder do dono vem de `ehOwner`, não da lista). Persistida em
 * `projetos.editores_delegados` (JSON). Conceito interno — não vai ao Google Sheets.
 */
export async function definirEditoresDelegados(
  email: string,
  projetoId: string,
  editores: unknown,
): Promise<{ ok: true; editores_delegados: string[] }> {
  const p = await getProjetoById(projetoId);
  if (!p) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  // Gate: só quem tem poder de edição pelo círculo de participantes — dono ou editor
  // já delegado (cascata). Admin-override NÃO gerencia delegação (não é participante).
  if (!ehOwner(p, email) && !ehEditorDelegado(p, email)) {
    throw Object.assign(
      new Error('Apenas o dono ou um editor delegado pode distribuir o poder de edição.'),
      { status: 403 },
    );
  }
  if (!Array.isArray(editores)) {
    throw Object.assign(new Error('Lista de editores inválida.'), { status: 400 });
  }
  // Sanitiza: só participantes atuais (membros), sem duplicatas, nunca o dono.
  const membros = parseJson<string[]>(p.membros) ?? [];
  const membrosLower = new Set(membros.map((m) => m.trim().toLowerCase()));
  const ownerLower = (p.responsavel_email ?? '').trim().toLowerCase();
  const vistos = new Set<string>();
  const limpos: string[] = [];
  for (const raw of editores) {
    if (typeof raw !== 'string') continue;
    const e = raw.trim();
    const lower = e.toLowerCase();
    if (!lower || lower === ownerLower) continue;
    if (!membrosLower.has(lower)) continue; // só participantes do projeto
    if (vistos.has(lower)) continue;
    vistos.add(lower);
    limpos.push(e);
  }
  await updateProjeto(projetoId, { editores_delegados: limpos });
  return { ok: true, editores_delegados: limpos };
}

export async function getMeuProjeto(
  id: string,
  email: string,
): Promise<MeuProjetoDetalhes> {
  const data = await getProjetoWithRelations(id);
  if (!data) {
    throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  }
  // LEITURA: owner OU participante (membro) podem abrir. Admins (emails do RPA
  // cadastrados na tabela `admins`) podem abrir QUALQUER projeto.
  const ehAdmin = await isAdmin(email);
  if (!temAcesso(data, email) && !ehAdmin) {
    throw Object.assign(new Error('Acesso negado.'), { status: 403 });
  }
  // EDIÇÃO: o owner (quem submeteu), um editor delegado (participante a quem o dono
  // delegou o poder) ou um admin RPA. Participante comum só visualiza — e ser
  // participante (não-delegado) VENCE o override de admin: um admin que também é
  // participante do projeto NÃO edita (vê como qualquer participante). O override de
  // admin vale só para projetos em que ele não tem papel (não é owner nem participante).
  const podeEditar =
    ehOwner(data, email) || ehEditorDelegado(data, email) || (ehAdmin && !ehParticipante(data, email));
  const papel: Papel = ehOwner(data, email) ? 'owner' : 'participante';

  const docRow = data.documentacao?.[0];
  const docConteudo = docRow ? parseJson(docRow.conteudo) : null;

  const ultimaVersaoRow = await getLatestVersionByProjeto(id);
  let ultima_versao: VersaoSnapshot | null = null;
  if (ultimaVersaoRow) {
    ultima_versao = {
      versao_num: ultimaVersaoRow.versao_num,
      acao: ultimaVersaoRow.acao,
      snapshot_projeto: parseJson(ultimaVersaoRow.snapshot_projeto) ?? ({} as VersaoSnapshot['snapshot_projeto']),
      snapshot_doc: parseJson(ultimaVersaoRow.snapshot_doc ?? null),
      created_at: ultimaVersaoRow.created_at,
    };
  }

  // Detalhe não consulta o Sheets; usa o "Atualizado Em" espelhado no SQLite.
  const base = mapItem({ ...data, area_nome: data.area_nome ?? null }, data.atualizado_em ?? null, papel, podeEditar);
  return {
    ...base,
    podeEditar,
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    escopo: data.escopo,
    servico_externo: data.servico_externo,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome,
    data_criacao_projeto: data.data_criacao_projeto,
    descricao_breve: data.descricao_breve,
    usa_ai_proxy: data.usa_ai_proxy ?? null,
    contexto_especial: data.contexto_especial,
    tipo_saving: data.tipo_saving,
    saving_horas: data.saving_horas,
    saving_reais: data.saving_reais,
    custo_externo_mensal: data.custo_externo_mensal,
    alguem_fazia: data.alguem_fazia,
    custo_evitado: data.custo_evitado ?? null,
    custo_evitado_justificativa: data.custo_evitado_justificativa ?? null,
    custo_evitado_itens: data.custo_evitado_itens ?? null,
    memorial_calculo: data.memorial_calculo,
    documentacao: docConteudo,
    ultima_versao,
  };
}

// Histórico de chat de um projeto do usuário — usado na RETOMADA de um rascunho
// quando não há snapshot local (ex.: outro navegador). Ownership idêntico ao
// getMeuProjeto: dono (responsável/membro) ou admin.
export async function getHistoricoMeuProjeto(
  id: string,
  email: string,
): Promise<Array<{ role: string; content: string; options: string[] | null }>> {
  const data = await getProjetoWithRelations(id);
  if (!data) {
    throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  }
  if (!temAcesso(data, email) && !(await isAdmin(email))) {
    throw Object.assign(new Error('Acesso negado.'), { status: 403 });
  }
  const msgs = await getChatMessages(id);
  return msgs.map((m) => ({
    role: m.role,
    content: m.content,
    options: parseJson<string[]>(m.options),
  }));
}
