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
import { lerResumosEspelho, espelharEscrita, statusEspelho } from '@/lib/sheet-espelho';
import {
  mapResumo,
  ordenarPorDataDesc,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-resumo';
import {
  getReferenciasEspeciais,
  upsertReferenciaEspecial,
  deleteReferenciaEspecial,
} from '@/integrations/db/client.server';
import { apenasEspeciais, type ReferenciaEspecial } from '@/lib/especiais-view';
import { MAX_ESTRELAS_GRAVAVEL, ESPELHO_VELHO_MS } from '@/lib/dashboard-admin.functions';

export type ListagemEspeciais = {
  projetos: ProjetoDashboardResumo[];
  referencias: ReferenciaEspecial[];
  /** ISO da última sincronização com a planilha (a idade do espelho), como no /dashboard. */
  lidoEm: string;
  espelhoVelho: boolean;
};

/**
 * Só os ESPECIAIS. O corte é no servidor de propósito: são ~dezenas de linhas contra ~640, e
 * mandar a base inteira para a tela filtrar duplicaria o payload da triagem sem ninguém ver.
 */
export async function listarEspeciais(): Promise<ListagemEspeciais> {
  const [{ linhas, lidoEmMs }, saude, referencias] = await Promise.all([
    lerResumosEspelho(),
    statusEspelho(),
    getReferenciasEspeciais(),
  ]);

  const projetos = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  ).sort(ordenarPorDataDesc);

  const idadeRef = saude.ultimoSyncOkMs ?? lidoEmMs;
  return {
    projetos,
    referencias: referencias.map((r) => ({
      projeto_id: r.projeto_id,
      nota: r.nota,
      motivo: r.motivo,
      definido_por: r.definido_por,
      definido_em: r.definido_em,
    })),
    lidoEm: new Date(idadeRef ?? Date.now()).toISOString(),
    espelhoVelho: idadeRef != null && Date.now() - idadeRef > ESPELHO_VELHO_MS,
  };
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
export async function definirEstrelasEspecial(raw: unknown) {
  const { projeto_id, estrelas } = estrelasSchema.parse(raw);
  const updates = { Estrelas: String(estrelas) };
  await updateRowByProjectId(projeto_id, updates);
  // Remendo do espelho com carimbo: um sync que COMEÇOU antes desta escrita não a desfaz.
  await espelharEscrita(projeto_id, updates);
  return { ok: true, projeto_id, estrelas };
}

const referenciaSchema = z.object({
  projeto_id: z.string().min(1).max(120),
  nota: z.number().int().min(0).max(MAX_ESTRELAS_GRAVAVEL),
  // A frase da régua. Curta de propósito: é rótulo de nível, não parecer — o teto obriga a
  // dizer o que distingue o nível em vez de resumir o projeto.
  motivo: z.string().max(280).optional(),
});

export async function definirReferenciaEspecial(raw: unknown, adminEmail: string) {
  const { projeto_id, nota, motivo } = referenciaSchema.parse(raw);
  await upsertReferenciaEspecial({
    projeto_id,
    nota,
    motivo: motivo?.trim() || null,
    definido_por: adminEmail,
  });
  return { ok: true };
}

export async function removerReferenciaEspecial(raw: unknown) {
  const { projeto_id } = z.object({ projeto_id: z.string().min(1).max(120) }).parse(raw);
  await deleteReferenciaEspecial(projeto_id);
  return { ok: true };
}
