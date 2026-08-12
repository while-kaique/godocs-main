import { useState } from "react";
import { createPortal } from "react-dom";
import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormData, FieldErrors } from "./constants";
import { motivoBloqueioEspecial } from "./constants";
import {
  PERGUNTAS_ESPECIAL,
  mensagemEspecialInvalido,
} from "@/lib/mensagens-submissao";
import {
  SectionTitle,
  FormGroup,
  FormLabel,
  FieldError,
  CardCheckboxGroup,
} from "./form-components";

/* Opções de tipo de projeto padrão (saving / receita) — cards selecionáveis. */
const TIPOS_PROJETO = [
  {
    value: "saving",
    icon: "💰",
    title: "Saving Operacional",
    desc: "Economia gerada pela automação (horas e custos). Nas próximas etapas, o agente vai coletar as rotinas, a frequência e os cargos envolvidos para montar o memorial de economia.",
  },
  {
    value: "receita_incremental",
    icon: "📈",
    title: "Receita Incremental",
    desc: "Aumento de receita gerado pela automação. Nas próximas etapas, o agente vai coletar como o projeto gera receita e a base de cálculo do ganho.",
  },
] as const;

/* ──────────────────────────────────────────────
   Etapa 2.5 — Tipo de Projeto
   Sub-tela entre as etapas 2 e 3. Pergunta se o projeto é "especial"
   (altíssimo impacto que NÃO se encaixa em saving/receita → validação humana)
   ou um projeto padrão (segue para saving/receita incremental).
   ────────────────────────────────────────────── */

export function Etapa25({
  form,
  errors,
  updateField,
  clearError,
  resp,
  onResp,
  onRespTriagem,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  // Resposta da pergunta sim/não. "" = ainda não respondida.
  resp: "sim" | "nao" | "";
  onResp: (r: "sim" | "nao") => void;
  // Resposta de uma das 2 perguntas de triagem do especial (ver PERGUNTAS_ESPECIAL).
  onRespTriagem: (
    campo: "especialDashboard" | "especialGanhoOrganizacional",
    valor: "sim" | "nao",
  ) => void;
}) {
  const contextoChars = form.contextoEspecial.length;

  // Triagem do especial: a régua é a MESMA função pura que a validação do envio usa
  // (`motivoBloqueioEspecial`) — a tela não redige critério próprio. `especial` sai de
  // `resp`, que é a verdade desta tela (o form é atualizado no mesmo clique).
  const motivoBloqueio = motivoBloqueioEspecial({
    especial: resp === "sim",
    especialDashboard: form.especialDashboard,
    especialGanhoOrganizacional: form.especialGanhoOrganizacional,
  });
  // Contexto do especial só depois das 2 respostas e sem bloqueio: escrever 20+
  // caracteres para uma submissão que não vai sair é trabalho jogado fora.
  const triagemLiberada =
    !motivoBloqueio &&
    form.especialDashboard === "nao" &&
    form.especialGanhoOrganizacional === "nao";

  // Modal de confirmação ao marcar "Sim": avisa que o projeto pulará a
  // verificação de saving/receita e irá para avaliação humana rigorosa.
  const [confirmarEspecial, setConfirmarEspecial] = useState(false);

  // Clicar "Sim" não marca direto: abre o alerta de confirmação.
  // Se já estava em "sim", reabre o alerta para reconfirmar/voltar atrás.
  function handleClickSim() {
    setConfirmarEspecial(true);
  }

  return (
    <div>
      <SectionTitle icon="🎯">Tipo de Projeto</SectionTitle>

      {/* Pergunta principal — projeto especial? */}
      <FormGroup>
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(0,89,169,0.03)",
            border: "1.5px solid rgba(0,89,169,0.12)",
          }}
        >
          <p
            className="mb-4 text-[13.5px] font-bold leading-relaxed"
            style={{ color: "var(--go-text-heading)" }}
          >
            Seu projeto tem altíssimo impacto para a empresa, mas{" "}
            <span style={{ color: "var(--go-blue)" }}>
              não está diretamente ligado a um ganho de receita ou redução de custos
              objetivamente mensuráveis
            </span>
            , destoando assim de um projeto padrão?
          </p>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleClickSim}
              className={cn("go-radio-label flex-1 cursor-pointer select-none", resp === "sim" && "go-radio-checked")}
            >
              ⭐ Sim. É um projeto de alto impacto, com difícil mensuração objetiva
            </button>
            <button
              type="button"
              onClick={() => onResp("nao")}
              className={cn("go-radio-label flex-1 cursor-pointer select-none", resp === "nao" && "go-radio-checked")}
            >
              📊 Não. É um projeto padrão, com mensuração objetiva de receita incremental ou de redução de custos
            </button>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--go-text-muted, #6b6b7a)" }}>
            <strong>Exemplos de Projetos Especiais:</strong> projetos que geram muito
            engajamento nas redes, que aumentam vendas sem atribuições claras, que atuam
            diretamente na qualidade do produto ou da entrega etc. P.ex. Piapp, Agente
            Autônomo de Comentários.
          </p>
          <FieldError message={errors.especial} />
        </div>
      </FormGroup>

      {/* SIM → projeto especial: TRIAGEM (2 perguntas em sequência) antes do contexto */}
      {resp === "sim" && (
        <div style={{ animation: "go-step-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both" }}>
          <FormGroup>
            <div
              className="rounded-xl p-4"
              style={{ background: "var(--go-white)", border: "1.5px solid rgba(0,89,169,0.15)" }}
            >
              <div className="mb-3.5 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  style={{
                    display: "block",
                    width: 3,
                    height: 14,
                    borderRadius: 2,
                    background: "var(--go-lime)",
                  }}
                />
                <span
                  className="text-[10.5px] font-extrabold uppercase"
                  style={{ color: "var(--go-blue)", letterSpacing: "0.08em" }}
                >
                  Duas checagens antes de seguir
                </span>
              </div>

              {/* A 1ª pergunta é o critério OBJETIVO; a 2ª só aparece depois dela. A
                  numeração existe porque a ordem é real (uma destrava a outra). */}
              <PerguntaSimNao
                numero={1}
                indice={0}
                valor={form.especialDashboard}
                onResp={(v) => onRespTriagem("especialDashboard", v)}
                erro={errors.especialDashboard}
              />

              {form.especialDashboard === "nao" && (
                <div
                  className="mt-4"
                  style={{ animation: "go-field-up 0.25s ease both" }}
                >
                  <PerguntaSimNao
                    numero={2}
                    indice={1}
                    valor={form.especialGanhoOrganizacional}
                    onResp={(v) => onRespTriagem("especialGanhoOrganizacional", v)}
                    erro={errors.especialGanhoOrganizacional}
                  />
                </div>
              )}
            </div>
          </FormGroup>

          {/* Bloqueio — aparece no instante do "sim", sem esperar o clique em enviar */}
          {motivoBloqueio && <BloqueioEspecial mensagem={mensagemEspecialInvalido(motivoBloqueio)} />}
        </div>
      )}

      {/* SIM + triagem aprovada → contexto breve do especial */}
      {resp === "sim" && triagemLiberada && (
        <div style={{ animation: "go-field-up 0.25s ease both" }}>
          <FormGroup>
            <FormLabel
              required
              hint="Por que é um projeto de altíssimo impacto e por que não se encaixa em saving ou receita incremental"
            >
              Contexto do Projeto Especial
            </FormLabel>
            <textarea
              className={cn(
                "go-input w-full resize-none rounded-lg p-3 text-sm leading-relaxed",
                errors.contextoEspecial && "!border-[#dc2626]"
              )}
              style={{
                minHeight: 110,
                border: "1.5px solid rgba(0,89,169,0.18)",
                background: "var(--go-white)",
                color: "var(--go-text-heading)",
                outline: "none",
                transition: "border-color 0.15s",
              }}
              placeholder="Ex: Este projeto reestrutura toda a base de conhecimento da empresa para uso por agentes de IA. Não gera receita ou saving direto, mas é a fundação que viabiliza dezenas de automações futuras e destrava a estratégia de IA do grupo."
              value={form.contextoEspecial}
              onChange={(e) => {
                updateField("contextoEspecial", e.currentTarget.value);
                clearError("contextoEspecial");
              }}
              maxLength={2000}
            />
            <div className="mt-1 flex justify-between">
              <FieldError message={errors.contextoEspecial} />
              <span className="text-[10px]" style={{ color: contextoChars > 1900 ? "#dc2626" : "#8b8b9a" }}>
                {contextoChars}/2000
              </span>
            </div>
          </FormGroup>
        </div>
      )}

      {/* NÃO → projeto padrão: saving / receita incremental */}
      {resp === "nao" && (
        <div style={{ animation: "go-step-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both" }}>
          <FormGroup>
            <div className="mb-3 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
              Este projeto gera saving operacional, receita incremental ou ambos?
            </div>

            <CardCheckboxGroup
              options={TIPOS_PROJETO.map((o) => ({
                value: o.value,
                title: o.title,
                desc: o.desc,
                icon: o.icon,
              }))}
              value={form.tipoProjeto}
              onChange={(next) => {
                updateField("tipoProjeto", next as FormData["tipoProjeto"]);
                clearError("tipoProjeto");
              }}
              error={errors.tipoProjeto}
            />
          </FormGroup>
        </div>
      )}

      {/* Modal de confirmação — projeto especial → avaliação humana rigorosa */}
      {confirmarEspecial && (
        <ConfirmEspecialModal
          onConfirmar={() => {
            setConfirmarEspecial(false);
            onResp("sim");
          }}
          onRecusar={() => {
            setConfirmarEspecial(false);
            onResp("nao");
          }}
          onFechar={() => setConfirmarEspecial(false)}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Pergunta sim/não da TRIAGEM do especial
   Uma pergunta + 2 opções. O texto vem de `PERGUNTAS_ESPECIAL`
   (`mensagens-submissao.ts`) — fonte única com as mensagens de bloqueio.
   A11y: `<fieldset>/<legend>` amarram as opções à pergunta; o input é
   `peer sr-only` com indicador redondo (o estado NÃO é só cor: o disco interno
   aparece/desaparece e o rótulo fica em negrito) e o anel de foco de teclado
   acende no indicador via `peer-focus-visible`.
   ────────────────────────────────────────────── */
function PerguntaSimNao({
  numero,
  indice,
  valor,
  onResp,
  erro,
}: {
  numero: number;
  indice: 0 | 1;
  valor: "sim" | "nao" | "";
  onResp: (v: "sim" | "nao") => void;
  erro?: string;
}) {
  const item = PERGUNTAS_ESPECIAL[indice];
  const opcoes: { value: "sim" | "nao"; label: string }[] = [
    { value: "sim", label: item.sim },
    { value: "nao", label: item.nao },
  ];

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="mb-2.5 flex gap-2.5 p-0">
        <span
          aria-hidden="true"
          className="flex flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-extrabold"
          style={{
            width: 19,
            height: 19,
            marginTop: 1,
            color: "var(--go-blue)",
            border: "1.5px solid rgba(0,89,169,0.3)",
          }}
        >
          {numero}
        </span>
        <span
          className="text-[13.5px] font-bold leading-relaxed"
          style={{ color: "var(--go-text-heading)" }}
        >
          {item.pergunta}
        </span>
      </legend>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5">
        {opcoes.map((opt) => {
          const marcado = valor === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                "go-radio-label flex-1 cursor-pointer select-none",
                marcado && "go-radio-checked",
              )}
              // `.go-radio-label` centraliza o conteúdo; aqui o indicador fica à esquerda e o
              // rótulo alinhado com ele. Vai em `style` porque a classe do design system é CSS
              // não-camadado e venceria a utilitária do Tailwind (v4).
              style={{ justifyContent: "flex-start", textAlign: "left", gap: 10 }}
            >
              <input
                type="radio"
                name={`especial-${item.id}`}
                value={opt.value}
                checked={marcado}
                onChange={() => onResp(opt.value)}
                className="peer sr-only"
              />
              {/* Indicador redondo — muda de FORMA, não só de cor */}
              <span
                aria-hidden="true"
                className="flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full transition-all duration-150 peer-focus-visible:[box-shadow:0_0_0_3px_rgba(0,89,169,0.3)]"
                style={{
                  border: marcado
                    ? "1.5px solid var(--go-blue)"
                    : "1.5px solid rgba(0,89,169,0.3)",
                  background: "var(--go-white)",
                }}
              >
                {marcado && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--go-blue)",
                      animation: "go-chip-in 0.15s ease",
                    }}
                  />
                )}
              </span>
              <span className={marcado ? "font-extrabold" : undefined}>{opt.label}</span>
            </label>
          );
        })}
      </div>
      <FieldError message={erro} />
    </fieldset>
  );
}

/* ──────────────────────────────────────────────
   Bloqueio da triagem do especial
   Veredito + o que fazer. O texto INTEIRO vem de `mensagens-submissao.ts`
   (fonte única: o mesmo que o toast do envio mostra). Ícone + veredito em
   negrito: o estado não é comunicado só pela cor.
   ────────────────────────────────────────────── */
function BloqueioEspecial({ mensagem }: { mensagem: string }) {
  return (
    <div
      role="alert"
      className="mb-5 rounded-xl p-4"
      style={{
        background: "rgba(220,38,38,0.05)",
        border: "1.5px solid rgba(220,38,38,0.22)",
        animation: "go-slide-down 0.25s ease both",
      }}
    >
      <div className="flex items-center gap-2">
        <Ban size={16} strokeWidth={2.5} color="#b91c1c" aria-hidden="true" />
        <span className="text-[13px] font-extrabold" style={{ color: "#b91c1c" }}>
          Este projeto não segue como especial
        </span>
      </div>
      <p
        className="mt-2 text-[12.5px]"
        style={{ color: "var(--go-text-heading)", lineHeight: 1.6, maxWidth: "72ch" }}
      >
        {mensagem}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Modal de confirmação de Projeto Especial
   Alerta o usuário que, ao prosseguir como projeto especial, ele PULA a
   verificação automática de saving/receita e vai para avaliação humana
   rigorosa (alguém entra em contato para validar o alto impacto).
   ────────────────────────────────────────────── */
function ConfirmEspecialModal({
  onConfirmar,
  onRecusar,
  onFechar,
}: {
  onConfirmar: () => void;
  onRecusar: () => void;
  onFechar: () => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onFechar}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        animation: "go-fade-in-up 0.25s ease both",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="especial-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--go-white)",
          borderRadius: "var(--go-radius, 16px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
          animation: "go-step-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both",
        }}
      >
        {/* Faixa de alerta */}
        <div
          className="flex items-center gap-2.5 px-5 py-3.5"
          style={{ background: "rgba(245,158,11,0.12)", borderBottom: "1.5px solid rgba(245,158,11,0.25)" }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
          <span
            id="especial-modal-title"
            className="text-[14px] font-extrabold"
            style={{ color: "#92600a", letterSpacing: "-0.01em" }}
          >
            Atenção: avaliação humana rigorosa
          </span>
        </div>

        {/* Corpo */}
        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--go-text-heading)" }}>
            Ao prosseguir como <strong>projeto especial</strong>, você{" "}
            <strong style={{ color: "#b45309" }}>pula as etapas de verificação de saving e/ou receita</strong>{" "}
            e segue direto para uma <strong>avaliação humana rigorosa</strong>.
          </p>
          <p className="mt-2.5 text-[13px] leading-relaxed" style={{ color: "var(--go-text-muted, #6b6b7a)" }}>
            Uma pessoa entrará em contato com você para entender e validar este projeto de
            altíssimo impacto. Confirme apenas se o projeto realmente não se encaixa em uma
            mensuração objetiva de receita ou redução de custos.
          </p>
        </div>

        {/* Ações */}
        <div className="flex flex-col-reverse gap-2.5 px-5 pb-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onRecusar}
            className="cursor-pointer rounded-lg px-4 py-2.5 text-[13px] font-bold transition-colors"
            style={{
              background: "transparent",
              color: "var(--go-text-muted, #6b6b7a)",
              border: "1.5px solid rgba(0,0,0,0.12)",
            }}
          >
            Não, seguir fluxo normal
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            className="cursor-pointer rounded-lg px-4 py-2.5 text-[13px] font-bold text-white transition-colors"
            style={{ background: "var(--go-blue)", border: "1.5px solid var(--go-blue)" }}
          >
            Sim, é um projeto especial
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
