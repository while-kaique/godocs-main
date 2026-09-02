/**
 * Cloudflare Worker entry — SPA + API
 *
 * Todas as rotas /api/* são tratadas aqui.
 * O restante cai para os assets estáticos (a SPA React).
 */

import { getCurrentUser, isAdmin } from "@/lib/auth.functions";
import { ehLideranca } from "@/lib/areas/teamguide.server";
import {
  sincronizarTeamGuide,
  statusTeamGuideEspelho,
} from "@/lib/teamguide-espelho";
import { diasParaExpirarTokenTG } from "@/lib/teamguide-token";
import { alertarErroIntegracao } from "@/lib/alertas.functions";
import {
  iniciarSubmissao,
  enviarMensagem,
  iniciarSaving,
  iniciarReceita,
  atualizarTipos,
  atualizarMetadados,
  analisarProjetoFn,
  submeterParaValidacao,
  validarProjeto,
  resyncGoogle,
  reconciliarComplexidade,
  retroativoCustosPontuais,
  recompilarDocsPendentes,
} from "@/lib/chat.functions";
import { reconciliarSnapshots } from "@/lib/reconciliar-snapshots";
import { recalcularRollupBackfill } from "@/lib/rollup-backfill";
import { derivarTotaisPorArea } from "@/lib/rollup-financeiro";
import { enviarRollupParaJG } from "@/lib/rollup-push.functions";
import {
  getAreas,
  createArea,
  deleteArea,
  getAdmins,
  addAdmin,
  removeAdmin,
  getProjetos,
  getProjetoDetalhes,
  createUser,
  deleteUser,
  updateUserAreas,
  getConfiguracoes,
  updateConfiguracao,
  getUsuarios,
} from "@/lib/admin.functions";
import {
  listarProjetosDashboard,
  getProjetoDashboard,
  getProjetosDashboardLote,
  definirStatusProjeto,
  registrarFeedbackSombra,
} from "@/lib/dashboard-admin.functions";
import {
  listarEspeciais,
  definirEstrelasEspecial,
  definirDonoDeArea,
  importarAvaliacoesEspeciais,
} from "@/lib/especiais.functions";
import {
  classificarEspecialProjeto,
  classificarEspeciaisPendentes,
  classificarEspecialEmBackground,
  prepararIndicePinecone,
  sincronizarPineconeEspeciais,
  reauditarEspeciais,
  medirConcordanciaAgente,
  rotearEspeciaisPorFuncao,
  julgarEspeciaisComPainel,
  medirConcordanciaPainel,
} from "@/lib/especial-classificador.functions";
import {
  avaliarProjetoNormalEmBackground,
  avaliarProjetoNormal,
  avaliarProjetosNormaisPendentes,
  avancarDeliberacoesPendentes,
} from "@/lib/avaliacao-normais.functions";
import { avaliarRetroativo } from "@/lib/avaliacao-retroativa.functions";
import { listarAprovacaoPendentes } from "@/lib/aprovacao-pendentes.functions";
import { getAreasPublicas, sincronizarAreas } from "@/lib/areas.functions";
import { getSugestoesParticipantes } from "@/lib/participantes.functions";
import { syncSheetsToSqlite } from "@/lib/google/sync-reverse";
import { statusEspelho } from "@/lib/sheet-espelho";
import {
  getProjetosInvestigador,
  getProjetoInvestigadorDetalhes,
  getInvestigadorStats,
  getEdicoesInvestigador,
  getProjetosPendentesAprovacaoInvestigador,
} from "@/lib/investigador.functions";
import {
  setDb,
  insertApiLog,
  getApiLogById,
  cleanupOldApiLogs,
  cleanupOldSyncRuns,
  cleanupOldTeamguideSyncRuns,
  getSyncRunsRecentes,
  deleteProjetosTesteE2E,
  excluirProjetoCascade,
  getProjetoById,
  getAprovacoesDoProjeto,
  lerRollupMensal,
} from "@/integrations/db/client.server";
import {
  listarMeusProjetos,
  getMeuProjeto,
  getHistoricoMeuProjeto,
  contarPendentes,
  excluirRascunho,
  definirEditoresDelegados,
  descontinuarProjeto,
} from "@/lib/meus-projetos.functions";
import { assessDocsBackfill } from "@/lib/docs-backfill";
import { reconciliarFinanceiroDoSheet } from "@/lib/reconciliar-financeiro";
import { converterParaCustoEvitadoPuro } from "@/lib/converter-custo-evitado-puro";
import {
  getPreviewDisparo,
  salvarTemplate,
  enviarEmailTeste,
  iniciarDisparo,
  processarChunkLote,
  getProgressoLote,
  cancelarDisparo,
  normalizarAudiencia,
} from "@/lib/email-legados.functions";
import { runBackground } from "@/lib/background";
import { criarChamadoAjuda } from "@/lib/ajuda.functions";
import {
  listarFaq,
  salvarCategoria,
  arquivarFaq,
  reordenarFaq,
  desfazerFaq,
} from "@/lib/faq.functions";
import {
  listarAprovacoesPendentes,
  decidirAprovacao,
  reabrirPreAprovacoes,
} from "@/lib/aprovacoes.functions";
import { registrarAtividade, listarAtividades } from "@/lib/atividades.functions";
import {
  notificarLideresPendentes,
  notificarLideresDoProjeto,
} from "@/lib/gomoon-lideres.functions";
import { traduzirErroValidacao } from "@/lib/erro-validacao";
import { getGodocsEnv } from "@/lib/env";
import type { GoDeployDB } from "@/integrations/db/db-adapter";

// Env do Godeploy — inclui DB (SQLite embutido) e env vars como strings
interface Env {
  DB: GoDeployDB;
  [key: string]: unknown;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

// `extra` é ADITIVO no corpo do erro — hoje só o `bloqueio` estruturado da submissão
// (`src/lib/mensagens-submissao.ts`), que a tela renderiza num painel âmbar ancorado no botão
// em vez de um toast vermelho. Quem só lê `error` continua funcionando.
function errorJson(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

// Flag de streaming SSE das rotas de chat. Lida LAZY (nunca em escopo de módulo — no
// Godeploy `process` não existe na avaliação do módulo). Desligada por padrão: só liga com
// LLM_STREAMING ∈ {1,true,on}. Rollout: liga na staging, valida, depois na prod — sem tocar
// no cliente (o apiStream trata json E event-stream).
function streamingLigado(): boolean {
  const v = (process.env.LLM_STREAMING ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

function getEmailFromRequest(request: Request): string | null {
  const headerName = process.env.GODEPLOY_USER_HEADER ?? "x-godeploy-user-email";
  return (
    request.headers.get(headerName) ??
    (process.env.NODE_ENV !== "production" ? (process.env.DEV_USER_EMAIL ?? null) : null)
  );
}

async function requireAdmin(request: Request): Promise<{ email: string }> {
  const email = getEmailFromRequest(request);
  if (!email) throw Object.assign(new Error("Não autorizado"), { status: 401 });
  if (!(await isAdmin(email)))
    throw Object.assign(new Error("Acesso negado. Apenas administradores."), { status: 403 });
  return { email };
}

async function readBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

// ── roteador ─────────────────────────────────────────────────────────────────

// Contexto mínimo do Worker — só precisamos de waitUntil para rodar a análise
// automática em background (sobrevive ao fechamento da aba pelo usuário).
interface ExecCtx {
  waitUntil(promise: Promise<unknown>): void;
}

// Dispara a análise do projeto sem propagar erros (background, best-effort).
function analisarEmBackground(projetoId: string): Promise<unknown> {
  return analisarProjetoFn({ projeto_id: projetoId }).catch((e) =>
    console.error("[worker] análise automática em background falhou:", e),
  );
}

// Análise + classificação de especiais + time autônomo de avaliação de normais, TODAS em
// paralelo (Promise.allSettled). O classificador de especiais é NO-OP se o projeto não for
// especial; a avaliação de normais (3ª promise) é NO-OP se a flag AVALIACAO_NORMAIS está OFF
// (default) ou se o projeto é especial — e em MODO SOMBRA só grava a recomendação, nunca muda o
// status. Nenhuma das três lança (cada uma engole os próprios erros).
function processarPosSubmissao(projetoId: string): Promise<unknown> {
  return Promise.allSettled([
    analisarEmBackground(projetoId),
    classificarEspecialEmBackground(projetoId),
    avaliarProjetoNormalEmBackground(projetoId),
  ]);
}

async function handleApi(request: Request, url: URL, ctx?: ExecCtx): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  try {
    // ── Auth ──
    if (pathname === "/api/auth/me" && method === "GET") {
      console.log("[worker] /api/auth/me chamado");
      const user = await getCurrentUser(request);
      console.log("[worker] /api/auth/me resultado:", JSON.stringify(user));
      return json(user);
    }

    // ── Perfil de submissão: o usuário logado é liderança (cargo isento, coordenador+)?
    // Decide se o formulário oferece o FLUXO DIRETO (pula o agente). Endpoint SEPARADO
    // do /api/auth/me de propósito: só o formulário de submissão precisa disto, e a
    // consulta à TeamGuide (cacheada por isolate) não deve entrar no caminho de todo
    // /api/auth/me (dashboard/faq). Fail-to-false: erro/sem cargo → não oferece o atalho.
    // É só o que PINTA — o servidor reconfere a permissão em iniciar-submissao/saving/receita.
    if (pathname === "/api/submeter/perfil" && method === "GET") {
      const email = getEmailFromRequest(request);
      let lider = false;
      try {
        lider = !!email && (await ehLideranca(email));
      } catch (e) {
        console.error("[worker] /api/submeter/perfil ehLideranca falhou:", e);
      }
      const admin = email ? await isAdmin(email) : false;
      return json({ ehLideranca: lider, isAdmin: admin });
    }

    // ── Config pública (rótulo do ambiente) — usado pela faixa de staging ──
    // Só expõe `env` (production/staging); nunca secrets. O bundle do SPA é
    // idêntico nos dois apps, então o cliente descobre o ambiente por aqui.
    if (pathname === "/api/config" && method === "GET") {
      return json({ env: getGodocsEnv() });
    }

    // ── Áreas (público — usado pelo seletor da etapa 1) ──
    if (pathname === "/api/areas" && method === "GET") {
      return json(await getAreasPublicas());
    }

    // ── Sugestões de participantes (autocomplete da etapa 1; lista da TeamGuide) ──
    if (pathname === "/api/participantes/sugestoes" && method === "GET") {
      return json(await getSugestoesParticipantes());
    }

    // ── Cron: sincroniza áreas da TeamGuide (chamado pela plataforma Godeploy) ──
    // O gateway carimba o header X-Godeploy-Cron; exigimos sua presença para que
    // a rota não seja disparável externamente.
    if (pathname === "/api/cron/sync-areas" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      // Limpa logs de API com mais de 30 dias (em segundo plano, via waitUntil)
      runBackground(cleanupOldApiLogs(30));
      // E o log de corridas do sync, que cresce ~288 linhas/dia com o cron de 5 min.
      runBackground(cleanupOldSyncRuns(7));
      return json(await sincronizarAreas());
    }

    // ── Cron: sync reverso Sheets → SQLite (planilha = fonte de verdade) ──
    // Atualiza o ESPELHO da planilha (é dele que "Meus Projetos" e o /dashboard leem),
    // importa legados que só existem na aba, reflete edições manuais nos campos seguros e
    // remove dos dois lados o que sumiu da planilha.
    // ⚠️ Agendado a cada 5 MIN (era 1×/h): as telas não leem mais o Sheets em request, então
    // a cadência do cron É a frescura do que todo mundo vê. Sai barato porque o espelho só
    // grava linha que mudou de verdade (hash) — ver `sheet-espelho.ts`.
    // ⚠️ Um webhook do Sheets (Apps Script → aqui) seria melhor e é IMPOSSÍVEL: o edge do
    // Godeploy exige OAuth em TODAS as rotas e devolve 302 para o login (medido 11/08/2026).
    if (pathname === "/api/cron/sync-sheets-to-sqlite" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await syncSheetsToSqlite("cron"));
    }

    // ── Cron: sync do ESPELHO da TeamGuide (árvore + pessoas) + aviso de token ──
    // As leituras de cargo/liderança/área/nome leem do espelho SQLite (fail-safe); é ESTE cron
    // (sugerido a cada 30 min — a árvore muda devagar) que o mantém fresco. Também avisa, no
    // Chat de Ajuda, quando o JWT do TG_API_TOKEN está a < 14 dias de expirar (o incidente
    // 01–02/09/2026 foi o token vencendo sem aviso). Nunca lança — `sincronizarTeamGuide` já
    // é fail-safe e dispara o próprio alerta em falha.
    if (pathname === "/api/cron/sync-teamguide" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      // Higiene do log de corridas (~48/dia com o cron de 30 min).
      runBackground(cleanupOldTeamguideSyncRuns(7));
      const resultado = await sincronizarTeamGuide("cron");
      const dias = diasParaExpirarTokenTG(process.env.TG_API_TOKEN);
      if (dias != null && dias < 14) {
        const data = new Date(Date.now() + dias * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await alertarErroIntegracao(
          "teamguide-token",
          `token da TeamGuide expira em ${dias} dia(s) (${data})`,
          "Renove o TG_API_TOKEN nos secrets do Godeploy (prod + staging) antes de vencer.",
        );
      }
      return json({ ...resultado, tokenDiasRestantes: dias });
    }

    // ── Cron: reconcilia a coluna "Complexidade" da planilha ──
    // A análise roda em background (waitUntil) e às vezes é cancelada antes de
    // gravar a Complexidade no Sheets. Este cron repõe o que faltou (resync) ou
    // re-roda o analisador para os que nunca foram analisados. Idempotente.
    if (pathname === "/api/cron/reanalisar-pendentes" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await reconciliarComplexidade());
    }

    // ── Cron: reconcilia SNAPSHOTS de auditoria (projeto_versions) ──
    // A versão é gravada de forma não-bloqueante no submit; submissões cujo snapshot
    // falhou (e legados) ficam sem versão. Este cron fecha os furos reconstruindo a
    // versão a partir do estado atual (marcada origem='reconciliado'). Idempotente.
    if (pathname === "/api/cron/reconciliar-snapshots" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await reconciliarSnapshots());
    }

    // ── Cron: recompila docs PENDENTES (compilação assíncrona) ──
    // A compilação da doc roda em background/submit no modelo escolhido (luna) e NUNCA cai no
    // mini. Se o luna não entregou (proxy fora), a doc fica pendente e o cliente segue sem
    // travar; este cron a recompila no luna depois. Idempotente, bounded.
    if (pathname === "/api/cron/recompilar-docs-pendentes" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await recompilarDocsPendentes());
    }

    // ── Cron: classificador de especiais pendentes (peça 4) ──────────────────
    // Rede do disparo pós-submissão: um especial cujo background morreu (ou submetido
    // antes da feature) recebe a recomendação aqui. Bounded por corrida (converge em
    // várias), grava de verdade (dry:false), NUNCA toca a coluna "Estrelas".
    if (pathname === "/api/cron/classificar-especiais" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await classificarEspeciaisPendentes({ dry: false, limite: 10 }));
    }

    // ── Cron: PAINEL de agentes sobre os especiais sem recomendação (T6) ──────
    // ⚠️ Página pequena e teto de custo BAIXO de propósito: são ~8 chamadas de LLM por projeto
    // (contra 1 do classificador), e o cron existe para CONVERGIR em várias corridas, não para
    // varrer a base numa. Ele pega só quem não tem recomendação nenhuma nem nota humana — não
    // atropela o classificador nem a nota de gente (decisão 7 do plano).
    // ⚠️ NÃO está agendado no Godeploy: até o T7 passar, o painel roda pela rota admin.
    if (pathname === "/api/cron/painel-especiais" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await julgarEspeciaisComPainel({ dry: false, limite: 3, tetoChamadas: 30 }));
    }

    // ── Cron irmão: time autônomo de avaliação de NORMAIS (fatia B, MODO SOMBRA) ──
    // Rede do disparo pós-submissão + mantém os embeddings do corpus de aprovados em dia.
    // NO-OP se AVALIACAO_NORMAIS está OFF (default). Grava a recomendação em `projeto_avaliacao`,
    // NUNCA muda o status. Bounded por corrida (idempotente, converge em várias).
    if (pathname === "/api/cron/avaliar-normais" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await avaliarProjetosNormaisPendentes({ dry: false, limite: 10 }));
    }

    // ── Cron: avança a DELIBERAÇÃO das mesas ABERTAS (fatia C, MODO SOMBRA) ──
    // Máquina de estados persistida: cada corrida roda +1 rodada dos `deliberando`, bounded,
    // até consenso ou nao_consenso. NO-OP se AVALIACAO_NORMAIS OFF. NUNCA muda o status.
    if (pathname === "/api/cron/deliberar-avaliacoes" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await avancarDeliberacoesPendentes({ dry: false, limite: 10 }));
    }

    // ── Cron: RETROATIVO — mede a mesa contra o veredito humano (fatia C, MODO SOMBRA) ──
    // Roda a mesa nos projetos já decididos pelo humano (aprovado/reprovado no espelho) e grava
    // acerto/erro em `avaliacao_retroativa`. NO-OP se OFF. SEM tocar status. Bounded/idempotente.
    if (pathname === "/api/cron/avaliacao-retroativa" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await avaliarRetroativo({ dry: false, limite: 20 }));    }

    // ── Cron: snapshot diário das pendências de pré-aprovação → Gomoon (D17) ──
    // 1×/dia às 09h BRT (`0 12 * * 1-5` — o cron do Godeploy é UTC). O Gomoon
    // enfileira, monta a mensagem e entrega a DM pelo bot dele; o GoDocs não fala
    // com a API do Google Chat. Ver docs/integracao-gomoon-chat.md.
    // ⚠️ Dia sem pendência dispara IGUAL, com `lideres: []` — silêncio seria
    // indistinguível de cron morto. A função nunca lança: o corpo é o relatório.
    if (pathname === "/api/cron/notificar-lideres" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await notificarLideresPendentes());
    }

    // ── Meus Projetos (filtrado pelo email do header — anti-IDOR) ──
    if (pathname === "/api/meus-projetos" && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      return json(await listarMeusProjetos(email));
    }
    // Contagem de pendentes (legados sem "Atualizado Em") — selo da home. ANTES do
    // GET genérico abaixo, senão "pendentes" seria tratado como id de projeto.
    if (pathname === "/api/meus-projetos/pendentes" && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const sync = url.searchParams.get("sync") === "1";
      return json(await contarPendentes(email, { sync }));
    }
    // Excluir um RASCUNHO (ownership + só status 'rascunho').
    if (pathname.startsWith("/api/meus-projetos/") && method === "DELETE") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const id = pathname.replace("/api/meus-projetos/", "").split("/")[0];
      return json(await excluirRascunho(email, id));
    }
    // Distribuir o poder de edição: define os editores delegados (participantes que
    // podem editar/reenviar como o dono). Gate de ownership/cascata na função.
    // ANTES do GET genérico abaixo (mas é POST, então sem colisão real de método).
    if (
      pathname.startsWith("/api/meus-projetos/") &&
      pathname.endsWith("/editores") &&
      method === "POST"
    ) {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const id = pathname.replace("/api/meus-projetos/", "").split("/")[0];
      const body = await readBody<{ editores?: unknown }>(request);
      return json(await definirEditoresDelegados(email, id, body?.editores));
    }
    // Marcar/desmarcar como DESCONTINUADO (deixa de contar como pendência). Gate de
    // ownership/edição na função. ANTES do GET genérico abaixo (POST, sem colisão).
    if (
      pathname.startsWith("/api/meus-projetos/") &&
      pathname.endsWith("/descontinuar") &&
      method === "POST"
    ) {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const id = pathname.replace("/api/meus-projetos/", "").split("/")[0];
      const body = await readBody<{ descontinuar?: unknown }>(request);
      return json(await descontinuarProjeto(email, id, body?.descontinuar === true));
    }
    if (pathname.startsWith("/api/meus-projetos/") && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const id = pathname.replace("/api/meus-projetos/", "").split("/")[0];
      return json(await getMeuProjeto(id, email));
    }
    // Histórico de chat de um rascunho — usado na retomada cross-device.
    if (pathname.startsWith("/api/chat/historico/") && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const id = pathname.replace("/api/chat/historico/", "").split("/")[0];
      return json(await getHistoricoMeuProjeto(id, email));
    }

    // ── Widget de Ajuda & Suporte (autenticado, NÃO admin) ──
    // Fora do prefixo /api/chat/ de propósito: é um caminho dedicado que NÃO passa
    // pelo dispatcher de chat nem grava api_logs. Qualquer usuário logado pode pedir
    // ajuda. Erros de validação do schema sobem como 400 (ver criarChamadoAjuda).
    if (pathname === "/api/ajuda" && method === "POST") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const body = await readBody(request);
      return json(await criarChamadoAjuda(email, body));
    }

    // ── FAQ (leitura: qualquer pessoa logada) ──
    // A escrita mora em /api/admin/faq/* atrás de requireAdmin. O frontend usa
    // /api/auth/me só para decidir o que PINTA — nunca como autorização (SPEC_FAQ D4).
    if (pathname === "/api/faq" && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      return json(await listarFaq({ admin: await isAdmin(email) }));
    }

    // ── Pré-aprovação do líder (autenticado, NÃO admin) ──
    // A fila é do LÍDER do autor (derivada da TeamGuide na submissão). O gate real é
    // server-side: `decidirAprovacao` só grava se existir linha pendente para o e-mail
    // do header (ver aprovacoes.functions.ts) — o frontend nunca autoriza nada.
    //
    // `?como=<e-mail>` abre a fila de OUTRA pessoa e existe para a validação da tela
    // (o admin precisa ver o que o líder vê). Só ADMIN pode usar; qualquer outro e-mail
    // no parâmetro é ignorado e a pessoa vê a própria fila. Ao decidir nesse modo, o
    // `decidido_por` gravado é o do ADMIN — a auditoria não finge que o líder clicou.
    if (pathname === "/api/aprovacoes/pendentes" && method === "GET") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const como = (url.searchParams.get("como") ?? "").trim().toLowerCase();
      const preview = como && como !== email.toLowerCase() && (await isAdmin(email)) ? como : null;
      const fila = await listarAprovacoesPendentes(preview ?? email);
      return json({ ...fila, visualizando_como: preview });
    }
    if (pathname === "/api/aprovacoes/decidir" && method === "POST") {
      const email = getEmailFromRequest(request);
      if (!email) return errorJson("Não autorizado.", 401);
      const body = await readBody<Record<string, unknown>>(request);
      const como = String(body?.como ?? "")
        .trim()
        .toLowerCase();
      const preview = como && como !== email.toLowerCase() && (await isAdmin(email)) ? como : null;
      return json(
        await decidirAprovacao(preview ?? email, body, preview ? { atorReal: email } : undefined),
      );
    }

    // ── Chat (público — qualquer usuário pode submeter) ──
    // Todas as rotas /api/chat/* são logadas na tabela api_logs para o Investigador.
    if (pathname.startsWith("/api/chat/") && method === "POST") {
      const body = await readBody<Record<string, unknown>>(request);
      const reqJson = JSON.stringify(body);
      const requestSize = reqJson.length;
      const projetoId = (body.projeto_id as string) ?? null;
      const start = Date.now();
      let statusCode = 200;
      let errorMsg: string | null = null;
      let responseSize = 0;

      // ── STREAMING (SSE) ──────────────────────────────────────────────────────
      // Só as 4 rotas de CONVERSA streamam, e só com a flag LLM_STREAMING ligada. Quando
      // desligada, cai no caminho json() de sempre (comportamento idêntico ao de hoje) — e
      // o cliente (apiStream) trata os dois transportes, então ligar/desligar é só a env,
      // sem redeploy do cliente. A prosa vai como eventos `delta`; o OrchestratorResult
      // COMPLETO (já passado pelos gates) vai como `envelope` no fim; erro vira `error`.
      const rotasStream = new Set([
        "/api/chat/iniciar-submissao",
        "/api/chat/enviar-mensagem",
        "/api/chat/iniciar-saving",
        "/api/chat/iniciar-receita",
      ]);
      if (streamingLigado() && rotasStream.has(pathname)) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        const send = (obj: unknown) =>
          writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)).catch(() => {});
        const onDelta = (c: string) => {
          void send({ t: "delta", c });
        };

        const tarefa = (async () => {
          try {
            let result: unknown;
            const solicitante = getEmailFromRequest(request);
            if (pathname === "/api/chat/iniciar-submissao")
              result = await iniciarSubmissao(body, solicitante, { onDelta });
            else if (pathname === "/api/chat/enviar-mensagem")
              result = await enviarMensagem(body, { onDelta });
            else if (pathname === "/api/chat/iniciar-saving")
              result = await iniciarSaving(body, solicitante, { onDelta });
            else result = await iniciarReceita(body, solicitante, { onDelta });

            const resJson = JSON.stringify(result);
            responseSize = resJson.length;
            const logProjetoId =
              projetoId ?? (result as { projeto_id?: string })?.projeto_id ?? null;
            // Envelope + FECHA o stream já: é o fechamento do stream (done) que faz o
            // apiStream do cliente resolver e liberar o botão "Enviar para Triagem"
            // (setChatComplete). O insertApiLog é observability (grava req+resp inteiros) e
            // estava ANTES do send, segurando o botão à toa; mesmo depois do send ele seguraria,
            // porque o cliente espera o `done`. Então fecha aqui e grava DEPOIS: o
            // `ctx.waitUntil(tarefa)` mantém o isolate vivo até o log terminar, sem perdê-lo.
            // (O finally fecha de novo no caminho de erro — writer.close() repetido é no-op.)
            await send({ t: "envelope", r: result });
            await writer.close().catch(() => {});
            await insertApiLog({
              projeto_id: logProjetoId,
              endpoint: pathname,
              method,
              duration_ms: Date.now() - start,
              status_code: statusCode,
              request_size: requestSize,
              response_size: responseSize,
              request_body: reqJson,
              response_body: resJson,
            }).catch(() => {});
          } catch (e) {
            const err = e as Error & { status?: number; bloqueio?: unknown };
            const amigavel = traduzirErroValidacao(e);
            statusCode = amigavel?.status ?? err.status ?? 500;
            errorMsg = err.message;
            await insertApiLog({
              projeto_id: projetoId,
              endpoint: pathname,
              method,
              duration_ms: Date.now() - start,
              status_code: statusCode,
              error: errorMsg,
              request_size: requestSize,
              response_size: 0,
              request_body: reqJson,
              response_body: null,
            }).catch(() => {});
            // Erro vai DENTRO do stream (o HTTP já é 200): o cliente reconstrói o ApiError
            // com o status/bloqueio para mostrar o mesmo painel de sempre.
            await send({
              t: "error",
              m: amigavel?.mensagem ?? err.message,
              status: statusCode,
              ...(err.bloqueio ? { bloqueio: err.bloqueio } : {}),
            });
          } finally {
            await writer.close().catch(() => {});
          }
        })();
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(tarefa);

        return new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      }

      try {
        let result: unknown;
        if (pathname === "/api/chat/iniciar-submissao")
          result = await iniciarSubmissao(body, getEmailFromRequest(request));
        else if (pathname === "/api/chat/enviar-mensagem") result = await enviarMensagem(body);
        else if (pathname === "/api/chat/iniciar-saving")
          result = await iniciarSaving(body, getEmailFromRequest(request));
        else if (pathname === "/api/chat/iniciar-receita")
          result = await iniciarReceita(body, getEmailFromRequest(request));
        else if (pathname === "/api/chat/atualizar-tipos") result = await atualizarTipos(body);
        else if (pathname === "/api/chat/atualizar-metadados")
          result = await atualizarMetadados(body);
        else if (pathname === "/api/chat/analisar") result = await analisarProjetoFn(body);
        else if (pathname === "/api/chat/submeter-validacao")
          result = await submeterParaValidacao(body, getEmailFromRequest(request));
        else return errorJson("Rota não encontrada", 404);

        // Análise automática (analisador) roda no SERVIDOR, em background, logo após
        // a submissão. Roda também para ESPECIAIS — neles o analisador NÃO decide
        // status (validação é humana), mas agrega complexidade + parecer (incl. o
        // veredito "é mesmo especial?"). Antes a tela de sucesso esperava a análise
        // (gerava ansiedade); agora a pessoa vê "Projeto Enviado!" e o resultado
        // aparece depois em "Meus Projetos". O waitUntil mantém o Worker vivo até
        // concluir mesmo sem o cliente conectado.
        if (pathname === "/api/chat/submeter-validacao") {
          const pid = (body.projeto_id as string) ?? null;
          if (pid) {
            const p = processarPosSubmissao(pid);
            if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
          }
        }

        const resJson = JSON.stringify(result);
        responseSize = resJson.length;
        // Para iniciar-submissao, o projeto_id vem no resultado (ainda não existia no body)
        const logProjetoId = projetoId ?? (result as { projeto_id?: string })?.projeto_id ?? null;
        await insertApiLog({
          projeto_id: logProjetoId,
          endpoint: pathname,
          method,
          duration_ms: Date.now() - start,
          status_code: statusCode,
          request_size: requestSize,
          response_size: responseSize,
          request_body: reqJson,
          response_body: resJson,
        }).catch(() => {});
        return new Response(resJson, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        const err = e as Error & { status?: number; bloqueio?: unknown };
        // Erro de VALIDAÇÃO (ZodError) → 400 com frase em PT-BR nomeando o campo e o
        // limite. Antes subia o JSON cru do Zod (`{"code":"too_big",…}`) como 500 e o
        // toast mostrava isso em inglês — a pessoa não tinha o que corrigir (bug real,
        // caso Josiely 05/08/2026). No `api_logs` gravamos o erro TÉCNICO (`err.message`),
        // para o Investigador não perder o path exato do campo.
        const amigavel = traduzirErroValidacao(e);
        statusCode = amigavel?.status ?? err.status ?? 500;
        errorMsg = err.message;
        await insertApiLog({
          projeto_id: projetoId,
          endpoint: pathname,
          method,
          duration_ms: Date.now() - start,
          status_code: statusCode,
          error: errorMsg,
          request_size: requestSize,
          response_size: 0,
          request_body: reqJson,
          response_body: null,
        }).catch(() => {});
        // Bloqueio de submissão (preenchimento, não falha): vai ESTRUTURADO para a tela, que
        // o mostra como painel âmbar com os caminhos de correção. `status` já vem 400 do
        // `erroDeBloqueio` — nunca 5xx, senão o Investigador leria como instabilidade.
        return errorJson(
          amigavel?.mensagem ?? err.message,
          statusCode,
          err.bloqueio ? { bloqueio: err.bloqueio } : undefined,
        );
      }
    }

    // ── Admin (requer admin) ──
    if (pathname === "/api/admin/validar-projeto" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody(request);
      const result = await validarProjeto(body);
      return json(result);
    }

    if (pathname === "/api/admin/areas" && method === "GET") {
      await requireAdmin(request);
      return json(await getAreas());
    }
    if (pathname === "/api/admin/areas/sync" && method === "POST") {
      await requireAdmin(request);
      return json(await sincronizarAreas());
    }
    if (pathname === "/api/admin/areas" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody<{ nome: string }>(request);
      return json(await createArea(body.nome, email));
    }
    if (pathname === "/api/admin/areas/remove" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody<{ id: string }>(request);
      return json(await deleteArea(body.id, email));
    }
    if (pathname.startsWith("/api/admin/areas/") && method === "DELETE") {
      const { email } = await requireAdmin(request);
      const id = pathname.split("/").pop()!;
      return json(await deleteArea(id, email));
    }

    // ── FAQ: escrita (só admin) ──
    // Cada assunto do FAQ é UM documento (título + resumo + corpo em markdown leve), então
    // há uma rota de escrita só. "Remover" é ARQUIVAR (não existe DELETE aqui — os links do
    // FAQ circulam em Chat, e-mail e dentro do formulário) e o slug é imutável na edição.
    // Ver SPEC_FAQ.md (D2, D6, D13).
    if (pathname === "/api/admin/faq/categoria" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await salvarCategoria(email, body));
    }
    // Volta para a versão imediatamente anterior do texto (1 nível — D14). O texto atual
    // é descartado: a tela confirma isso antes de chamar.
    if (pathname === "/api/admin/faq/desfazer" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await desfazerFaq(email, body));
    }
    if (pathname === "/api/admin/faq/arquivar" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await arquivarFaq(email, body));
    }
    if (pathname === "/api/admin/faq/reordenar" && method === "POST") {
      const { email } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await reordenarFaq(email, body));
    }

    if (pathname === "/api/admin/admins" && method === "GET") {
      await requireAdmin(request);
      return json(await getAdmins());
    }
    if (pathname === "/api/admin/admins" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ email: string; nome?: string }>(request);
      return json(await addAdmin(body));
    }
    if (pathname === "/api/admin/admins/remove" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{ id: string }>(request);
      return json(await removeAdmin(body.id, adminEmail));
    }

    if (pathname === "/api/admin/projetos" && method === "GET") {
      await requireAdmin(request);
      return json(await getProjetos());
    }
    if (pathname.startsWith("/api/admin/projetos/") && method === "GET") {
      await requireAdmin(request);
      const id = pathname.split("/").pop()!;
      return json(await getProjetoDetalhes(id));
    }

    // ── Dashboard do admin (triagem sobre a PLANILHA, não o estado interno) ──
    // Ver src/lib/dashboard-admin.functions.ts: a listagem é a LINHA DA PLANILHA (o "Status"
    // que vale é o da coluna do Sheets), lida do ESPELHO no SQLite — não do Sheets em
    // request. `?refresh=1` não "fura cache": roda um sync de verdade e relê o espelho.
    if (pathname === "/api/admin/dashboard/projetos" && method === "GET") {
      await requireAdmin(request);
      const refresh = url.searchParams.get("refresh") === "1";
      // no-store: dado de triagem tem de vir SEMPRE fresco do espelho — sem
      // Cache-Control o browser/edge pode servir payload velho e a triagem olha
      // dado defasado sem perceber (handoff Ytalo, 17/08).
      return json(await listarProjetosDashboard(refresh), 200, {
        "Cache-Control": "no-store",
      });
    }
    // Lote de fichas da PÁGINA visível: 1 requisição no lugar de 25 (cada uma custa
    // ~750 ms de overhead fixo do edge). POST porque 25 ids não cabem num querystring
    // com folga. Lê só o espelho, como a rota individual.
    if (pathname === "/api/admin/dashboard/projetos/lote" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody(request);
      return json(await getProjetosDashboardLote(body));
    }
    if (pathname.startsWith("/api/admin/dashboard/projetos/") && method === "GET") {
      await requireAdmin(request);
      const id = decodeURIComponent(pathname.split("/").pop()!);
      return json(await getProjetoDashboard(id), 200, {
        "Cache-Control": "no-store",
      });
    }
    if (pathname === "/api/admin/dashboard/status" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await definirStatusProjeto(body, adminEmail));
    }
    // Feedback 👍/👎 do admin sobre a recomendação em SOMBRA (teste sombra do time de
    // avaliação) — SINAL DE TREINAMENTO. Não muda status: grava/apaga a linha em
    // `avaliacao_feedback`. Só admin (mesmo gate da triagem).
    if (pathname === "/api/admin/avaliacao/feedback" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await registrarFeedbackSombra(body, adminEmail));
    }

    // Feed unificado de ações do painel (drawer "Histórico"): quem aprovou/reprovou/pediu
    // reenvio, deu estrelas, dividiu área, reabriu fila — mais recente primeiro, paginado
    // por cursor opaco. Só admin (mesmo gate das 3 telas que abrem o drawer).
    if (pathname === "/api/admin/atividades" && method === "GET") {
      await requireAdmin(request);
      return json(
        await listarAtividades({
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
        }),
        200,
        { "Cache-Control": "no-store" },
      );
    }

    // ── Comparador de projetos ESPECIAIS (a régua por ÂNCORA) ───────────────
    // Ver src/lib/especiais.functions.ts: lê o MESMO espelho da triagem, só que agrupado por
    // NÍVEL, com a recomendação da auditoria por projeto. A nota segue na
    // coluna manual "Estrelas" da planilha — a rota de estrelas escreve SÓ ela.
    if (pathname === "/api/admin/especiais" && method === "GET") {
      await requireAdmin(request);
      return json(await listarEspeciais());
    }
    if (pathname === "/api/admin/especiais/estrelas" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await definirEstrelasEspecial(body, adminEmail));
    }
    // Divisão da validação: qual admin cuida de cada ÁREA. Interno, nunca vai à planilha.
    if (pathname === "/api/admin/especiais/dono" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody(request);
      return json(await definirDonoDeArea(body, adminEmail));
    }
    // Lote de recomendações da auditoria (hoje o JSON da força-tarefa, amanhã o agente
    // classificador). NUNCA toca a planilha — a nota só muda por clique de gente.
    if (pathname === "/api/admin/especiais/avaliacoes" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody(request);
      return json(await importarAvaliacoesEspeciais(body));
    }
    // Agente classificador (peça 4) — recomenda a estrela de UM especial via RAG. `dry` não grava.
    // NUNCA toca a coluna "Estrelas": a recomendação vive em `especial_avaliacao`.
    if (pathname === "/api/admin/especiais/classificar" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as {
        projetoId?: string;
        dry?: boolean;
        forcar?: boolean;
      };
      if (!body.projetoId) return errorJson("projetoId é obrigatório.", 400);
      return json(
        await classificarEspecialProjeto(body.projetoId, { dry: body.dry, forcar: body.forcar }),
      );
    }
    // Backfill: classifica os especiais SEM recomendação. `dry` é o DEFAULT (gravar exige
    // {"dry":false}); `forcar` reavalia todos; `limite` limita a corrida.
    if (pathname === "/api/admin/especiais/classificar-pendentes" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as {
        dry?: boolean;
        limite?: number;
        forcar?: boolean;
      };
      return json(
        await classificarEspeciaisPendentes({
          dry: body.dry,
          limite: body.limite,
          forcar: body.forcar,
        }),
      );
    }

    // ── Time autônomo de avaliação de NORMAIS (fatia B, MODO SOMBRA) — rotas manuais ──
    // Avalia UM projeto normal (RAG + FTE + Financeiro → Agregador). `dry` não grava. NO-OP se
    // AVALIACAO_NORMAIS OFF ou se o projeto é especial. NUNCA muda o status (só grava recomendação).
    if (pathname === "/api/admin/avaliar-normais" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { projetoId?: string; dry?: boolean };
      if (!body.projetoId) return errorJson("projetoId é obrigatório.", 400);
      return json(await avaliarProjetoNormal(body.projetoId, { dry: body.dry }));
    }
    // Backfill: avalia os normais SEM recomendação + mantém os embeddings do corpus. `dry` é o
    // DEFAULT (gravar exige {"dry":false}); `limite` limita a corrida.
    if (pathname === "/api/admin/avaliar-normais-pendentes" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { dry?: boolean; limite?: number };
      return json(
        await avaliarProjetosNormaisPendentes({ dry: body.dry, limite: body.limite }),
      );
    }
    // Deliberação: avança as mesas abertas. `dry` DEFAULT (gravar exige {"dry":false}). NO-OP se OFF.
    if (pathname === "/api/admin/deliberar-avaliacoes" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { dry?: boolean; limite?: number };
      return json(await avancarDeliberacoesPendentes({ dry: body.dry, limite: body.limite }));
    }
    // Retroativo: mede a mesa contra o veredito humano. `dry` DEFAULT (gravar exige {"dry":false}).
    if (pathname === "/api/admin/avaliacao-retroativa" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { dry?: boolean; limite?: number };
      return json(await avaliarRetroativo({ dry: body.dry, limite: body.limite }));
    }

    // ── Índice vetorial dos especiais no Pinecone (plataforma oficial) ───────
    // Setup (T1): descreve o índice. Só CRIA com {"criar":true} — criar índice é ato de
    // infraestrutura, não efeito colateral de uma leitura. A dimensão (3072) é IMUTÁVEL:
    // se o índice existente tiver outra, a resposta reprova em vez de usar.
    if (pathname === "/api/admin/especiais/pinecone/indice" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { criar?: boolean };
      return json(await prepararIndicePinecone({ criar: body.criar }));
    }
    // Backfill (T5): sobe para o índice os vetores que já existem no SQLite. `dry` é o
    // DEFAULT; varre em páginas (`proximo_offset` diz onde continuar).
    if (pathname === "/api/admin/especiais/pinecone/backfill" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as {
        dry?: boolean;
        limite?: number;
        offset?: number;
      };
      return json(
        await sincronizarPineconeEspeciais({
          dry: body.dry,
          limite: body.limite,
          offset: body.offset,
        }),
      );
    }
    // Re-auditoria (T6): compara cada nota HUMANA com a mediana dos vizinhos de nota humana
    // e reporta inflação/deflação. ⚠️ SÓ RELATÓRIO — não existe caminho de escrita, e por
    // isso não há `dry`. A coluna "Estrelas" continua sendo só de clique humano.
    if (pathname === "/api/admin/especiais/reauditar" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { limite?: number; offset?: number };
      return json(await reauditarEspeciais({ limite: body.limite, offset: body.offset }));
    }

    // Concordância (T1 do painel de agentes): roda o classificador de HOJE nos especiais que já
    // têm nota humana e compara — MAE, % dentro de ±1, viés, matriz por faixa e a distribuição
    // contra a CURVA_BASE. É o BASELINE que o painel tem de bater (trava de subida do T7).
    // ⚠️ SOMENTE LEITURA — não existe `dry` porque não existe caminho de escrita: a nota humana
    // aqui é GABARITO, e nada é gravado em `especial_avaliacao` nem na coluna "Estrelas".
    // Paginado: `proximo_offset` diz onde continuar (é ~1 chamada de LLM por projeto).
    // ⚠️ `juiz: "painel"` mede o PAINEL de agentes (T7) no MESMO harness — é a trava de subida do
    // plano. Continua SEM caminho de escrita, e a página é menor de propósito (~7 chamadas e até
    // ~40 s por projeto, contra ~10 s do agente único).
    if (pathname === "/api/admin/especiais/concordancia" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as {
        limite?: number;
        offset?: number;
        juiz?: string;
        lentes?: string[];
      };
      if (body.juiz === "painel") {
        return json(
          await medirConcordanciaPainel({
            limite: body.limite,
            offset: body.offset,
            lentes: body.lentes,
          }),
        );
      }
      return json(await medirConcordanciaAgente({ limite: body.limite, offset: body.offset }));
    }

    // Roteamento por FUNÇÃO (T2 do painel): classifica cada especial numa função DECLARADA
    // (`TAXONOMIA_FUNCAO`) e mede a cobertura da taxonomia contra a base. Determinístico —
    // vocabulário, não LLM —, então mesmo texto devolve sempre a mesma função (é o que faz duas
    // corridas serem comparáveis). ⚠️ SOMENTE LEITURA e sem `dry`: função é ROTA, não nota.
    if (pathname === "/api/admin/especiais/funcoes" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as { limite?: number; offset?: number };
      return json(await rotearEspeciaisPorFuncao({ limite: body.limite, offset: body.offset }));
    }

    // PAINEL DE AGENTES (T6): lentes distintas → calibrador → revisor adversarial, em LOTE.
    // ⚠️ `dry` é o DEFAULT — gravar exige {"dry":false} explícito (mesma trava do
    // `converter-custo-evitado-puro`). Grava só em `especial_avaliacao` com origem
    // `painel-agentes`; NUNCA a coluna "Estrelas" e nunca o Sheets.
    // ⚠️ Paginado E limitado por CUSTO: ~8 chamadas de LLM por projeto, ~30–50 s de relógio cada,
    // então a corrida para no `tetoChamadas` e devolve `proximo_offset` de onde continuar.
    // `soComNotaHumana:true` julga exatamente o test set do T7.
    if (pathname === "/api/admin/especiais/painel" && method === "POST") {
      await requireAdmin(request);
      const body = (await readBody(request)) as {
        dry?: boolean;
        limite?: number;
        offset?: number;
        forcar?: boolean;
        soComNotaHumana?: boolean;
        lentes?: string[];
        aplicarCota?: boolean;
        tetoChamadas?: number;
        redigirLeitura?: boolean;
      };
      return json(
        await julgarEspeciaisComPainel({
          dry: body.dry,
          limite: body.limite,
          offset: body.offset,
          forcar: body.forcar,
          soComNotaHumana: body.soComNotaHumana,
          lentes: body.lentes,
          aplicarCota: body.aplicarCota,
          tetoChamadas: body.tetoChamadas,
          redigirLeitura: body.redigirLeitura,
        }),
      );
    }

    // ── Aba TEMPORÁRIA: aprovação de pendentes/pré-aprovados, por AUTOR ──────
    // Ver src/lib/aprovacao-pendentes.functions.ts: mesmo espelho da triagem, recortado aos
    // pendentes/pré-aprovados do fluxo normal. Ações e divisão reusam os endpoints já acima
    // (`/api/admin/dashboard/status` e `/api/admin/especiais/dono`) — aqui só a LEITURA.
    if (pathname === "/api/admin/aprovacao-pendentes" && method === "GET") {
      await requireAdmin(request);
      return json(await listarAprovacaoPendentes());
    }
    if (pathname === "/api/admin/usuarios" && method === "GET") {
      await requireAdmin(request);
      return json(await getUsuarios());
    }

    if (pathname === "/api/admin/users" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody(request);
      return json(await createUser(body));
    }
    if (pathname === "/api/admin/users/delete" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{ userId: string }>(request);
      return json(await deleteUser(body.userId, adminEmail));
    }
    if (pathname === "/api/admin/users/update-areas" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody(request);
      return json(await updateUserAreas(body));
    }

    if (pathname === "/api/admin/configuracoes" && method === "GET") {
      await requireAdmin(request);
      return json(await getConfiguracoes());
    }
    if (pathname === "/api/admin/configuracoes" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{ chave: string; valor: unknown }>(request);
      return json(await updateConfiguracao(body.chave, body.valor, adminEmail));
    }

    // ── Investigador (requer admin) ──
    if (pathname === "/api/admin/investigador/projetos" && method === "GET") {
      await requireAdmin(request);
      return json(await getProjetosInvestigador());
    }
    if (pathname === "/api/admin/investigador/stats" && method === "GET") {
      await requireAdmin(request);
      return json(await getInvestigadorStats());
    }
    if (pathname === "/api/admin/investigador/edicoes" && method === "GET") {
      await requireAdmin(request);
      return json(await getEdicoesInvestigador());
    }
    if (pathname === "/api/admin/investigador/pendentes-aprovacao" && method === "GET") {
      await requireAdmin(request);
      return json(await getProjetosPendentesAprovacaoInvestigador());
    }

    // ── Backfill de docs ao Drive: AVALIAÇÃO (read-only) ──
    // Conta quantos documentos de projetos recentes (não-legado) são recuperáveis
    // do api_logs (recuperável × parcial × perdido) antes de executar o backfill.
    if (pathname === "/api/admin/docs-backfill/assess" && method === "GET") {
      await requireAdmin(request);
      return json(await assessDocsBackfill());
    }
    if (pathname.startsWith("/api/admin/investigador/projetos/") && method === "GET") {
      await requireAdmin(request);
      const id = pathname.split("/").pop()!;
      return json(await getProjetoInvestigadorDetalhes(id));
    }
    // Corpo de um log de API específico (carregado sob demanda)
    if (pathname.startsWith("/api/admin/investigador/log/") && method === "GET") {
      await requireAdmin(request);
      const logId = pathname.split("/").pop()!;
      const log = await getApiLogById(logId);
      if (!log) return errorJson("Log não encontrado", 404);
      return json({
        id: log.id,
        request_body: log.request_body,
        response_body: log.response_body,
      });
    }

    // ── Re-sync Google (TEMPORÁRIO, admin) ──
    // Re-dispara o sync Sheets+Chat de um projeto já submetido, SEM reanálise de
    // IA. GET para facilitar o disparo pelo navegador logado. REMOVER depois.
    if (pathname === "/api/admin/resync-google" && method === "GET") {
      await requireAdmin(request);
      const projetoId = url.searchParams.get("projeto_id");
      if (!projetoId) return errorJson("Informe ?projeto_id=...", 400);
      return json(await resyncGoogle({ projeto_id: projetoId }));
    }

    // ── Retroativo: custo evitado/projeto PONTUAL sem ÷12 (admin) ──
    // Recomputa projetos submetidos ANTES da remoção do ÷12 (SPEC_CORRECOES 01/07/2026):
    // custo evitado/projeto pontual passa a entrar pelo valor CHEIO. Body { dry?: boolean }
    // — dry (DEFAULT true) só relata o que mudaria; { "dry": false } aplica (SQLite +
    // colunas afetadas do Sheets, SEM notificar o Chat). Idempotente (só toca quem tem
    // item pontual e cujo valor de fato muda).
    if (pathname === "/api/admin/retroativo-custos-pontuais" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ dry?: boolean }>(request);
      return json(await retroativoCustosPontuais(body));
    }

    // ── Reconciliação financeira PLANILHA → SQLITE (admin) ──
    // Puxa para o banco os números já corrigidos pela triagem na planilha (colunas
    // financeiras + itens de custo evitado/projeto), que o sync reverso não cobre.
    // Sem isso o formulário de edição seeda do SQLite antigo e o próximo reenvio
    // REVERTE a correção. Não escreve nada no Sheets. `dry: true` só devolve o diff.
    if (pathname === "/api/admin/reconciliar-financeiro" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ projetoId?: string; dry?: boolean }>(request);
      if (!body?.projetoId) return errorJson("projetoId é obrigatório", 400);
      return json(await reconciliarFinanceiroDoSheet(body.projetoId, { dry: body.dry }));
    }

    // ── Converter para CUSTO EVITADO PURO (admin, correção de dupla contagem) ──
    // Remove as `linhas` de horas do SQLite quando a submissão contou o mesmo
    // trabalho duas vezes (horas + contrato que pagava justamente essas horas). O
    // `reconciliar-financeiro` NÃO cobre isto: ele recalcula o total a partir das
    // linhas, então com as horas ainda no banco devolve o número velho. Não escreve
    // nada no Sheets. ⚠️ `dry` é o DEFAULT — gravar exige `{"dry":false}`.
    if (pathname === "/api/admin/converter-custo-evitado-puro" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ projetoId?: string; dry?: boolean }>(request);
      if (!body?.projetoId) return errorJson("projetoId é obrigatório", 400);
      return json(await converterParaCustoEvitadoPuro(body.projetoId, { dry: body.dry }));
    }

    // ── Reabrir a fila do líder (admin, recuperação) ──
    // A fila é interna (`projeto_aprovacoes`) e cai em CASCATA junto do projeto —
    // sobrescrever a aba do Sheets faz a `reconciliarExclusoes` apagar o projeto e,
    // com ele, a fila; restaurar a aba recria o projeto, nunca a fila. Isto repõe.
    // ⚠️ `dry` é o DEFAULT: escrever exige `{"dry":false}` explícito no body.
    if (pathname === "/api/admin/aprovacoes/reabrir" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const resultado = await reabrirPreAprovacoes(await readBody<unknown>(request));
      // Feed do painel: só as reaberturas que de fato aconteceram (nunca o dry-run).
      if (!resultado.dry) {
        for (const r of resultado.reabertos) {
          await registrarAtividade({
            ator_email: adminEmail,
            acao: "reabrir_fila",
            projeto_id: r.projeto_id,
            projeto_nome: r.nome,
            detalhe: "Fila de pré-aprovação reaberta",
            meta: { aprovadores: r.aprovadores },
          });
        }
      }
      return json(resultado);
    }

    // ── Snapshot de pendências → Gomoon, sob demanda (admin) ──
    // MESMO trabalho do cron /api/cron/notificar-lideres, sem o header de cron.
    // Existe porque o cron NÃO dispara na STAGING (mesmo motivo do
    // /api/admin/reanalisar-pendentes abaixo) — sem esta rota não há como validar a
    // integração fora de produção. ⚠️ `{"dry":true}` monta o payload e NÃO envia
    // nada: é assim que se confere o conteúdo sem cutucar ninguém.
    // ⚠️ Com `projetoId`, ensaia o AVISO IMEDIATO (D26) daquele projeto em vez do
    // snapshot: é o único jeito de conferir o payload do caminho quente (chave por
    // projeto, escopo do líder, texto) sem passar um formulário inteiro. Os
    // aprovadores saem da fila REAL do projeto — a rota não abre fila nem inventa
    // líder, então um projeto isento/sem fila devolve 0 e não envia nada.
    if (pathname === "/api/admin/notificar-lideres" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ dry?: boolean; projetoId?: string }>(request).catch(
        () => ({}) as { dry?: boolean; projetoId?: string },
      );
      const dry = body?.dry === true;
      const projetoId = (body?.projetoId ?? "").trim();
      if (!projetoId) return json(await notificarLideresPendentes({ dry }));

      const projeto = await getProjetoById(projetoId);
      if (!projeto) return errorJson("Projeto não encontrado.", 404);
      const aprovadores = (await getAprovacoesDoProjeto(projetoId))
        .filter((a) => a.veredito === "pendente")
        .map((a) => ({ email: a.aprovador_email, nome: a.aprovador_nome }));
      return json(
        await notificarLideresDoProjeto(projetoId, aprovadores, {
          dry,
          nomeProjeto: projeto.nome,
        }),
      );
    }

    // ── Sync reverso manual (admin) ──
    // Dispara o sync Sheets → SQLite sob demanda (mesmo trabalho do cron), útil
    // para validar antes de confiar no agendamento, e é o que a STAGING usa (lá o cron
    // não dispara). É a mesma coisa que o botão "Atualizar" do /dashboard faz.
    if (pathname === "/api/admin/sync-sheets-now" && method === "POST") {
      await requireAdmin(request);
      return json(await syncSheetsToSqlite("manual"));
    }

    // ── Saúde do ESPELHO da planilha (admin) ──
    // Com as telas lendo o espelho, o único jeito de o sistema MENTIR é o sync morrer em
    // silêncio: a tela seguiria mostrando dado velho com cara de novo. Esta rota (e o aviso
    // no cabeçalho do /dashboard) é o que torna isso visível — última corrida, se deu certo,
    // contadores e há quanto tempo.
    if (pathname === "/api/admin/sync-status" && method === "GET") {
      await requireAdmin(request);
      const [saude, recentes] = await Promise.all([statusEspelho(), getSyncRunsRecentes(20)]);
      return json({ ...saude, recentes });
    }

    // ── Saúde das INTEGRAÇÕES externas (admin) ──
    // Hoje só a TeamGuide: idade do espelho, última corrida e dias restantes do token — para
    // ver, sem abrir log, se o snapshot envelheceu ou o token está perto de vencer.
    if (pathname === "/api/admin/integracoes-status" && method === "GET") {
      await requireAdmin(request);
      return json({
        teamguide: await statusTeamGuideEspelho(),
        tokenDiasRestantes: diasParaExpirarTokenTG(process.env.TG_API_TOKEN),
      });
    }

    // ── Reconciliação da análise sob demanda (admin) ──
    // MESMO trabalho do cron /api/cron/reanalisar-pendentes, sem o header de cron:
    // repõe "Complexidade"/"Classificação" que a análise em background não chegou a
    // gravar (ou re-roda o analisador de quem nunca foi analisado). Existe porque o
    // cron de 1 min NÃO dispara na STAGING (conferido em 29/07/2026: habilitado às
    // 17:02, seguiu `last=never`) — sem esta rota não há como validar o lado do
    // analisador (Classificação/Reprovado/Motivo) fora de produção. Idempotente.
    if (pathname === "/api/admin/reanalisar-pendentes" && method === "POST") {
      await requireAdmin(request);
      return json(await reconciliarComplexidade());
    }

    // ── Recompilação de docs pendentes sob demanda (admin) ──
    // MESMO trabalho do cron /api/cron/recompilar-docs-pendentes, sem o header de cron —
    // para backfill/validação na staging (onde o cron não dispara). Idempotente.
    if (pathname === "/api/admin/recompilar-docs-pendentes" && method === "POST") {
      await requireAdmin(request);
      return json(await recompilarDocsPendentes());
    }

    // ── Reconciliação de SNAPSHOTS sob demanda (admin) ──
    // MESMO trabalho do cron /api/cron/reconciliar-snapshots, sem o header de cron:
    // fecha os furos do histórico de versões (reconstrói versões faltantes marcadas
    // origem='reconciliado'). Existe para o backfill inicial e para validar na staging
    // (o cron não dispara lá). Aceita {max} opcional. Idempotente.
    if (pathname === "/api/admin/reconciliar-snapshots" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ max?: number }>(request).catch(() => ({}) as { max?: number });
      return json(await reconciliarSnapshots(body?.max));
    }

    // ── Backfill do ROLLUP histórico de saving/receita (admin) ──
    // Recomputa INTEIRAMENTE a tabela durável `rollup_saving_receita` (grão mensal, por
    // mês de submitted_at × área × tipo_saving) a partir dos projetos aprovados. Fonte da
    // API histórica do squad Intelli. Idempotente/convergente — rodar de novo dá o mesmo
    // resultado. Existe para o backfill inicial e para validar na staging.
    if (pathname === "/api/admin/rollup-backfill" && method === "POST") {
      await requireAdmin(request);
      return json(await recalcularRollupBackfill());
    }
    // Leitura do rollup durável (admin): células brutas + totais por área.
    // O campo `verificacao` (soma global) NÃO faz parte do contrato do squad Intelli — a
    // regra "sem total geral" vale para o PAYLOAD de saída; aqui é só apoio para bater os
    // números com o /dashboard antes do push.
    if (pathname === "/api/admin/rollup-mensal" && method === "GET") {
      await requireAdmin(request);
      const celulas = await lerRollupMensal();
      const totaisArea = derivarTotaisPorArea(celulas);
      const verificacao = celulas.reduce(
        (acc, c) => ({
          saving_reais: Math.round((acc.saving_reais + c.saving_reais) * 100) / 100,
          receita_reais: Math.round((acc.receita_reais + c.receita_reais) * 100) / 100,
          num_projetos: acc.num_projetos + c.num_projetos,
        }),
        { saving_reais: 0, receita_reais: 0, num_projetos: 0 },
      );
      return json({ celulas, totais_area: totaisArea, verificacao });
    }
    // Push do rollup para o app do squad Intelli (João Gabriel), modelo Gomoon. `dry` é o
    // DEFAULT (monta e devolve o payload sem enviar); enviar exige {"dry":false}. Sem
    // JG_INGEST_URL fica inerte (aguardando o endpoint do Gabriel).
    if (pathname === "/api/admin/rollup-push" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ dry?: boolean }>(request);
      return json(await enviarRollupParaJG({ dry: body.dry !== false }));
    }
    // Cron: recomputa o rollup do espelho e empurra para o Gabriel (não-dry).
    if (pathname === "/api/cron/rollup-push" && method === "POST") {
      if (!request.headers.get("x-godeploy-cron")) {
        return errorJson("Rota exclusiva de cron.", 403);
      }
      return json(await enviarRollupParaJG({ dry: false }));
    }

    // ── Disparo de e-mails por segmento (admin) ──
    // Segmentos: 'legado' (legados pendentes, SQLite) · 'reenvio' (Status "Reenvio Pendente"
    // no Sheets, com motivo) · 'todos' (broadcast a qualquer dono no Sheets). Cada segmento
    // tem sua lista de destinatários e seu template. Prefixo /email-legados mantido (legado).
    // Preview: destinatários do segmento (dedup por e-mail), contagem e template.
    if (pathname === "/api/admin/email-legados/preview" && method === "GET") {
      await requireAdmin(request);
      const audiencia = normalizarAudiencia(url.searchParams.get("audiencia"));
      return json(await getPreviewDisparo(audiencia));
    }
    // Salva o texto editável (assunto + corpo) do e-mail do segmento.
    if (pathname === "/api/admin/email-legados/template" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{ audiencia?: string; assunto: string; corpo: string }>(request);
      await salvarTemplate(
        normalizarAudiencia(body.audiencia),
        { assunto: body.assunto, corpo: body.corpo },
        adminEmail,
      );
      return json({ ok: true });
    }
    // Envia um e-mail de teste só para o próprio admin (com dados de exemplo do segmento).
    if (pathname === "/api/admin/email-legados/teste" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{ audiencia?: string }>(request);
      await enviarEmailTeste(adminEmail, normalizarAudiencia(body.audiencia));
      return json({ ok: true });
    }
    // Dispara o lote do segmento: salva o template (se enviado), cria o lote congelando o
    // payload (destinatários + template) e retorna { loteId, total }. O front chama
    // .../chunk/:loteId em sequência até concluir (o runtime mata tarefas longas).
    if (pathname === "/api/admin/email-legados/enviar" && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const body = await readBody<{
        audiencia?: string;
        assunto?: string;
        corpo?: string;
        emails?: string[];
      }>(request);
      const audiencia = normalizarAudiencia(body.audiencia);
      if (body.assunto && body.corpo) {
        await salvarTemplate(audiencia, { assunto: body.assunto, corpo: body.corpo }, adminEmail);
      }
      const emails = Array.isArray(body.emails) ? body.emails : undefined;
      const { loteId, total } = await iniciarDisparo(adminEmail, audiencia, emails);
      return json({ ok: true, loteId, total });
    }
    // Processa o próximo lote de e-mails (chunk) e devolve o progresso atualizado.
    if (pathname.startsWith("/api/admin/email-legados/chunk/") && method === "POST") {
      const { email: adminEmail } = await requireAdmin(request);
      const loteId = pathname.split("/").pop()!;
      const progresso = await processarChunkLote(adminEmail, loteId);
      if (!progresso) return errorJson("Lote não encontrado", 404);
      return json(progresso);
    }
    // Progresso de um lote de disparo (polling/retomada do front).
    if (pathname.startsWith("/api/admin/email-legados/progresso/") && method === "GET") {
      await requireAdmin(request);
      const loteId = pathname.split("/").pop()!;
      const progresso = await getProgressoLote(loteId);
      if (!progresso) return errorJson("Lote não encontrado", 404);
      return json(progresso);
    }
    // Cancela um lote em andamento (o loop para no próximo e-mail).
    if (pathname.startsWith("/api/admin/email-legados/cancelar/") && method === "POST") {
      await requireAdmin(request);
      const loteId = pathname.split("/").pop()!;
      await cancelarDisparo(loteId);
      return json({ ok: true });
    }

    // ── Limpeza de projetos de TESTE E2E (admin) ──
    // Remove do SQLite todos os projetos com nome "[E2E-..." (cascata limpa o resto).
    // Usado pelo harness de validação (scripts/e2e/cleanup.mjs) DEPOIS de remover as
    // linhas da planilha — ordem importa: se o SQLite for limpo antes, o sync reverso
    // por dono (listarMeusProjetos) ressuscita do Sheets. Remover com o harness.
    if (pathname === "/api/admin/e2e-cleanup" && method === "POST") {
      await requireAdmin(request);
      const ids = await deleteProjetosTesteE2E();
      return json({ ok: true, deletados: ids.length, ids });
    }

    // Exclui um projeto por id (cascade) — admin. Usado para remover órfãos do SQLite
    // que não existem no Sheets (fonte da verdade), evitando que apareçam sem status
    // em "Meus Projetos". NÃO recria: o sync só cria a partir de linhas da planilha.
    if (pathname === "/api/admin/excluir-projeto" && method === "POST") {
      await requireAdmin(request);
      const body = await readBody<{ id?: string }>(request);
      const id = (body.id ?? "").trim();
      if (!id) return errorJson("id obrigatório", 400);
      await excluirProjetoCascade(id);
      return json({ ok: true, id });
    }

    return errorJson("Rota não encontrada", 404);
  } catch (e) {
    const err = e as Error & { status?: number };
    // Mesma tradução do dispatcher de /api/chat/*: validação → 400 legível em PT-BR.
    const amigavel = traduzirErroValidacao(e);
    const status = amigavel?.status ?? err.status ?? 500;
    console.error(`[worker] ${method} ${pathname}:`, err.message);
    return errorJson(amigavel?.mensagem ?? err.message, status);
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    // O godeploy não expõe o global `process` (não há nodejs_compat). Garantimos
    // `process.env` e injetamos as env vars do worker, para os módulos que leem
    // via process.env (supabase, llm, brevo, ocr, etc.). Sem isto, qualquer
    // process.env.X em runtime estoura "process is not defined".
    const g = globalThis as unknown as {
      process?: { env: Record<string, string> };
      __waitUntil?: (p: Promise<unknown>) => void;
    };
    if (!g.process) g.process = { env: {} };
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string") g.process.env[k] = v;
    }

    // Expõe o waitUntil do runtime para o trabalho fire-and-forget (sync Google,
    // limpeza de logs). Sem isto, promises não-aguardadas são canceladas quando a
    // Response retorna — e o sync para Sheets/Chat morre no meio. Ver lib/background.ts.
    if (ctx && typeof ctx.waitUntil === "function") {
      g.__waitUntil = (p: Promise<unknown>) => ctx.waitUntil(p);
    }

    // Injeta o banco SQLite do Godeploy (env.DB) no client.
    // setDb é async (roda initSchema na primeira chamada) — aguardamos antes de
    // rotear qualquer request para garantir que as tabelas existam.
    if (env.DB) {
      await setDb(env.DB);
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, ctx);
    }

    // No godeploy os assets estáticos são servidos pela própria plataforma:
    // requests de navegação que não casam com um asset caem no fallback SPA
    // (assetConfig.not_found_handling = "single-page-application") e nunca
    // chegam aqui. O worker só é invocado para /api/* e para requests de
    // recurso sem asset correspondente (ex.: /favicon.ico) — devolvemos 404.
    // (Não existe binding env.ASSETS no godeploy.)
    return new Response("Not Found", { status: 404 });
  },
};
