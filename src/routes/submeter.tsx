import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { iniciarSubmissaoFn, enviarMensagemFn, submeterParaValidacaoFn } from "@/lib/chat.functions";

/* ──────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────── */

const AREAS = [
  "AZ", "B2B Gobeauté", "B2B Gocase", "Contabilidade", "CSC", "CX",
  "CX - Agentes", "Dados", "Departamento Pessoal", "E-commerce", "Facilities",
  "Financeiro", "Fiscal", "FP&A", "Gente e Gestão", "Growth", "Ilustração",
  "Jurídico", "Logística", "M&A", "Marketing de Influência",
  "Offline - Administrativo", "Offline - Lojas", "Operações Gobeauté",
  "Operações Gocase - Administrativo", "Transportes", "Qualidade", "Manutenção",
  "Expedição", "Almoxarifado", "Produção", "Produto Gobeauté", "Produto Gocase",
  "Projetos e Integrações", "RPA", "Marketing - Branding",
  "Sourcing & Procurement Gobeauté", "Supply Gogroup", "Tecnologia",
] as const;

const FERRAMENTAS = [
  "n8n", "Python", "Google Apps Script", "Make", "Lovable",
  "Selenium", "Puppeteer", "Power BI", "Claude + Vercel", "Outros",
] as const;

const ACCEPTED_DOC_EXT = [".pdf", ".docx", ".doc", ".txt", ".md"];
const MAX_FILE_MB = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_DOMAINS_RE = /^[^\s@]+@(gocase|gobeaute|gogroup)\.(com|com\.br)$/i;

const STEPS = [
  { id: 1, label: "Envio" },
  { id: 2, label: "Projeto" },
  { id: 3, label: "Agente" },
];

/* ──────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */

interface FormData {
  prodStatus: "sim" | "dev" | "idle" | "";
  nome: string;
  email: string;
  area: string;
  ferramenta: string;
  ferramentaOutra: string;
  emEquipe: "sim" | "nao" | "";
  participantes: string[];
  nomeProjeto: string;
  dataCriacao: string;
}

interface FieldErrors {
  [key: string]: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  options?: [string, string, string];
  isComplete?: boolean;
}

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
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [shaking, setShaking] = useState(false);
  const formCardRef = useRef<HTMLDivElement>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatComplete, setChatComplete] = useState(false);
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [iniciandoChat, setIniciandoChat] = useState(false);
  const [submittingProject, setSubmittingProject] = useState(false);
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
      if (!form.nomeProjeto.trim() || form.nomeProjeto.trim().length < 3)
        errs.nomeProjeto = "Informe o nome do projeto (mínimo 3 caracteres)";
      if (!form.dataCriacao) errs.dataCriacao = "Informe a data de criação";
      if (!arquivo) errs.documentacao = "Envie a documentação do projeto";
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

    if (!arquivo) return;

    setIniciandoChat(true);

    try {
      // Lê o arquivo como base64
      const base64 = await readFileAsBase64(arquivo);

      const area_id = undefined; // TODO: mapear área para UUID se necessário

      const result = await iniciarSubmissaoFn({
        data: {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          area_id,
          ferramenta:
            form.ferramenta === "Outros" && form.ferramentaOutra.trim()
              ? `Outros: ${form.ferramentaOutra.trim()}`
              : form.ferramenta,
          membros: form.participantes,
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          doc_base64: base64,
          doc_filename: arquivo.name,
        },
      });

      setProjetoId(result.projeto_id);

      const firstMsg: ChatMessage = {
        role: "assistant",
        content: result.response.content,
        options: result.response.options ?? undefined,
        isComplete: result.response.isComplete,
      };
      setChatMessages([firstMsg]);

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

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: result.content,
        options: result.options ?? undefined,
        isComplete: result.isComplete,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);

      if (result.isComplete) {
        setChatComplete(true);
      }
    } catch (err) {
      console.error('[submeter] enviarMensagem falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao enviar mensagem: ${msg}`);
      // Remove a mensagem do usuário em caso de erro
      setChatMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }

  /* ── Enviar projeto (após agente completar) ── */
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
                  arquivo={arquivo}
                  setArquivo={setArquivo}
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
                />
              </StepAnimation>
            )}
          </div>

          {/* Navigation — esconde no Step 3 (chat tem seu próprio input) */}
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
                  className={cn("go-btn-next", shaking && "go-shake")}
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

/* ──────────────────────────────────────────────
   Step 3: Chat com o Agente
   ────────────────────────────────────────────── */

function Step3Chat({
  messages,
  input,
  setInput,
  onSend,
  loading,
  isComplete,
  onSubmitProject,
  submitting,
  chatBottomRef,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSend: (content: string, option?: number) => void;
  loading: boolean;
  isComplete: boolean;
  onSubmitProject: () => void;
  submitting: boolean;
  chatBottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading && !isComplete) {
        onSend(input.trim());
      }
    }
  }

  const lastMsg = messages[messages.length - 1];
  const hasOptions =
    lastMsg?.role === "assistant" && lastMsg.options && !isComplete;

  return (
    <div className="flex flex-col" style={{ minHeight: 420 }}>
      {/* Cabeçalho do chat */}
      <div
        className="flex items-center gap-2.5 px-8 pb-4"
        style={{ borderBottom: "1px solid rgba(0,89,169,0.08)" }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm"
          style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
        >
          🤖
        </div>
        <div>
          <div
            className="text-[13px] font-bold"
            style={{ color: "var(--go-text-heading)" }}
          >
            Agente de Documentação
          </div>
          <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
            {isComplete
              ? "✅ Documentação completa — pronto para envio"
              : "Analisando e coletando informações..."}
          </div>
        </div>
      </div>

      {/* Mensagens */}
      <div
        className="flex-1 overflow-y-auto px-8 py-5 space-y-4"
        style={{ maxHeight: 420 }}
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                msg.role === "user"
                  ? "rounded-tr-sm"
                  : "rounded-tl-sm"
              )}
              style={
                msg.role === "user"
                  ? {
                      background: "var(--go-blue)",
                      color: "#fff",
                    }
                  : {
                      background: "rgba(199,233,253,0.4)",
                      border: "1px solid rgba(0,89,169,0.1)",
                      color: "var(--go-text-heading)",
                    }
              }
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl rounded-tl-sm px-4 py-3"
              style={{
                background: "rgba(199,233,253,0.4)",
                border: "1px solid rgba(0,89,169,0.1)",
              }}
            >
              <div className="flex gap-1.5 items-center h-5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: "var(--go-blue)",
                    opacity: 0.5,
                    animation: "go-bounce 1.2s ease-in-out infinite",
                  }}
                />
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: "var(--go-blue)",
                    opacity: 0.5,
                    animation: "go-bounce 1.2s ease-in-out 0.2s infinite",
                  }}
                />
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: "var(--go-blue)",
                    opacity: 0.5,
                    animation: "go-bounce 1.2s ease-in-out 0.4s infinite",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Options (quando agente oferece opções) */}
      {hasOptions && lastMsg.options && (
        <div
          className="px-8 pb-3 flex flex-wrap gap-2"
          style={{ borderTop: "1px solid rgba(0,89,169,0.06)" }}
        >
          <div
            className="w-full pt-3 pb-1 text-[11px] font-semibold"
            style={{ color: "#8b8b9a" }}
          >
            Selecione uma opção ou escreva sua resposta:
          </div>
          {lastMsg.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSend(opt, i + 1)}
              disabled={loading}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                background: "rgba(0,89,169,0.06)",
                border: "1px solid rgba(0,89,169,0.18)",
                color: "var(--go-blue)",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Botão de envio final */}
      {isComplete && (
        <div
          className="px-8 py-5"
          style={{ borderTop: "1px solid rgba(0,89,169,0.08)" }}
        >
          <div
            className="mb-3 rounded-xl p-3.5 text-sm"
            style={{
              background: "rgba(22,163,74,0.04)",
              border: "1px solid rgba(22,163,74,0.15)",
              color: "#15803d",
            }}
          >
            ✅ A documentação está completa e pronta para avaliação da equipe de RPA & IA.
          </div>
          <button
            type="button"
            onClick={onSubmitProject}
            disabled={submitting}
            className="go-btn-submit w-full"
          >
            {submitting ? (
              <>
                <span>Enviando...</span>
                <div className="go-spinner" />
              </>
            ) : (
              <span>Enviar para Triagem</span>
            )}
          </button>
        </div>
      )}

      {/* Input de mensagem */}
      {!isComplete && (
        <div
          className="px-8 py-4"
          style={{ borderTop: "1px solid rgba(0,89,169,0.08)" }}
        >
          <div className="flex gap-2.5 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              className="go-textarea flex-1 resize-none"
              style={{ minHeight: 42, maxHeight: 120 }}
              placeholder="Digite sua resposta..."
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => {
                if (input.trim() && !loading) onSend(input.trim());
              }}
              disabled={!input.trim() || loading}
              className="shrink-0 flex items-center justify-center rounded-xl transition-colors"
              style={{
                width: 42,
                height: 42,
                background: input.trim() && !loading
                  ? "var(--go-blue)"
                  : "rgba(0,89,169,0.1)",
                border: "none",
                color: input.trim() && !loading ? "#fff" : "rgba(0,89,169,0.4)",
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="mt-1.5 text-center text-[10px]" style={{ color: "#8b8b9a" }}>
            Enter para enviar · Shift+Enter para nova linha
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Utility: lê arquivo como base64
   ────────────────────────────────────────────── */

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove o prefixo "data:...;base64,"
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ══════════════════════════════════════════════
   Shared Layout Components
   ══════════════════════════════════════════════ */

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen p-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "var(--go-radius-xl)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function PageHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="mb-8 text-center">
      <h1
        className="mb-2 font-extrabold leading-tight tracking-tight"
        style={{
          fontSize: "clamp(1.5rem, 3.5vw, 1.75rem)",
          color: "var(--go-text-heading)",
        }}
      >
        Triagem de Fluxos
      </h1>
      <div className="mb-4 inline-flex items-center justify-center">
        <span
          className="font-semibold uppercase"
          style={{
            fontSize: 11,
            letterSpacing: "0.15em",
            color: "var(--go-blue)",
            background: "var(--go-lime)",
            padding: "4px 14px",
            borderRadius: "var(--go-radius-pill)",
          }}
        >
          RPA & IA
        </span>
      </div>
      {subtitle && (
        <p
          className="mx-auto max-w-[440px] text-[length:var(--fs-body,1rem)] font-normal"
          style={{ color: "var(--go-text-primary)" }}
        >
          Submeta projetos e automações que{" "}
          <strong style={{ color: "var(--go-blue)", fontWeight: 600 }}>
            já estão em produção
          </strong>{" "}
          para avaliação da equipe de RPA & IA
        </p>
      )}
    </header>
  );
}

function PageFooter() {
  return (
    <footer
      className="mt-6 text-center text-[11px] opacity-70"
      style={{ color: "var(--go-text-primary)" }}
    >
      Desenvolvido pela equipe de{" "}
      <span className="font-semibold" style={{ color: "var(--go-blue)" }}>
        RPA & IA
      </span>{" "}
      &middot; GoGroup &copy; {new Date().getFullYear()}
    </footer>
  );
}

function BrowserDots({ centered }: { centered?: boolean }) {
  return (
    <div className={cn("mb-6 flex gap-[7px] pt-3", centered && "justify-center")}>
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-blue)", opacity: 0.25 }} />
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-blue)", opacity: 0.15 }} />
      <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--go-lime)" }} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   Wizard Progress
   ══════════════════════════════════════════════ */

function WizardProgress({
  current,
  completed,
  onStepClick,
}: {
  current: number;
  completed: Set<number>;
  onStepClick: (n: number) => void;
}) {
  return (
    <div className="mb-8 flex items-start justify-center px-2">
      {STEPS.map((s, idx) => {
        const isActive = current === s.id;
        const isDone = completed.has(s.id) && !isActive;
        return (
          <div key={s.id} className="contents">
            <div
              className={cn(
                "flex min-w-16 flex-col items-center gap-1.5 cursor-default",
                isDone && "cursor-pointer"
              )}
              onClick={() => onStepClick(s.id)}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300",
                  isActive && "bg-[var(--go-blue)] text-white shadow-[0_0_0_4px_rgba(0,89,169,0.1)]",
                  isDone && "bg-[var(--go-blue)] text-white",
                  !isActive && !isDone && "border-[2.5px] border-[rgba(0,89,169,0.18)] bg-white text-[rgba(0,89,169,0.35)]"
                )}
                style={isActive || isDone ? { borderWidth: "2.5px", borderColor: "var(--go-blue)" } : undefined}
              >
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  s.id
                )}
              </div>
              <span
                className={cn(
                  "hidden text-center text-[10px] font-semibold uppercase tracking-[0.05em] transition-colors duration-300 sm:block",
                  isActive && "text-[var(--go-blue)]",
                  isDone && "text-[var(--go-text-primary)]",
                  !isActive && !isDone && "text-[rgba(0,89,169,0.4)]"
                )}
              >
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className="relative mt-[17px] min-w-8 flex-1 self-start"
                style={{ height: "2.5px", background: "rgba(0,89,169,0.1)", borderRadius: 2 }}
              >
                <div
                  className="absolute top-0 left-0 bottom-0 w-full"
                  style={{
                    background: "var(--go-blue)",
                    borderRadius: 2,
                    transformOrigin: "left",
                    transform: current > s.id || completed.has(s.id) ? "scaleX(1)" : "scaleX(0)",
                    transition: "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════
   Step Animation Wrapper
   ══════════════════════════════════════════════ */

function StepAnimation({ direction, children }: { direction: "forward" | "back"; children: React.ReactNode }) {
  return (
    <div
      style={{
        animation: `${direction === "forward" ? "go-step-in" : "go-step-in-back"} 0.35s cubic-bezier(0.4, 0, 0.2, 1) both`,
      }}
    >
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════
   Form Building Blocks
   ══════════════════════════════════════════════ */

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div
      className="mb-5 flex items-center gap-2.5 border-b pb-2.5 text-[13px] font-bold uppercase tracking-[0.05em]"
      style={{ color: "var(--go-text-heading)", borderColor: "rgba(0,89,169,0.1)" }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center text-sm"
        style={{ background: "rgba(0,89,169,0.07)", borderRadius: "var(--go-radius-sm)" }}
      >
        {icon}
      </div>
      {children}
    </div>
  );
}

function FormGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-[18px]", className)}>{children}</div>;
}

function FormLabel({ children, required, hint }: { children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <label className="mb-1.5 block text-[13px] font-semibold" style={{ color: "var(--go-text-primary)" }}>
      {children}
      {required && <span className="ml-0.5" style={{ color: "#dc2626" }}>*</span>}
      {hint && (
        <span className="mt-0.5 block text-[11px] font-normal" style={{ color: "#8b8b9a" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function FormInput({ error, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <>
      <input className={cn("go-input", error && "go-input-invalid", className)} {...props} />
      <FieldError message={error} />
    </>
  );
}

function FormSelect({ error, children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <>
      <select className={cn("go-select", error && "go-input-invalid", className)} {...props}>
        {children}
      </select>
      <FieldError message={error} />
    </>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      className="mt-1 text-[11px] font-semibold"
      style={{ color: "#dc2626", animation: "go-slide-down 0.2s ease" }}
    >
      {message}
    </p>
  );
}

function RadioGroup({
  name, options, value, onChange, error, vertical,
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
  vertical?: boolean;
}) {
  return (
    <>
      <div className={cn("flex gap-2.5", vertical && "flex-col gap-2")}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "go-radio-label",
              value === opt.value && "go-radio-checked",
              vertical && "justify-start px-3.5 py-3"
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute opacity-0"
            />
            {opt.label}
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </>
  );
}

function InfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <span className="go-info-icon" tabIndex={0} role="button" aria-label="Mais informações">
      i
      <span className="go-info-tooltip">
        {children}
        <span className="go-info-tooltip-arrow" />
      </span>
    </span>
  );
}

/* ══════════════════════════════════════════════
   Chips Input
   ══════════════════════════════════════════════ */

function ChipsInput({
  chips, onAdd, onRemove, error,
}: {
  chips: string[];
  onAdd: (email: string) => boolean;
  onRemove: (email: string) => void;
  error?: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const [tipMessage, setTipMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function tryAdd(raw: string) {
    const val = raw.trim().replace(/[,;]+$/, "").trim();
    if (!val) return;
    if (!EMAIL_RE.test(val)) {
      setTipMessage("Insira um e-mail válido (ex: nome@gocase.com.br)");
      return;
    }
    if (!ALLOWED_DOMAINS_RE.test(val)) {
      setTipMessage("Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos");
      return;
    }
    setTipMessage(null);
    if (onAdd(val)) setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (["Enter", " ", ",", ";", "Tab"].includes(e.key)) {
      const val = inputValue.trim();
      if (val) { e.preventDefault(); tryAdd(val); }
      else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
      onRemove(chips[chips.length - 1]);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (text && /[,;\s]/.test(text)) {
      e.preventDefault();
      text.split(/[,;\s]+/).forEach((p) => { if (p.trim()) tryAdd(p); });
      setInputValue("");
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1 rounded-lg px-2 py-1 transition-colors cursor-text",
          error && "!border-[#dc2626] shadow-[0_0_0_3px_rgba(220,38,38,0.08)]"
        )}
        style={{ background: "var(--go-white)", border: "1.5px solid rgba(215, 219, 0, 0.35)" }}
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{
              background: "rgba(0,89,169,0.06)",
              border: "1px solid rgba(0,89,169,0.18)",
              color: "var(--go-blue)",
              animation: "go-chip-in 0.15s ease",
            }}
          >
            <span className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">{chip}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(chip); }}
              className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-xs transition-colors"
              style={{ background: "rgba(0,89,169,0.1)", border: "none", color: "inherit" }}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="min-w-[160px] flex-1 border-none bg-transparent px-1 py-1 text-sm outline-none"
          style={{ fontFamily: "'Poppins', sans-serif", color: "var(--go-text-primary)" }}
          placeholder="exemplo@gocase.com.br"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setTipMessage(null); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => { if (inputValue.trim()) tryAdd(inputValue.trim()); }}
        />
      </div>
      {tipMessage && (
        <p className="mt-1 text-[11px] font-semibold" style={{ color: "#dc2626", animation: "go-slide-down 0.2s ease" }}>
          {tipMessage}
        </p>
      )}
      <FieldError message={error} />
    </>
  );
}

/* ══════════════════════════════════════════════
   Summary Row
   ══════════════════════════════════════════════ */

function SummaryRow({
  label, value, highlight, badge, last,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  badge?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-2 text-[13px]"
      style={last ? undefined : { borderBottom: "1px solid rgba(0,89,169,0.06)" }}
    >
      <span style={{ color: "var(--go-text-primary)" }}>{label}</span>
      <span
        className="overflow-hidden text-ellipsis whitespace-nowrap text-right font-semibold"
        style={{ color: "var(--go-blue)" }}
      >
        {badge ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{
              background: "rgba(215,219,0,0.12)",
              border: "1px solid rgba(215,219,0,0.3)",
              color: "#8a7d00",
            }}
          >
            {value}
          </span>
        ) : highlight ? (
          <span className="font-bold" style={{ color: "#16a34a" }}>{value}</span>
        ) : (
          value || "—"
        )}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════
   STEP 1: Quem Envia
   ══════════════════════════════════════════════ */

function Step1({
  form, errors, updateField, setError, clearError,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  setError: (key: string, msg: string) => void;
  clearError: (key: string) => void;
}) {
  const prodBlocked = form.prodStatus === "dev" || form.prodStatus === "idle";

  function addParticipant(email: string): boolean {
    const lower = email.toLowerCase();
    if (form.participantes.some((p) => p.toLowerCase() === lower)) return false;
    updateField("participantes", [...form.participantes, email]);
    return true;
  }

  function removeParticipant(email: string) {
    updateField("participantes", form.participantes.filter((p) => p !== email));
  }

  return (
    <div>
      {/* Production Gate */}
      <div
        className="relative mb-6 rounded-xl p-4"
        style={{ background: "rgba(199,233,253,0.3)", border: "1px solid rgba(0,89,169,0.08)" }}
      >
        <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
          Este projeto já está em produção?
          <InfoTooltip>
            <strong className="mb-0.5 block text-white">Somente projetos em produção</strong>
            O projeto precisa estar{" "}
            <em className="not-italic font-bold" style={{ color: "var(--go-lime)" }}>ativo e sendo utilizado</em>{" "}
            no dia a dia, com engajamento real de usuários ou processos.
          </InfoTooltip>
        </div>

        <RadioGroup
          name="prodStatus"
          value={form.prodStatus}
          onChange={(v) => updateField("prodStatus", v as FormData["prodStatus"])}
          error={errors.prodStatus}
          vertical
          options={[
            { value: "sim", label: "🟢 Sim, já está em produção e sendo utilizado" },
            { value: "dev", label: "🔧 Não, ainda está sendo desenvolvido" },
            { value: "idle", label: "⏸️ Está pronto, mas ainda não é utilizado" },
          ]}
        />

        {prodBlocked && (
          <div
            className="mt-3.5 rounded-lg p-3.5"
            style={{ background: "rgba(220,38,38,0.03)", border: "1px solid rgba(220,38,38,0.12)", animation: "go-slide-down 0.3s ease" }}
          >
            <div className="mb-1.5 text-xl">🚫</div>
            <div className="mb-1 text-[13px] font-bold" style={{ color: "#dc2626" }}>
              Submissão não permitida neste momento
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
              {form.prodStatus === "dev" ? (
                <>Projetos <strong style={{ color: "#dc2626" }}>ainda em desenvolvimento</strong> não podem ser submetidos.</>
              ) : (
                <>Projetos prontos mas <strong style={{ color: "#dc2626" }}>sem utilização ativa</strong> não podem ser submetidos.</>
              )}
            </div>
          </div>
        )}

        {form.prodStatus === "sim" && (
          <div
            className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold"
            style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)", color: "#16a34a", animation: "go-slide-down 0.25s ease" }}
          >
            ✅ Ótimo! Prossiga com o preenchimento abaixo.
          </div>
        )}
      </div>

      <SectionTitle icon="👤">Dados do Responsável</SectionTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormGroup>
          <FormLabel required>Nome Completo</FormLabel>
          <FormInput
            type="text"
            placeholder="Seu nome completo"
            value={form.nome}
            onChange={(e) => updateField("nome", e.currentTarget.value)}
            error={errors.nome}
          />
        </FormGroup>
        <FormGroup>
          <FormLabel required>E-mail</FormLabel>
          <FormInput
            type="email"
            placeholder="seu.email@gocase.com.br"
            value={form.email}
            onChange={(e) => updateField("email", e.currentTarget.value)}
            error={errors.email}
          />
        </FormGroup>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormGroup>
          <FormLabel required>Área</FormLabel>
          <FormSelect
            value={form.area}
            onChange={(e) => updateField("area", e.currentTarget.value)}
            error={errors.area}
          >
            <option value="">Selecione sua área</option>
            {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </FormSelect>
        </FormGroup>
        <FormGroup>
          <FormLabel required>Ferramenta Utilizada</FormLabel>
          <FormSelect
            value={form.ferramenta}
            onChange={(e) => updateField("ferramenta", e.currentTarget.value)}
            error={errors.ferramenta}
          >
            <option value="">Selecione a ferramenta</option>
            {FERRAMENTAS.map((f) => <option key={f} value={f}>{f}</option>)}
          </FormSelect>
          {form.ferramenta === "Outros" && (
            <div className="mt-2.5" style={{ animation: "go-slide-down 0.25s ease" }}>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
                ✏️ Especifique a ferramenta:
              </label>
              <FormInput
                placeholder="Nome da ferramenta..."
                value={form.ferramentaOutra}
                onChange={(e) => updateField("ferramentaOutra", e.currentTarget.value)}
                error={errors.ferramentaOutra}
                className="!border-[rgba(215,219,0,0.35)] focus:!border-[#b8a600] focus:!shadow-[0_0_0_3px_rgba(215,219,0,0.08)]"
              />
            </div>
          )}
        </FormGroup>
      </div>

      <FormGroup>
        <FormLabel required>Projeto desenvolvido em equipe?</FormLabel>
        <RadioGroup
          name="emEquipe"
          value={form.emEquipe}
          onChange={(v) => updateField("emEquipe", v as FormData["emEquipe"])}
          error={errors.emEquipe}
          options={[
            { value: "sim", label: "👥 Sim, em equipe" },
            { value: "nao", label: "👤 Não, individual" },
          ]}
        />
        {form.emEquipe === "sim" && (
          <div className="mt-2.5" style={{ animation: "go-slide-down 0.25s ease" }}>
            <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
              👥 E-mails dos participantes:
            </label>
            <ChipsInput
              chips={form.participantes}
              onAdd={addParticipant}
              onRemove={removeParticipant}
              error={errors.participantes}
            />
          </div>
        )}
      </FormGroup>
    </div>
  );
}

/* ══════════════════════════════════════════════
   STEP 2: Projeto (simplificado)
   ══════════════════════════════════════════════ */

function Step2({
  form, errors, updateField, clearError, arquivo, setArquivo,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  arquivo: File | null;
  setArquivo: (f: File | null) => void;
}) {
  const isN8n = form.ferramenta === "n8n";
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const n8nNameStatus = useMemo(() => {
    if (!isN8n || form.nomeProjeto.length < 3) return null;
    if (/^\[.+\]/.test(form.nomeProjeto)) return "ok";
    return "warn";
  }, [isN8n, form.nomeProjeto]);

  function handleFileSelect(file: File | null) {
    if (!file) return;
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_DOC_EXT.includes(ext)) {
      toast.error(`Formato não aceito. Use: ${ACCEPTED_DOC_EXT.join(", ")}`);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_MB}MB`);
      return;
    }
    setArquivo(file);
    clearError("documentacao");
  }

  return (
    <div>
      <SectionTitle icon="📋">Dados do Projeto</SectionTitle>

      <FormGroup>
        <FormLabel
          required
          hint={isN8n ? "Copie e cole o nome do fluxo exatamente como aparece no n8n" : undefined}
        >
          {isN8n ? "Nome exato do Fluxo Principal" : "Nome do Projeto"}
        </FormLabel>
        <FormInput
          type="text"
          placeholder={isN8n ? "Ex: [CX] Envio de NPS Automático" : "Ex: Automação de Relatórios de Vendas"}
          value={form.nomeProjeto}
          onChange={(e) => updateField("nomeProjeto", e.currentTarget.value)}
          error={errors.nomeProjeto}
        />
        {isN8n && (
          <div
            className="mt-2 rounded-lg p-2.5"
            style={{ background: "rgba(215,219,0,0.06)", border: "1px solid rgba(215,219,0,0.2)", animation: "go-slide-down 0.25s ease" }}
          >
            <div className="mb-1 flex items-center gap-1 text-[11px] font-bold" style={{ color: "#8a7d00" }}>
              ⚠️ Atenção: nome deve ser idêntico ao do n8n
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
              O nome precisa ser <strong style={{ color: "#8a7d00" }}>copiado exatamente</strong> como aparece no n8n — incluindo maiúsculas, espaços e prefixo entre colchetes.
            </div>
          </div>
        )}
        {n8nNameStatus && (
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={
              n8nNameStatus === "ok"
                ? { background: "rgba(34,197,94,0.06)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.15)" }
                : { background: "rgba(215,219,0,0.06)", color: "#8a7d00", border: "1px solid rgba(215,219,0,0.2)" }
            }
          >
            {n8nNameStatus === "ok"
              ? "✅ Prefixo detectado — parece um nome válido de fluxo n8n"
              : "⚠️ Sem prefixo — verifique se copiou o nome correto do n8n"}
          </span>
        )}
      </FormGroup>

      <FormGroup>
        <FormLabel required hint="Quando o projeto foi desenvolvido e colocado em produção">
          Data de Criação do Projeto
        </FormLabel>
        <FormInput
          type="date"
          value={form.dataCriacao}
          max={new Date().toISOString().split("T")[0]}
          onChange={(e) => updateField("dataCriacao", e.currentTarget.value)}
          error={errors.dataCriacao}
          className="cursor-pointer"
        />
      </FormGroup>

      <FormGroup>
        <FormLabel required hint="Envie qualquer documentação que descreva o projeto: PDF, DOCX, TXT ou MD">
          Documentação do Projeto
        </FormLabel>

        {/* Info box */}
        <div
          className="mb-2 rounded-lg p-3 text-[12px] leading-relaxed"
          style={{ background: "rgba(0,89,169,0.03)", border: "1px solid rgba(0,89,169,0.08)", color: "var(--go-text-primary)" }}
        >
          🤖 <strong style={{ color: "var(--go-blue)" }}>O agente vai analisar sua documentação</strong> e solicitar apenas as informações que estiverem faltando para completar o padrão exigido. Quanto mais detalhada, menos perguntas serão feitas.
        </div>

        {/* Upload area */}
        <div
          className={cn(
            "relative cursor-pointer rounded-xl p-6 text-center transition-colors",
            dragOver && "!border-[var(--go-blue)] !bg-[rgba(199,233,253,0.4)]",
            errors.documentacao && "!border-[#dc2626]"
          )}
          style={{ border: "2px dashed rgba(0,89,169,0.25)", background: "rgba(199,233,253,0.15)" }}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelect(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_DOC_EXT.join(",")}
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <div className="mb-2 text-[28px] opacity-60">📄</div>
          <div className="text-xs" style={{ color: "var(--go-text-primary)" }}>
            <strong style={{ color: "var(--go-blue)" }}>Clique para selecionar</strong> ou arraste o arquivo
            <br />
            <small>PDF, DOCX, DOC, TXT, MD — máx. {MAX_FILE_MB}MB</small>
          </div>
        </div>

        {arquivo && (
          <div
            className="mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: "rgba(0,89,169,0.04)", color: "var(--go-blue)" }}
          >
            <span>📎 {arquivo.name}</span>
            <button
              type="button"
              onClick={() => setArquivo(null)}
              className="ml-2 rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
            >
              remover
            </button>
          </div>
        )}

        <FieldError message={errors.documentacao} />
      </FormGroup>
    </div>
  );
}
