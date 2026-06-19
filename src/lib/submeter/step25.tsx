import { useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import type { FormData, FieldErrors } from "./constants";
import {
  SectionTitle,
  FormGroup,
  FormLabel,
  FieldError,
  CheckboxGroup,
  InfoTooltip,
} from "./form-components";

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
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  // Resposta da pergunta sim/não. "" = ainda não respondida.
  resp: "sim" | "nao" | "";
  onResp: (r: "sim" | "nao") => void;
}) {
  const contextoChars = form.contextoEspecial.length;

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

      {/* SIM → projeto especial: contexto breve */}
      {resp === "sim" && (
        <div style={{ animation: "go-step-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both" }}>
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
            <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
              Este projeto gera saving operacional, receita incremental ou ambos?
              <InfoTooltip>
                <strong className="mb-1 block text-white">Saving Operacional vs. Receita Incremental</strong>
                <span className="block mb-2" style={{ color: "rgba(255,255,255,0.85)" }}>
                  <strong style={{ color: "var(--go-lime)" }}>Saving Operacional</strong> — economia gerada pela automação.
                  Ex: processo manual que levava 20h/mês agora é automático (economia de horas e custo operacional).
                </span>
                <span className="block mb-2" style={{ color: "rgba(255,255,255,0.85)" }}>
                  <strong style={{ color: "var(--go-lime)" }}>Receita Incremental</strong> — aumento de receita gerado pela automação.
                  Ex: automação que dispara ofertas personalizadas e aumenta conversão de vendas.
                </span>
                <span className="block text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>
                  Pode selecionar os dois se o projeto gerar ambos os benefícios.
                </span>
              </InfoTooltip>
            </div>
            <CheckboxGroup
              value={form.tipoProjeto}
              onChange={(v) => {
                updateField("tipoProjeto", v as FormData["tipoProjeto"]);
                clearError("tipoProjeto");
              }}
              error={errors.tipoProjeto}
              options={[
                { value: "saving",              label: "💰 Saving Operacional" },
                { value: "receita_incremental", label: "📈 Receita Incremental" },
              ]}
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
