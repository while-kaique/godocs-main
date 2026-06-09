import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { iniciarSubmissaoFn, enviarMensagemFn, submeterParaValidacaoFn, iniciarSavingFn } from "@/lib/chat.functions";

import {
  EMAIL_RE, ALLOWED_DOMAINS_RE, readFileAsBase64, TOKEN_BLOCK_CHARS,
} from "@/lib/submeter/constants";
import type { FormData, FieldErrors, ChatFase, ChatMessage, SavingFormData } from "@/lib/submeter/constants";
import { PageFrame, PageHeader, PageFooter, BrowserDots, WizardProgress, StepAnimation } from "@/lib/submeter/layout";
import { SummaryRow } from "@/lib/submeter/form-components";
import { Step1 } from "@/lib/submeter/step1";
import { Step2 } from "@/lib/submeter/step2";
import { Step3Chat } from "@/lib/submeter/step3-chat";

/* ──────────────────────────────────────────────
   Route
   ────────────────────────────────────────────── */

export const Route = createFileRoute("/submeter")({
  head: () => ({
    meta: [
      { title: "Triagem de Fluxos | RPA & IA" },
      { name: "description", content: "Formulário interno para submissão de projetos de RPA e IA." },
    ],
  }),
  component: SubmeterPage,
});

/* ──────────────────────────────────────────────
   Page Component
   ────────────────────────────────────────────── */

function SubmeterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [submitted, setSubmitted] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [shaking, setShaking] = useState(false);
  const formCardRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatComplete, setChatComplete] = useState(false);
  const [chatFase, setChatFase] = useState<ChatFase>("doc");
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [iniciandoChat, setIniciandoChat] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [approvedDocPreview, setApprovedDocPreview] = useState<string | null>(null);
  const [approvedSavingPreview, setApprovedSavingPreview] = useState<string | null>(null);
  const [submittingProject, setSubmittingProject] = useState(false);
  const [showSavingForm, setShowSavingForm] = useState(false);
  const [savingFormLoading, setSavingFormLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  }, []);

  const [form, setForm] = useState<FormData>({
    prodStatus: "",
    nome: "",
    email: "",
    area: "",
    ferramenta: "",
    ferramentaOutra: "",
    emEquipe: "",
    participantes: [],
    nomeProjeto: "",
    dataCriacao: today,
    tipoProjeto: "",
    descricaoBreve: "",
  });

  const updateField = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  const setError = useCallback((key: string, msg: string) => {
    setErrors((prev) => ({ ...prev, [key]: msg }));
  }, []);

  const clearError = useCallback((key: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const prodBlocked = form.prodStatus === "dev" || form.prodStatus === "idle";

  /* ── Validation ── */
  function validateStep(n: number): boolean {
    const errs: FieldErrors = {};

    if (n === 1) {
      if (!form.prodStatus)
        errs.prodStatus = "Selecione o status do projeto";
      else if (form.prodStatus !== "sim")
        errs.prodStatus = "Apenas projetos em produção podem ser submetidos";
      if (!form.nome.trim() || form.nome.trim().length < 2)
        errs.nome = "Este campo é obrigatório";
      else if (/[0-9]/.test(form.nome))
        errs.nome = "O nome não pode conter números";
      if (!EMAIL_RE.test(form.email.trim()))
        errs.email = "Informe um e-mail válido";
      else if (!ALLOWED_DOMAINS_RE.test(form.email.trim()))
        errs.email = "Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos";
      if (!form.area) errs.area = "Selecione sua área";
      if (!form.ferramenta) errs.ferramenta = "Selecione a ferramenta";
      if (form.ferramenta === "Outros" && !form.ferramentaOutra.trim())
        errs.ferramentaOutra = "Especifique a ferramenta utilizada";
      if (!form.emEquipe) errs.emEquipe = "Selecione uma opção";
      if (form.emEquipe === "sim" && form.participantes.length === 0)
        errs.participantes = "Informe ao menos um e-mail de participante";
      if (form.emEquipe === "sim" && form.participantes.length > 0) {
        const invalid = form.participantes.filter((p) => !ALLOWED_DOMAINS_RE.test(p));
        if (invalid.length > 0)
          errs.participantes = "Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos";
      }
    }

    if (n === 2) {
      if (!form.tipoProjeto)
        errs.tipoProjeto = "Selecione o tipo do projeto";
      if (!form.nomeProjeto.trim() || form.nomeProjeto.trim().length < 3)
        errs.nomeProjeto = "Informe o nome do projeto (mínimo 3 caracteres)";
      if (!form.dataCriacao) {
        errs.dataCriacao = "Informe a data de criação";
      } else if (form.dataCriacao < "2024-01-01") {
        errs.dataCriacao = "A data mínima é 01/01/2024";
      } else if (form.dataCriacao > new Date().toISOString().split("T")[0]) {
        errs.dataCriacao = "A data não pode ser no futuro";
      }
      if (!form.descricaoBreve.trim() || form.descricaoBreve.trim().length < 20)
        errs.descricaoBreve = "Descreva o contexto em pelo menos 20 caracteres";
      if (arquivos.length === 0) errs.documentacao = "Selecione pelo menos um arquivo do projeto";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  /* ── Navigation ── */
  function goToStep(target: number, dir: "forward" | "back") {
    setDirection(dir);
    setStep(target);
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleBack() {
    if (step > 1) goToStep(step - 1, "back");
  }

  function handleStepClick(target: number) {
    if (completedSteps.has(target) && target !== step) {
      goToStep(target, target < step ? "back" : "forward");
    }
  }

  /* ── Step 1 → Step 2 ── */
  function handleNext() {
    if (validateStep(step)) {
      setCompletedSteps((prev) => new Set([...prev, step]));
      goToStep(step + 1, "forward");
    } else {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
    }
  }

  /* ── Step 2 → Step 3: inicia o agente ── */
  async function handleIniciarAgente() {
    if (!validateStep(2)) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    if (arquivos.length === 0) return;

    // Trava do orçamento de tokens: bloqueia se o conteúdo estimado estourar.
    // Proxy: soma dos tamanhos dos arquivos + descrição (1 byte ≈ 1 char).
    const charsEstimados =
      arquivos.reduce((acc, f) => acc + f.size, 0) + form.descricaoBreve.length;
    if (charsEstimados > TOKEN_BLOCK_CHARS) {
      const tokens = Math.round(charsEstimados / 4);
      toast.error(
        `Conteúdo muito grande (~${Math.round(tokens / 1000)}k tokens, limite ~200k). ` +
        `Remova arquivos ou use o prompt de pré-documentação no Claude.ai (painel acima).`
      );
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    setIniciandoChat(true);

    try {
      const docs = await Promise.all(
        arquivos.map(async (f) => ({
          base64: await readFileAsBase64(f),
          filename: f.name,
        }))
      );

      const result = await iniciarSubmissaoFn({
        data: {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          area: form.area,
          ferramenta:
            form.ferramenta === "Outros" && form.ferramentaOutra.trim()
              ? `Outros: ${form.ferramentaOutra.trim()}`
              : form.ferramenta,
          membros: form.participantes,
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          tipo_projeto: form.tipoProjeto || undefined,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          docs,
        },
      });

      setProjetoId(result.projeto_id);

      const firstMsg: ChatMessage = {
        role: "assistant",
        content: result.response.content,
        options: result.response.options ?? undefined,
        isComplete: result.response.isComplete,
        isPreview: result.response.isPreview,
        fase: result.response.fase,
      };
      setChatMessages([firstMsg]);
      setChatFase(result.response.fase ?? "doc");

      if (result.response.isComplete) {
        setChatComplete(true);
      }

      setCompletedSteps((prev) => new Set([...prev, 2]));
      goToStep(3, "forward");
    } catch (err) {
      console.error('[submeter] iniciarAgente falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao iniciar análise: ${msg}`);
    } finally {
      setIniciandoChat(false);
    }
  }

  /* ── Chat: enviar mensagem ── */
  async function handleSendMessage(content: string, selectedOption?: number) {
    if (!projetoId || chatLoading || chatComplete) return;

    const userMsg: ChatMessage = { role: "user", content };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    try {
      const result = await enviarMensagemFn({
        data: {
          projeto_id: projetoId,
          content,
          selected_option: selectedOption,
        },
      });

      const newFase: ChatFase = result.fase ?? chatFase;
      const transitionToSaving = chatFase !== "saving" && (newFase === "saving");

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.content,
        options: result.options ?? undefined,
        isComplete: result.isComplete,
        isPreview: result.isPreview,
        fase: newFase,
      };

      if (transitionToSaving) {
        const lastPreviewMsg = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        if (lastPreviewMsg) setApprovedDocPreview(lastPreviewMsg.content);

        setShowTransition(true);
        setChatFase(newFase);
        setTimeout(() => {
          setShowTransition(false);
          setChatMessages([]);
          setShowSavingForm(true);
        }, 3000);
      } else {
        setChatMessages((prev) => [...prev, assistantMsg]);
        setChatFase(newFase);
      }

      if (result.isComplete) {
        const lastSavingPreview = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        if (lastSavingPreview) setApprovedSavingPreview(lastSavingPreview.content);
        setChatComplete(true);
      }
    } catch (err) {
      console.error('[submeter] enviarMensagem falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao enviar mensagem: ${msg}`);
      setChatMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }

  /* ── Saving form: envia dados determinísticos e inicia chat ── */
  async function handleSavingFormSubmit(formData: SavingFormData) {
    if (!projetoId) return;
    setSavingFormLoading(true);
    try {
      const result = await iniciarSavingFn({
        data: {
          projeto_id: projetoId,
          tipo_saving: formData.tipoSaving as "mensal" | "pontual",
          cargo: formData.cargo || undefined,
          horas_antes: formData.horasAntes ? parseFloat(formData.horasAntes) : undefined,
          horas_depois: formData.horasDepois ? parseFloat(formData.horasDepois) : undefined,
        },
      });
      setShowSavingForm(false);
      const savingMsg: ChatMessage = {
        role: "assistant",
        content: result.content,
        options: result.options ?? undefined,
        isComplete: result.isComplete,
        isPreview: result.isPreview,
        fase: result.fase ?? "saving",
      };
      setChatMessages([savingMsg]);
      if (result.fase) setChatFase(result.fase);
    } catch (e) {
      console.error("[submeter] falha ao iniciar saving:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao iniciar análise de impacto: ${msg}`);
    } finally {
      setSavingFormLoading(false);
    }
  }

  /* ── Enviar projeto ── */
  async function handleSubmitProject() {
    if (!projetoId) return;
    setSubmittingProject(true);
    try {
      await submeterParaValidacaoFn({ data: { projeto_id: projetoId } });
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao enviar projeto. Tente novamente.");
    } finally {
      setSubmittingProject(false);
    }
  }

  /* ── Success Screen ── */
  if (submitted) {
    return (
      <PageFrame>
        <div className="relative z-[1] mx-auto w-full max-w-[540px]">
          <PageHeader />
          <div
            className="relative overflow-hidden bg-[var(--go-white)] shadow-[var(--go-shadow-lg)] text-center"
            style={{
              borderRadius: "var(--go-radius-xl)",
              border: "1px solid rgba(0,89,169,0.08)",
              padding: "40px 32px 32px",
            }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{
                background:
                  "linear-gradient(90deg, #16a34a 0%, #4ade80 50%, var(--go-lime) 100%)",
              }}
            />
            <BrowserDots centered />
            <div
              className="mx-auto mb-6 flex items-center justify-center"
              style={{
                width: 72,
                height: 72,
                background: "rgba(22,163,74,0.06)",
                border: "2px solid rgba(22,163,74,0.15)",
                borderRadius: "50%",
              }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 48,
                  height: 48,
                  background: "rgba(22,163,74,0.1)",
                  borderRadius: "50%",
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
            <h2
              className="mb-2.5 text-[22px] font-extrabold tracking-tight"
              style={{ color: "var(--go-text-heading)" }}
            >
              Projeto Enviado!
            </h2>
            <p
              className="mb-7 text-sm leading-relaxed"
              style={{ color: "var(--go-text-primary)" }}
            >
              Sua documentação foi recebida e está em análise pela equipe de RPA & IA.
              <br />
              Você receberá um retorno em breve por e-mail.
            </p>
            <div
              className="mb-7 text-left"
              style={{
                background: "var(--go-light-blue)",
                border: "1px solid rgba(0,89,169,0.08)",
                borderRadius: "var(--go-radius-md)",
                padding: 18,
              }}
            >
              <SummaryRow label="Projeto" value={form.nomeProjeto} />
              <SummaryRow label="Área" value={form.area} />
              <SummaryRow label="Ferramenta" value={form.ferramenta} />
              <SummaryRow label="Status" value="Aguardando análise" badge last />
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="go-btn-primary"
              >
                Submeter outro projeto
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                className="text-xs"
                style={{ color: "#8b8b9a" }}
              >
                Voltar à Home
              </button>
            </div>
          </div>
          <PageFooter />
        </div>
      </PageFrame>
    );
  }

  /* ── Main Form ── */
  return (
    <PageFrame>
      <div className="relative z-[1] mx-auto w-full max-w-[680px] px-[var(--space-5,24px)] py-[var(--space-7,48px)] pb-[var(--space-6,32px)]">
        <PageHeader subtitle="Submeta projetos e automações que já estão em produção para avaliação da equipe de RPA & IA" />

        <div
          ref={formCardRef}
          className="relative overflow-hidden bg-[var(--go-white)]"
          style={{
            border: "1px solid rgba(0,89,169,0.08)",
            borderRadius: "var(--go-radius-xl)",
            padding: step === 3 ? "32px 0 0" : "32px 32px 24px",
            boxShadow: "var(--go-shadow-lg)",
          }}
        >
          {/* Gradient bar */}
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background:
                "linear-gradient(90deg, var(--go-blue) 0%, var(--go-blue) 60%, var(--go-lime) 100%)",
            }}
          />

          <div style={{ padding: step === 3 ? "0 32px" : undefined }}>
            <BrowserDots />
            <WizardProgress
              current={step}
              completed={completedSteps}
              onStepClick={handleStepClick}
            />
          </div>

          {/* Steps */}
          <div className={cn("relative", step !== 3 && "min-h-[200px]")}>
            {step === 1 && (
              <StepAnimation direction={direction}>
                <div style={{ padding: "0 0" }}>
                  <Step1
                    form={form}
                    errors={errors}
                    updateField={updateField}
                    setError={setError}
                    clearError={clearError}
                  />
                </div>
              </StepAnimation>
            )}
            {step === 2 && (
              <StepAnimation direction={direction}>
                <Step2
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  clearError={clearError}
                  arquivos={arquivos}
                  setArquivos={setArquivos}
                />
              </StepAnimation>
            )}
            {step === 3 && (
              <StepAnimation direction={direction}>
                <Step3Chat
                  messages={chatMessages}
                  input={chatInput}
                  setInput={setChatInput}
                  onSend={handleSendMessage}
                  loading={chatLoading}
                  isComplete={chatComplete}
                  onSubmitProject={handleSubmitProject}
                  submitting={submittingProject}
                  chatBottomRef={chatBottomRef}
                  fase={chatFase}
                  showTransition={showTransition}
                  approvedDocPreview={approvedDocPreview}
                  approvedSavingPreview={approvedSavingPreview}
                  tipoProjeto={form.tipoProjeto}
                  showSavingForm={showSavingForm}
                  onSavingFormSubmit={handleSavingFormSubmit}
                  savingFormLoading={savingFormLoading}
                />
              </StepAnimation>
            )}
          </div>

          {/* Navigation */}
          {step !== 3 && (
            <div style={{ padding: "0 32px 24px" }} className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="go-btn-back"
                style={{ visibility: step === 1 ? "hidden" : "visible" }}
              >
                &larr; Voltar
              </button>

              {step === 1 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className={cn("go-btn-next", shaking && "go-shake")}
                  disabled={prodBlocked}
                >
                  Próximo &rarr;
                </button>
              )}

              {step === 2 && (
                <button
                  type="button"
                  onClick={handleIniciarAgente}
                  disabled={iniciandoChat}
                  className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                >
                  {iniciandoChat ? (
                    <>
                      <span>Analisando...</span>
                      <div className="go-spinner" />
                    </>
                  ) : (
                    <span>Analisar com Agente &rarr;</span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        <PageFooter />
      </div>
    </PageFrame>
  );
}
