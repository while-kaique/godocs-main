// O RELATOR das falhas dos agentes (server-only): grava a linha durável e, quando a classe pede,
// manda UM alerta no Chat do watchdog.
//
// ⚠️ **Este arquivo é o único que junta as duas metades.** O catálogo e o hook são PUROS
// (`agentes-falhas.ts`) justamente para que `embeddings.ts`/`pinecone.ts` possam gritar sem
// arrastar SQLite e cliente de Chat para dentro de si — inclusive nos scripts de rodada, que não
// têm banco. Quem instala o relator é o worker, uma vez (`garantirRelatorDeFalhas`).
//
// ⚠️ **NUNCA lança.** Reportar é acessório: não pode derrubar o julgamento que já aconteceu (a
// mesma disciplina de `registrarNoAgente`, `registrarAtividade` e `insertAdminStatusLog`).

import {
  getFalhasAgentePorClasse,
  getFalhasAgenteRecentes,
  insertFalhaAgente,
  type FalhaAgenteRow,
} from '@/integrations/db/client.server';
import { alertarErroIntegracao } from '@/lib/alertas.functions';
import { runBackground } from '@/lib/background';
import {
  chaveCooldown,
  definirRelatorDeFalhas,
  descreverFalha,
  deveAlertar,
  textoAlertaFalha,
  type ClasseFalha,
  type ContextoFalha,
} from '@/lib/agentes-falhas';

function idFalha(): string {
  return `fa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Grava a falha e, se a classe for de alerta, dispara a mensagem.
 *
 * ⚠️ A gravação vem ANTES do alerta e é independente dele: o alerta tem cooldown (a 2ª ocorrência
 * dentro da janela é contada em silêncio), então se o registro dependesse do envio a segunda
 * metade de um backfill quebrado desapareceria do histórico — exatamente o que este módulo existe
 * para impedir.
 */
export async function registrarFalhaDeAgente(ctx: ContextoFalha): Promise<void> {
  const alerta = deveAlertar(ctx.classe);
  try {
    await insertFalhaAgente({
      id: idFalha(),
      classe: ctx.classe,
      onde: ctx.onde,
      projeto_id: ctx.projetoId ?? null,
      ciclo_id: ctx.cicloId ?? null,
      detalhe: ctx.detalhe ?? null,
      alertou: alerta,
    });
  } catch (e) {
    console.error('[falha-agente] não conseguiu gravar (seguindo):', e);
  }
  if (!alerta) return;
  try {
    const { titulo, detalhe } = textoAlertaFalha(ctx.classe, {
      onde: ctx.onde,
      projetoId: ctx.projetoId ?? null,
      detalhe: ctx.detalhe ?? null,
    });
    await alertarErroIntegracao(chaveCooldown(ctx.classe), titulo, detalhe);
  } catch (e) {
    console.error('[falha-agente] não conseguiu alertar (seguindo):', e);
  }
}

/**
 * Instala o relator no hook puro. Idempotente e barato — pode ser chamado no começo de todo
 * request.
 *
 * ⚠️ **Lê nenhuma env** (é só uma referência de função), então pode rodar no bootstrap sem cair na
 * armadilha do `process is not defined` do Godeploy.
 * ⚠️ O relator é chamado de dentro de módulos que **não podem esperar** por I/O (o
 * `gerarEmbeddingsLote` está no caminho de uma submissão), por isso o hook é SÍNCRONO e a gravação
 * vai para `runBackground`.
 */
export function garantirRelatorDeFalhas(): void {
  definirRelatorDeFalhas((ctx) => {
    runBackground(registrarFalhaDeAgente(ctx));
  });
}

/**
 * O painel de SAÚDE: quantas falhas de cada classe caíram na janela, com a última ocorrência e
 * alguns exemplos. É o que responde "os agentes falharam?" sem depender do log do Godeploy.
 *
 * ⚠️ **Agregado no SQL** — a tabela cresce a cada backfill (750 projetos × N classes) e a
 * pergunta é um número, não a lista. Os `exemplos` são bounded de propósito.
 * ⚠️ **NUNCA lança**: um painel de diagnóstico que derruba a rota do admin é pior que nenhum.
 * Falha de leitura vira `ok: false` com o motivo, e o resto do payload continua servível.
 */
export async function saudeDosAgentes(opts: { horas?: number; exemplos?: number } = {}): Promise<{
  ok: boolean;
  horas: number;
  total: number;
  por_classe: { classe: string; total: number; ultima: string | null; alerta: boolean; sintoma: string }[];
  exemplos: FalhaAgenteRow[];
  motivo?: string;
}> {
  const horas = opts.horas && opts.horas > 0 ? Math.floor(opts.horas) : 24;
  try {
    const [porClasse, exemplos] = await Promise.all([
      getFalhasAgentePorClasse(horas),
      getFalhasAgenteRecentes(opts.exemplos ?? 20),
    ]);
    const linhas = porClasse.map((l) => {
      const d = descreverFalha(l.classe as ClasseFalha);
      return {
        classe: l.classe,
        total: l.total,
        ultima: l.ultima,
        alerta: deveAlertar(l.classe as ClasseFalha),
        // Sem descrição = classe gravada por um código mais novo que este catálogo. Dizer isso é
        // melhor que omitir a linha: a falha existe e alguém precisa nomeá-la.
        sintoma: d?.sintoma ?? 'classe não catalogada — registrar em FALHAS_AGENTE',
      };
    });
    return {
      ok: true,
      horas,
      total: linhas.reduce((s, l) => s + l.total, 0),
      por_classe: linhas,
      exemplos,
    };
  } catch (e) {
    return {
      ok: false,
      horas,
      total: 0,
      por_classe: [],
      exemplos: [],
      motivo: e instanceof Error ? e.message : String(e),
    };
  }
}
