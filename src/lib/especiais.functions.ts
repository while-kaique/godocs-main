/**
 * Servidor do comparador de projetos ESPECIAIS (`/especiais`).
 *
 * Lê o MESMO espelho da planilha que a triagem (`sheet_espelho`), nunca o Sheets em request —
 * a cota de 60 leituras/min é compartilhada com produção, e a listagem inteira já cabe no
 * recorte de resumo. O que esta tela acrescenta ao `/dashboard` é a régua: as **âncoras**
 * (tabela interna `especial_referencia`) e a leitura por NÍVEL em vez de por status.
 *
 * ⚠️ A nota continua sendo a coluna manual "Estrelas" da planilha — esta tela é o segundo
 * lugar do sistema que a escreve (o primeiro é a ficha do `/dashboard`), e escreve SÓ ela:
 * nada de "Status", nada de "Atualizado Em" (carimbo do sistema, que regulariza legado).
 */
import { z } from 'zod';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { lerResumosEspelho, espelharEscrita, statusEspelho, lerLinhaEspelho } from '@/lib/sheet-espelho';
import { registrarAtividade } from '@/lib/atividades.functions';
import {
  mapResumo,
  ordenarPorDataDesc,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-resumo';
import {
  getAvaliacoesEspeciais,
  upsertAvaliacaoEspecial,
  getDonosDeArea,
  upsertDonoDeArea,
  deleteDonoDeArea,
  getAdmins,
} from '@/integrations/db/client.server';
import {
  apenasEspeciais,
  chaveArea,
  type DonoDeArea,
  type ValidadorEspeciais,
} from '@/lib/especiais-view';
import { NOTA_MAX, type AvaliacaoEspecial, type Confianca } from '@/lib/especiais-regua';
import { AVALIACOES_SEED, ORIGEM_SEED_FORCA_TAREFA } from '@/lib/especiais-seed';
import { MAX_ESTRELAS_GRAVAVEL, ESPELHO_VELHO_MS } from '@/lib/dashboard-admin.functions';

export type ListagemEspeciais = {
  projetos: ProjetoDashboardResumo[];
  /** Recomendações da auditoria (lote importado hoje, agente classificador amanhã). */
  avaliacoes: AvaliacaoEspecial[];
  /** Quem valida cada área (a divisão da força-tarefa, definida à mão). */
  donos: DonoDeArea[];
  /** Admins elegíveis a receber áreas — a lista do seletor da divisão. */
  validadores: ValidadorEspeciais[];
  /** ISO da última sincronização com a planilha (a idade do espelho), como no /dashboard. */
  lidoEm: string;
  espelhoVelho: boolean;
};

/**
 * Só os ESPECIAIS. O corte é no servidor de propósito: são ~dezenas de linhas contra ~640, e
 * mandar a base inteira para a tela filtrar duplicaria o payload da triagem sem ninguém ver.
 */
/**
 * Semeia o lote da força-tarefa — só o que FALTA.
 *
 * ⚠️ Nunca sobrescreve: uma recomendação já gravada é mais nova que este retrato (pode ter
 * vindo do agente classificador ou de uma reavaliação), e um seed que atualizasse a desfaria a
 * cada deploy. Mesma disciplina do `semearFaq`.
 *
 * Roda no caminho de leitura da tela porque não há migração/boot onde pendurá-lo — e sai
 * barato: uma vez por isolate, e só faz `INSERT` do que não existe.
 */
let seedTentado = false;

export async function semearAvaliacoesEspeciais(
  existentes: Set<string>,
): Promise<number> {
  let novas = 0;
  for (const s of AVALIACOES_SEED) {
    if (existentes.has(s.projeto_id)) continue;
    await upsertAvaliacaoEspecial({
      projeto_id: s.projeto_id,
      estrelas_recomendada: s.estrelas_recomendada,
      confianca: s.confianca,
      leitura: s.leitura,
      contestada: s.contestada,
      origem: ORIGEM_SEED_FORCA_TAREFA,
      modelo: null,
    });
    novas++;
  }
  if (novas) console.log(`[especiais] seed: +${novas} recomendação(ões) da força-tarefa`);
  return novas;
}

export async function listarEspeciais(): Promise<ListagemEspeciais> {
  const [{ linhas, lidoEmMs }, saude, avaliacoesIniciais, donos, admins] = await Promise.all([
    lerResumosEspelho(),
    statusEspelho(),
    getAvaliacoesEspeciais(),
    getDonosDeArea(),
    getAdmins(),
  ]);

  // Seed: uma vez por isolate, e nunca bloqueia a tela se falhar (é dado de apoio, não estado).
  let avaliacoes = avaliacoesIniciais;
  if (!seedTentado) {
    seedTentado = true;
    try {
      const novas = await semearAvaliacoesEspeciais(new Set(avaliacoes.map((a) => a.projeto_id)));
      if (novas) avaliacoes = await getAvaliacoesEspeciais();
    } catch (e) {
      console.error('[especiais] seed de recomendações falhou (seguindo sem ele):', e);
    }
  }

  const projetos = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  ).sort(ordenarPorDataDesc);

  const idadeRef = saude.ultimoSyncOkMs ?? lidoEmMs;
  return {
    projetos,
    avaliacoes: avaliacoes.map((a) => ({
      projeto_id: a.projeto_id,
      estrelas_recomendada: a.estrelas_recomendada,
      confianca: (a.confianca ?? 'media') as Confianca,
      leitura: a.leitura,
      contestada: a.contestada === 1,
      origem: a.origem,
      modelo: a.modelo,
      criado_em: a.criado_em,
    })),
    donos: donos.map((d) => ({ area: d.area, dono_email: d.dono_email, dono_nome: d.dono_nome })),
    // A lista vem da tabela `admins`. Quem é admin só pela env `ADMIN_EMAILS` (bootstrap) não
    // aparece aqui — e isso é aceito: para RECEBER uma área é preciso estar cadastrado, o que
    // dá nome à pessoa em vez de um e-mail solto no seletor.
    validadores: admins.map((a) => ({ email: a.email, nome: a.nome ?? null })),
    lidoEm: new Date(idadeRef ?? Date.now()).toISOString(),
    espelhoVelho: idadeRef != null && Date.now() - idadeRef > ESPELHO_VELHO_MS,
  };
}

/**
 * Define (ou tira) quem valida uma ÁREA inteira.
 *
 * ⚠️ Nada disso vai para a planilha: a divisão é combinação interna de quem coordena, não
 * atributo do projeto — e é por isso que ela pode mudar sem carimbar "Atualizado Em" em
 * dezenas de linhas.
 */
const donoSchema = z.object({
  area: z.string().min(1).max(120),
  // `null` = tirar o dono (a área volta para "sem dono").
  dono_email: z.string().email().max(160).nullable(),
  dono_nome: z.string().max(160).optional(),
});

export async function definirDonoDeArea(raw: unknown, adminEmail: string) {
  const { area, dono_email, dono_nome } = donoSchema.parse(raw);
  const chave = chaveArea(area);
  if (!dono_email) {
    await deleteDonoDeArea(chave);
    await registrarAtividade({
      ator_email: adminEmail,
      acao: 'dono_area',
      detalhe: `Área ${chave}: dono removido`,
      meta: { area: chave, dono_email: null },
    });
    return { ok: true, area: chave, dono_email: null };
  }
  await upsertDonoDeArea({
    area: chave,
    dono_email,
    dono_nome: dono_nome?.trim() || null,
    definido_por: adminEmail,
  });
  await registrarAtividade({
    ator_email: adminEmail,
    acao: 'dono_area',
    detalhe: `Área ${chave}: ${dono_nome?.trim() || dono_email}`,
    meta: { area: chave, dono_email, dono_nome: dono_nome?.trim() || null },
  });
  return { ok: true, area: chave, dono_email };
}

/**
 * Importa um LOTE de recomendações (o pipeline da força-tarefa roda fora do app e entrega um
 * JSON). Idempotente por projeto: reimportar o mesmo lote substitui, nunca duplica.
 *
 * ⚠️ **Não escreve nada na planilha.** A recomendação é sugestão — a nota só muda por clique
 * de gente na tela. É a mesma régua que vai valer para o agente classificador.
 */
const loteSchema = z.object({
  origem: z.string().min(1).max(80),
  modelo: z.string().max(80).optional(),
  avaliacoes: z
    .array(
      z.object({
        projeto_id: z.string().min(1).max(120),
        estrelas_recomendada: z.number().min(0).max(NOTA_MAX),
        confianca: z.enum(['alta', 'media', 'baixa']).optional(),
        leitura: z.string().max(2000).optional(),
        contestada: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function importarAvaliacoesEspeciais(raw: unknown) {
  const { origem, modelo, avaliacoes } = loteSchema.parse(raw);
  for (const a of avaliacoes) {
    await upsertAvaliacaoEspecial({
      projeto_id: a.projeto_id,
      estrelas_recomendada: a.estrelas_recomendada,
      confianca: a.confianca ?? 'media',
      leitura: a.leitura?.trim() || null,
      contestada: a.contestada ?? false,
      origem,
      modelo: modelo ?? null,
    });
  }
  return { ok: true, importadas: avaliacoes.length, origem };
}

const estrelasSchema = z.object({
  projeto_id: z.string().min(1).max(120),
  estrelas: z.number().int().min(0).max(MAX_ESTRELAS_GRAVAVEL),
});

/**
 * Regrava SÓ a nota (é o gesto de "mover o cartão de coluna").
 *
 * ⚠️ Não passa por `ouTraco`: a coluna é NUMÉRICA e "sem estrela" é **0** — gravar "—" aqui
 * transformaria a coluna em texto e quebraria a soma/ordenação de quem usa a planilha (mesma
 * razão documentada em `definirStatusProjeto`).
 */
export async function definirEstrelasEspecial(raw: unknown, adminEmail: string) {
  const { projeto_id, estrelas } = estrelasSchema.parse(raw);
  const linha = await lerLinhaEspelho(projeto_id);
  const estrelasAnterior = linha
    ? Number(String((linha as Record<string, unknown>)['Estrelas'] ?? '') || 0) || 0
    : null;
  const updates = { Estrelas: String(estrelas) };
  await updateRowByProjectId(projeto_id, updates);
  // Remendo do espelho com carimbo: um sync que COMEÇOU antes desta escrita não a desfaz.
  await espelharEscrita(projeto_id, updates);

  // Feed do painel (drawer "Histórico"). Não bloqueia nem lança.
  await registrarAtividade({
    ator_email: adminEmail,
    acao: 'estrelas',
    projeto_id,
    projeto_nome: linha
      ? String((linha as Record<string, unknown>)['Projeto'] ?? '').trim() || null
      : null,
    detalhe: `${estrelas} ${estrelas === 1 ? 'estrela' : 'estrelas'}`,
    meta: { estrelas, estrelas_anterior: estrelasAnterior },
  });

  return { ok: true, projeto_id, estrelas };
}
