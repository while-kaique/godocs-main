// CONGELAMENTO da pré-aprovação de líder — kill-switch MANUAL por env (opt-in).
//
// Objetivo: pausar TOTALMENTE o registro de parecer do líder (o único caminho de
// escrita humana que ainda muda o estado de um projeto já submetido), para que a
// base fique CONGELADA enquanto o time de agentes de avaliação roda em sombra. A
// submissão e a edição/reenvio já são pausadas pela janela determinística
// (`bloqueio-submissao.ts`); este switch fecha a pré-aprovação, que não passa por
// aquela janela.
//
// Por que env e não janela de tempo: diferente do bloqueio de submissão (uma
// semana fixa), o congelamento da base para o experimento do agente não tem data
// de fim conhecida. Um secret liga/desliga sem redeploy — `PRE_APROVACAO_CONGELADA`
// truthy (1/true/sim/on) congela; ausente → NADA muda (default OFF, byte-idêntico
// ao de antes). É a mesma disciplina "opt-in, env lida em runtime" do resto do app.
//
// ⚠️ Módulo PURO, importável pelo CLIENTE e pelo SERVIDOR. Por isso:
//   - NUNCA ler `process.env` em escopo de módulo (derruba o worker no bootstrap do
//     Godeploy, onde `process` não existe na avaliação do módulo). Leitura LAZY,
//     dentro da função, guardada por `typeof process`.
//   - O CLIENTE não enxerga o secret (env é do servidor) → no navegador `process`
//     não existe e a função devolve `false`; a tela recebe o estado real pelo campo
//     `congelada` da resposta de `/api/aprovacoes/pendentes`. O gate DURO é sempre o
//     servidor, em `decidirAprovacao`.

/** Copy — FONTE ÚNICA (banner da tela + recusa do servidor). */
export const COPY_CONGELAMENTO_PREAPROVACAO =
  "As pré-aprovações estão pausadas no momento. Nenhum parecer de líder é registrado enquanto a base fica congelada para a avaliação automática. Você será avisado quando a fila reabrir.";

/** Lê uma env booleana de forma LAZY e segura no cliente (sem `process`). */
function lerEnvBool(chave: string): boolean {
  try {
    if (typeof process !== "undefined" && process.env) {
      const v = (process.env[chave] ?? "").trim().toLowerCase();
      return v === "1" || v === "true" || v === "sim" || v === "on";
    }
  } catch {
    // `process` inacessível (navegador) → não congela pelo lado do cliente.
  }
  return false;
}

/**
 * TRUE quando o congelamento da pré-aprovação está ativo. Ausente/desconhecido →
 * FALSE (nada muda). Só o SERVIDOR enxerga o secret; no cliente devolve FALSE.
 */
export function preAprovacaoCongelada(): boolean {
  return lerEnvBool("PRE_APROVACAO_CONGELADA");
}
