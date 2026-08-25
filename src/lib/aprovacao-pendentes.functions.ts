/**
 * Servidor da aba TEMPORÁRIA de aprovação de pendentes/pré-aprovados (`/aprovacoes-pendentes`).
 *
 * Lê o MESMO espelho da planilha que a triagem (`sheet_espelho`), nunca o Sheets em request —
 * a cota de 60 leituras/min é compartilhada com produção. O corte de escopo (só pendentes/
 * pré-aprovados do fluxo normal) é `apenasFilaRpa`, no servidor: são dezenas de linhas contra
 * ~640, e mandar a base inteira para a tela filtrar duplicaria o payload da triagem.
 *
 * ⚠️ Não escreve NADA de novo: as ações (aprovar/reenviar/reprovar) reusam o endpoint da
 * triagem (`/api/admin/dashboard/status`) e a divisão por área reusa o de `/especiais`
 * (`/api/admin/especiais/dono`). Aqui só existe a LEITURA agrupável por autor.
 */
import { lerResumosEspelho, statusEspelho } from '@/lib/sheet-espelho';
import {
  mapResumo,
  ordenarPorDataDesc,
  type ProjetoDashboardResumo,
} from '@/lib/dashboard-resumo';
import {
  getDonosDeArea,
  getAdmins,
  getContribuicoesDeParticipantes,
} from '@/integrations/db/client.server';
import {
  montarContribuicoesPorProjeto,
  type ContribuicaoParticipante,
} from '@/lib/participantes-contribuicoes';
import type { DonoDeArea, ValidadorEspeciais } from '@/lib/especiais-view';
import { apenasFilaRpa } from '@/lib/aprovacao-pendentes-view';
import { ESPELHO_VELHO_MS } from '@/lib/dashboard-admin.functions';

export type ListagemPendentes = {
  projetos: ProjetoDashboardResumo[];
  /** `id do projeto → o que cada participante fez` (banco, nunca planilha). Projeto sem
   *  texto não aparece no mapa; o cartão então não desenha o bloco. */
  contribuicoes: Record<string, ContribuicaoParticipante[]>;
  /** Quem valida cada área (a MESMA divisão da `/especiais`, definida à mão). */
  donos: DonoDeArea[];
  /** Admins elegíveis a receber áreas — a lista do seletor da divisão. */
  validadores: ValidadorEspeciais[];
  /** ISO da última sincronização com a planilha (a idade do espelho), como no /dashboard. */
  lidoEm: string;
  espelhoVelho: boolean;
};

export async function listarAprovacaoPendentes(): Promise<ListagemPendentes> {
  const [{ linhas, lidoEmMs }, saude, donos, admins, contribuicoes] = await Promise.all([
    lerResumosEspelho(),
    statusEspelho(),
    getDonosDeArea(),
    getAdmins(),
    getContribuicoesDeParticipantes(),
  ]);

  const projetos = apenasFilaRpa(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  ).sort(ordenarPorDataDesc);

  const idadeRef = saude.ultimoSyncOkMs ?? lidoEmMs;
  return {
    projetos,
    contribuicoes: montarContribuicoesPorProjeto(contribuicoes),
    donos: donos.map((d) => ({ area: d.area, dono_email: d.dono_email, dono_nome: d.dono_nome })),
    validadores: admins.map((a) => ({ email: a.email, nome: a.nome ?? null })),
    lidoEm: new Date(idadeRef ?? Date.now()).toISOString(),
    espelhoVelho: idadeRef != null && Date.now() - idadeRef > ESPELHO_VELHO_MS,
  };
}
