// BLOQUEIO TEMPORÁRIO de novas submissões — janela DETERMINÍSTICA + copy.
//
// Objetivo: pausar SUBMISSÕES NOVAS numa janela de tempo (ex.: uma semana), sem
// tocar em nada do que já foi enviado. Projeto já submetido segue em avaliação e
// pode ser editado/reenviado normalmente; a triagem do admin não para. O que a
// janela barra é só o ENVIO de um projeto NOVO.
//
// Por que sem cron: a decisão é uma pura função do relógio. `estaBloqueado(now)`
// compara o instante contra dois marcos UTC fixos (baked) — nada a agendar, nada
// a persistir, nada que possa falhar em background. Para reabrir/mover a janela em
// produção basta setar as envs de override (sem redeploy de lógica); reabrir DE
// VEZ é remover a nota da tela num deploy futuro.
//
// ⚠️ Este módulo roda no CLIENTE e no SERVIDOR (importável pelos dois). Por isso:
//   - NUNCA ler `process.env` em escopo de módulo (derruba o worker no bootstrap
//     do Godeploy, onde `process` não existe na avaliação do módulo). A leitura é
//     LAZY, dentro de `janelaBloqueio()`, e guardada por `typeof process` (no
//     navegador `process` nem existe → cai nos defaults baked, e o gate DURO é o
//     servidor de qualquer forma).
//   - A copy é a FONTE ÚNICA das frases (banner do cliente + recusa do servidor).
//     ⚠️ SEM traço/hífen "-" nem travessão "—" nas frases (decisão de copy).

/** Fase atual em relação à janela de bloqueio. */
export type FaseBloqueio = "antes" | "durante" | "livre";

/** Janela de bloqueio em epoch ms (UTC). */
export type JanelaBloqueio = { inicio: number; fim: number };

// ── Marcos PADRÃO (baked), em UTC ────────────────────────────────────────────
// BRT = UTC-3.
//  • Início: terça 25/08/2026 23h59 BRT  = 2026-08-26T02:59:00Z
//  • Reabre: terça 01/09/2026 00h00 BRT  = 2026-09-01T03:00:00Z
// Bloqueado quando  INICIO <= agora < FIM  (fim é exclusivo = instante de reabertura).
export const INICIO_PADRAO_UTC = "2026-08-26T02:59:00Z";
export const FIM_PADRAO_UTC = "2026-09-01T03:00:00Z";

/**
 * Copy — FONTE ÚNICA. As três frases pedidas (aviso prévio · durante · recusa) se
 * resolvem em DUAS strings, porque a recusa do servidor REUSA a copy do "durante".
 * ⚠️ Sem "-" nem "—" nas frases.
 */
export const COPY_BLOQUEIO = {
  /** ANTES da janela — o botão ainda funciona; é só um lembrete de prazo. */
  avisoPrevio:
    "As novas submissões serão pausadas nesta terça, 25 de agosto, às 23h59. Se você já começou a submissão de um projeto, conclua o envio antes desse horário. Voltamos a receber submissões na terça, 1º de setembro.",
  /** DURANTE a janela — botão bloqueado. Também é a copy da recusa do servidor. */
  durante:
    "As submissões estão pausadas no momento e voltam na terça, 1º de setembro. Os projetos que você já enviou seguem em avaliação normalmente pelo time de RPA.",
} as const;

/** Lê uma env de override de forma LAZY e segura no cliente (sem `process`). */
function lerEnvUtc(chave: string): string | undefined {
  try {
    if (typeof process !== "undefined" && process.env) {
      const v = process.env[chave];
      if (v && v.trim()) return v.trim();
    }
  } catch {
    // `process` inacessível (navegador) → usa o default baked.
  }
  return undefined;
}

/**
 * A janela vigente. Defaults baked, com override por env (ISO UTC):
 * `SUBMISSAO_BLOQUEIO_INICIO` / `SUBMISSAO_BLOQUEIO_FIM`. Override inválido
 * (`NaN`) cai no default correspondente — nunca abre a janela por engano.
 */
export function janelaBloqueio(): JanelaBloqueio {
  const inicioRaw = Date.parse(lerEnvUtc("SUBMISSAO_BLOQUEIO_INICIO") ?? INICIO_PADRAO_UTC);
  const fimRaw = Date.parse(lerEnvUtc("SUBMISSAO_BLOQUEIO_FIM") ?? FIM_PADRAO_UTC);
  const inicio = Number.isNaN(inicioRaw) ? Date.parse(INICIO_PADRAO_UTC) : inicioRaw;
  const fim = Number.isNaN(fimRaw) ? Date.parse(FIM_PADRAO_UTC) : fimRaw;
  return { inicio, fim };
}

function paraMs(now: Date | number): number {
  return typeof now === "number" ? now : now.getTime();
}

/**
 * TRUE quando o instante cai DENTRO da janela de bloqueio (início inclusivo, fim
 * exclusivo = a submissão volta exatamente no instante de reabertura).
 */
export function estaBloqueado(
  now: Date | number = Date.now(),
  janela: JanelaBloqueio = janelaBloqueio(),
): boolean {
  const t = paraMs(now);
  return t >= janela.inicio && t < janela.fim;
}

/** Fase em relação à janela: antes do início · durante · livre (depois do fim). */
export function faseBloqueio(
  now: Date | number = Date.now(),
  janela: JanelaBloqueio = janelaBloqueio(),
): FaseBloqueio {
  const t = paraMs(now);
  if (t < janela.inicio) return "antes";
  if (t < janela.fim) return "durante";
  return "livre";
}

/**
 * Estado pronto para a TELA: a fase + a mensagem a exibir (ou `null` quando não há
 * nada a dizer, depois da reabertura). `bloqueado` é o que desabilita o botão.
 */
export function estadoBloqueio(
  now: Date | number = Date.now(),
  janela: JanelaBloqueio = janelaBloqueio(),
): { fase: FaseBloqueio; bloqueado: boolean; mensagem: string | null } {
  const fase = faseBloqueio(now, janela);
  if (fase === "antes") return { fase, bloqueado: false, mensagem: COPY_BLOQUEIO.avisoPrevio };
  if (fase === "durante") return { fase, bloqueado: true, mensagem: COPY_BLOQUEIO.durante };
  return { fase, bloqueado: false, mensagem: null };
}

/**
 * Decisão do SERVIDOR: recusar este envio? Dentro da janela, recusa TODA submissão
 * do usuário — submissão NOVA *e* reenvio/edição de projeto já submetido (reenvio é
 * uma submissão). Fora da janela nunca recusa. O que NÃO para nessa janela é a
 * triagem/aprovação do admin, que não passa por aqui.
 *
 * A decisão depende só do relógio: `estaBloqueado(now, janela)`. Não recebe mais o
 * antigo `ehReenvio` — a distinção nova × reenvio deixou de existir para o gate.
 */
export function deveRecusarSubmissao(
  now: Date | number = Date.now(),
  janela: JanelaBloqueio = janelaBloqueio(),
): boolean {
  return estaBloqueado(now, janela);
}
