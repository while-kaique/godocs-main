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

type ChatFase = "doc" | "doc_preview" | "saving" | "saving_preview" | "completo";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  options?: [string, string, string];
  isComplete?: boolean;
  isPreview?: boolean;
  fase?: ChatFase;
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
  const [chatFase, setChatFase] = useState<ChatFase>("doc");
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [iniciandoChat, setIniciandoChat] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [approvedDocPreview, setApprovedDocPreview] = useState<string | null>(null);
  const [approvedSavingPreview, setApprovedSavingPreview] = useState<string | null>(null);
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
      if (!form.nomeProjeto.trim() || form.nomeProjeto.trim().length < 3)
        errs.nomeProjeto = "Informe o nome do projeto (mínimo 3 caracteres)";
      if (!form.dataCriacao) {
        errs.dataCriacao = "Informe a data de criação";
      } else if (form.dataCriacao < "2024-01-01") {
        errs.dataCriacao = "A data mínima é 01/01/2024";
      } else if (form.dataCriacao > new Date().toISOString().split("T")[0]) {
        errs.dataCriacao = "A data não pode ser no futuro";
      }
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
        // Salva o preview da doc aprovado (última mensagem de preview no chat)
        const lastPreviewMsg = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        if (lastPreviewMsg) setApprovedDocPreview(lastPreviewMsg.content);

        // Mostra tela de transição por 3s, depois inicia o agente saving
        setShowTransition(true);
        setChatFase(newFase);
        setTimeout(async () => {
          setShowTransition(false);
          setChatMessages([]);
          setChatLoading(true);
          try {
            const savingResult = await enviarMensagemFn({
              data: {
                projeto_id: projetoId!,
                content: "[SISTEMA] Iniciar fase saving",
              },
            });
            const savingMsg: ChatMessage = {
              role: "assistant",
              content: savingResult.content,
              options: savingResult.options ?? undefined,
              isComplete: savingResult.isComplete,
              isPreview: savingResult.isPreview,
              fase: savingResult.fase ?? "saving",
            };
            setChatMessages([savingMsg]);
            if (savingResult.fase) setChatFase(savingResult.fase);
          } catch (e) {
            console.error('[submeter] falha ao iniciar saving:', e);
            toast.error("Erro ao iniciar análise de impacto. Tente enviar uma mensagem.");
          } finally {
            setChatLoading(false);
          }
        }, 3000);
      } else {
        setChatMessages((prev) => [...prev, assistantMsg]);
        setChatFase(newFase);
      }

      if (result.isComplete) {
        // Salva o preview do saving aprovado
        const lastSavingPreview = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        if (lastSavingPreview) setApprovedSavingPreview(lastSavingPreview.content);
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
                  fase={chatFase}
                  showTransition={showTransition}
                  approvedDocPreview={approvedDocPreview}
                  approvedSavingPreview={approvedSavingPreview}
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

/* ──────────────────────────────────────────────
   Simple Markdown Renderer
   ────────────────────────────────────────────── */

function SimpleMarkdown({ text, isSaving }: { text: string; isSaving: boolean }) {
  const accentColor = isSaving ? "#6b6e00" : "var(--go-blue)";
  const accentBg = isSaving ? "rgba(215,219,0,0.06)" : "rgba(0,89,169,0.04)";
  const accentBorder = isSaving ? "rgba(215,219,0,0.15)" : "rgba(0,89,169,0.08)";

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul
        key={key++}
        className="space-y-1.5 pl-1"
        style={{ margin: "8px 0" }}
      >
        {listBuffer.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-[13px] leading-relaxed"
            style={{ color: "var(--go-text-primary)" }}
          >
            <span
              className="mt-[7px] block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accentColor, opacity: 0.5 }}
            />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  function renderInline(line: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;
    let partKey = 0;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      parts.push(
        <strong key={partKey++} style={{ color: accentColor, fontWeight: 700 }}>
          {match[1]}
        </strong>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? parts : line;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // H1
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flushList();
      elements.push(
        <h2
          key={key++}
          className="text-[17px] font-extrabold tracking-tight"
          style={{ color: accentColor, margin: "0 0 4px" }}
        >
          {line.replace(/^# /, "")}
        </h2>
      );
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      flushList();
      elements.push(
        <div key={key++} style={{ margin: elements.length > 0 ? "16px 0 6px" : "0 0 6px" }}>
          <div
            className="flex items-center gap-2"
            style={{ borderBottom: `1.5px solid ${accentBorder}`, paddingBottom: 6 }}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: accentColor, opacity: 0.6 }}
            />
            <h3
              className="text-[13px] font-bold uppercase tracking-[0.06em]"
              style={{ color: accentColor }}
            >
              {line.replace(/^## /, "")}
            </h3>
          </div>
        </div>
      );
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      flushList();
      elements.push(
        <h4
          key={key++}
          className="text-[13px] font-semibold"
          style={{ color: accentColor, margin: "10px 0 4px" }}
        >
          {line.replace(/^### /, "")}
        </h4>
      );
      continue;
    }

    // List items
    if (/^[-*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      const content = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      listBuffer.push(content);
      continue;
    }

    // Sub-list items (indented)
    if (/^\s+[-*]\s/.test(line)) {
      const content = line.replace(/^\s+[-*]\s+/, "");
      listBuffer.push(content);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p
        key={key++}
        className="text-[13px] leading-relaxed"
        style={{ color: "var(--go-text-primary)", margin: "4px 0" }}
      >
        {renderInline(line)}
      </p>
    );
  }

  flushList();

  return <>{elements}</>;
}

/* ──────────────────────────────────────────────
   Preview Panel
   ────────────────────────────────────────────── */

function PreviewPanel({
  content,
  isSaving,
  onApprove,
  onRequestChanges,
  showActions,
  loading,
}: {
  content: string;
  isSaving: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
  showActions: boolean;
  loading: boolean;
}) {
  const accentColor = isSaving ? "#6b6e00" : "var(--go-blue)";
  const cardBg = isSaving ? "rgba(215,219,0,0.03)" : "rgba(0,89,169,0.015)";
  const headerBg = isSaving ? "rgba(215,219,0,0.08)" : "rgba(0,89,169,0.04)";
  const borderColor = isSaving ? "rgba(215,219,0,0.18)" : "rgba(0,89,169,0.1)";
  const label = isSaving ? "Memorial de Cálculo" : "Documentação do Projeto";
  const icon = isSaving ? "📊" : "📄";

  // Strip trailing prompt lines like "Essa documentação está correta?..."
  const cleanContent = content
    .replace(/\n*Essa documentação está correta\?.*$/s, "")
    .replace(/\n*Está correto\?.*$/s, "")
    .replace(/\n*Pode aprovar.*$/s, "")
    .replace(/\n*Você pode aprovar.*$/s, "")
    .trim();

  return (
    <div
      className="w-full"
      style={{
        animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
      }}
    >
      {/* Document card */}
      <div
        className="overflow-hidden"
        style={{
          background: "var(--go-white)",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "var(--go-radius-lg)",
          boxShadow: "var(--go-shadow-md)",
        }}
      >
        {/* Header strip */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{
            background: headerBg,
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-base">{icon}</span>
            <span
              className="text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{ color: accentColor }}
            >
              {label}
            </span>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "rgba(215,219,0,0.1)",
              border: "1px solid rgba(215,219,0,0.2)",
              color: "#8a7d00",
            }}
          >
            Preview
          </span>
        </div>

        {/* Content body — scrollable */}
        <div
          className="overflow-y-auto px-5 py-4"
          style={{
            maxHeight: 300,
            background: cardBg,
          }}
        >
          <SimpleMarkdown text={cleanContent} isSaving={isSaving} />
        </div>

        {/* Action buttons — inside the card */}
        {showActions && (
          <div
            className="flex items-center gap-3 px-5 py-3.5"
            style={{
              background: "var(--go-white)",
              borderTop: `1px solid ${borderColor}`,
            }}
          >
            <button
              type="button"
              onClick={onApprove}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold transition-all"
              style={{
                background: "var(--go-lime)",
                color: "var(--go-blue)",
                border: "none",
                boxShadow: "0 2px 8px rgba(215, 219, 0, 0.2)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(215, 219, 0, 0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(215, 219, 0, 0.2)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Aprovar
            </button>
            <button
              type="button"
              onClick={onRequestChanges}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: "transparent",
                color: "#8b8b9a",
                border: "1.5px solid rgba(0,0,0,0.08)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,89,169,0.2)";
                e.currentTarget.style.color = "var(--go-blue)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
                e.currentTarget.style.color = "#8b8b9a";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Pedir ajustes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Final Review (previews colapsáveis + envio)
   ────────────────────────────────────────────── */

function FinalReview({
  approvedDocPreview,
  approvedSavingPreview,
  onSubmitProject,
  submitting,
}: {
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
  onSubmitProject: () => void;
  submitting: boolean;
}) {
  const [expandedDoc, setExpandedDoc] = useState(false);
  const [expandedSaving, setExpandedSaving] = useState(false);

  return (
    <div
      className="px-8 py-6"
      style={{
        borderTop: "1px solid rgba(22,163,74,0.15)",
        animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
      }}
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: "rgba(22,163,74,0.08)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <div className="text-[14px] font-bold" style={{ color: "var(--go-text-heading)" }}>
            Tudo pronto!
          </div>
          <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
            Revise os documentos abaixo antes de enviar
          </div>
        </div>
      </div>

      {/* Card: Documentação Técnica */}
      {approvedDocPreview && (
        <CollapsiblePreviewCard
          title="Documentação Técnica"
          icon="📄"
          accentColor="var(--go-blue)"
          accentBg="rgba(0,89,169,0.04)"
          accentBorder="rgba(0,89,169,0.1)"
          content={approvedDocPreview}
          expanded={expandedDoc}
          onToggle={() => setExpandedDoc((v) => !v)}
          isSaving={false}
        />
      )}

      {/* Card: Memorial de Cálculo */}
      {approvedSavingPreview && (
        <CollapsiblePreviewCard
          title="Memorial de Cálculo"
          icon="📊"
          accentColor="#6b6e00"
          accentBg="rgba(215,219,0,0.04)"
          accentBorder="rgba(215,219,0,0.15)"
          content={approvedSavingPreview}
          expanded={expandedSaving}
          onToggle={() => setExpandedSaving((v) => !v)}
          isSaving={true}
        />
      )}

      {/* Botão de envio */}
      <button
        type="button"
        onClick={onSubmitProject}
        disabled={submitting}
        className="go-btn-submit w-full mt-4 inline-flex items-center justify-center gap-2"
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
  );
}

function CollapsiblePreviewCard({
  title,
  icon,
  accentColor,
  accentBg,
  accentBorder,
  content,
  expanded,
  onToggle,
  isSaving,
}: {
  title: string;
  icon: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  content: string;
  expanded: boolean;
  onToggle: () => void;
  isSaving: boolean;
}) {
  const cleanContent = content
    .replace(/\n*Essa documentação está correta\?.*$/s, "")
    .replace(/\n*Está correto\?.*$/s, "")
    .replace(/\n*Pode aprovar.*$/s, "")
    .replace(/\n*Você pode aprovar.*$/s, "")
    .replace(/\n*Fiz os ajustes.*$/s, "")
    .trim();

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl transition-all"
      style={{
        border: `1.5px solid ${accentBorder}`,
        background: "var(--go-white)",
      }}
    >
      {/* Header — clicável */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 transition-colors"
        style={{ background: expanded ? accentBg : "transparent" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">{icon}</span>
          <span
            className="text-[12px] font-bold uppercase tracking-[0.06em]"
            style={{ color: accentColor }}
          >
            {title}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold"
            style={{
              background: "rgba(22,163,74,0.08)",
              border: "1px solid rgba(22,163,74,0.15)",
              color: "#16a34a",
            }}
          >
            Aprovado
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={accentColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Conteúdo colapsável */}
      {expanded && (
        <div
          className="overflow-y-auto px-5 py-4"
          style={{
            maxHeight: 280,
            borderTop: `1px solid ${accentBorder}`,
            background: accentBg,
            animation: "go-slide-down 0.25s ease",
          }}
        >
          <SimpleMarkdown text={cleanContent} isSaving={isSaving} />
        </div>
      )}
    </div>
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
  fase,
  showTransition,
  approvedDocPreview,
  approvedSavingPreview,
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
  fase: ChatFase;
  showTransition: boolean;
  approvedDocPreview: string | null;
  approvedSavingPreview: string | null;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSavingFase = fase === "saving" || fase === "saving_preview" || fase === "completo";

  // Cores por fase
  const accentColor = isSavingFase ? "var(--go-lime)" : "var(--go-blue)";
  const accentBg = isSavingFase ? "rgba(215,219,0,0.08)" : "rgba(0,89,169,0.08)";
  const accentBgLight = isSavingFase ? "rgba(215,219,0,0.12)" : "rgba(199,233,253,0.4)";
  const accentBorder = isSavingFase ? "rgba(215,219,0,0.2)" : "rgba(0,89,169,0.1)";
  const accentTextOnBg = isSavingFase ? "var(--go-text-heading)" : "#fff";
  const userBubbleBg = isSavingFase ? "#7a7d00" : "var(--go-blue)";

  const lastMsg = messages[messages.length - 1];
  const showPreviewActions = lastMsg?.isPreview && !loading;
  const hasOptions = lastMsg?.role === "assistant" && lastMsg.options && !isComplete && !showPreviewActions;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading && !isComplete && !showPreviewActions) {
        onSend(input.trim());
      }
    }
  }

  const agentLabel = isSavingFase ? "Análise de Impacto" : "Documentação Técnica";
  const agentStatus = isComplete
    ? "Submissão completa — pronto para envio"
    : showPreviewActions
      ? "Aguardando sua aprovação..."
      : isSavingFase
        ? "Calculando o ganho financeiro do projeto..."
        : "Analisando e coletando informações...";

  return (
    <div className="flex flex-col" style={{ minHeight: 420 }}>
      {/* Cabeçalho do chat */}
      <div
        className="flex items-center gap-2.5 px-8 pb-4 transition-colors duration-500"
        style={{ borderBottom: `1px solid ${accentBorder}` }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors duration-500"
          style={{ background: accentBg, color: accentColor }}
        >
          {isSavingFase ? "💰" : "🤖"}
        </div>
        <div>
          <div
            className="text-[13px] font-bold transition-colors duration-500"
            style={{ color: isSavingFase ? "#6b6e00" : "var(--go-text-heading)" }}
          >
            {agentLabel}
          </div>
          <div className="text-[11px]" style={{ color: "#8b8b9a" }}>
            {agentStatus}
          </div>
        </div>
      </div>

      {/* Tela de transição doc → saving */}
      {showTransition && (
        <div
          className="flex flex-col items-center justify-center px-8 py-12"
          style={{
            minHeight: 420,
            animation: "go-step-in 0.5s cubic-bezier(0.4, 0, 0.2, 1) both",
          }}
        >
          {/* Ícone de check animado */}
          <div
            className="mb-5 flex items-center justify-center"
            style={{
              width: 64,
              height: 64,
              background: "rgba(22,163,74,0.08)",
              border: "2px solid rgba(22,163,74,0.2)",
              borderRadius: "50%",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s both",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h3
            className="mb-2 text-[17px] font-extrabold tracking-tight text-center"
            style={{
              color: "var(--go-text-heading)",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both",
            }}
          >
            Documentação aprovada!
          </h3>
          <p
            className="mb-6 text-[13px] text-center leading-relaxed max-w-[320px]"
            style={{
              color: "var(--go-text-primary)",
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.3s both",
            }}
          >
            Agora vamos calcular o impacto financeiro do seu projeto — quanto tempo e dinheiro ele economiza.
          </p>

          {/* Barra de progresso visual */}
          <div
            className="flex items-center gap-3"
            style={{
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.5s both",
            }}
          >
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px]"
                style={{ background: "rgba(22,163,74,0.1)", color: "#16a34a" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "#16a34a" }}>Documentação</span>
            </div>
            <div
              className="h-[2px] w-8"
              style={{ background: "linear-gradient(90deg, #16a34a, var(--go-lime))" }}
            />
            <div className="flex items-center gap-1.5">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: "rgba(215,219,0,0.15)", color: "#6b6e00", border: "1.5px solid rgba(215,219,0,0.3)" }}
              >
                2
              </div>
              <span className="text-[11px] font-semibold" style={{ color: "#6b6e00" }}>Impacto</span>
            </div>
          </div>

          {/* Loading dots */}
          <div
            className="mt-6 flex gap-1.5 items-center"
            style={{
              animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.7s both",
            }}
          >
            {[0, 0.2, 0.4].map((delay) => (
              <span
                key={delay}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: "#6b6e00",
                  opacity: 0.5,
                  animation: `go-bounce 1.2s ease-in-out ${delay}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Mensagens */}
      {!showTransition && (<div
        className="flex-1 overflow-y-auto px-8 py-5 space-y-4 transition-colors duration-500"
        style={{ maxHeight: 420, background: isSavingFase ? "rgba(215,219,0,0.03)" : "transparent" }}
      >
        {messages.map((msg, idx) => {
          const isPreviewMsg = msg.isPreview && msg.role === "assistant";

          if (isPreviewMsg) {
            return (
              <PreviewPanel
                key={idx}
                content={msg.content}
                isSaving={isSavingFase}
                onApprove={() => onSend("Aprovado")}
                onRequestChanges={() => {
                  const textarea = inputRef.current;
                  if (textarea) {
                    textarea.focus();
                    textarea.placeholder = "Descreva o que precisa ser ajustado...";
                  }
                }}
                showActions={idx === messages.length - 1 && !loading}
                loading={loading}
              />
            );
          }

          return (
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
                  msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
                )}
                style={
                  msg.role === "user"
                    ? { background: userBubbleBg, color: "#fff" }
                    : {
                        background: accentBgLight,
                        border: `1px solid ${accentBorder}`,
                        color: "var(--go-text-heading)",
                      }
                }
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl rounded-tl-sm px-4 py-3"
              style={{ background: accentBgLight, border: `1px solid ${accentBorder}` }}
            >
              <div className="flex gap-1.5 items-center h-5">
                {[0, 0.2, 0.4].map((delay) => (
                  <span
                    key={delay}
                    className="h-2 w-2 rounded-full"
                    style={{
                      background: accentColor,
                      opacity: 0.5,
                      animation: `go-bounce 1.2s ease-in-out ${delay}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>
      )}

      {/* Options (quando agente oferece opções) */}
      {!showTransition && hasOptions && lastMsg.options && (
        <div
          className="px-8 pb-3 flex flex-wrap gap-2"
          style={{ borderTop: `1px solid ${accentBorder}` }}
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
                background: accentBg,
                border: `1px solid ${accentBorder}`,
                color: isSavingFase ? "#6b6e00" : "var(--go-blue)",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Revisão final + envio */}
      {!showTransition && isComplete && (
        <FinalReview
          approvedDocPreview={approvedDocPreview}
          approvedSavingPreview={approvedSavingPreview}
          onSubmitProject={onSubmitProject}
          submitting={submitting}
        />
      )}

      {/* Input de mensagem */}
      {!showTransition && !isComplete && (
        <div
          className="px-8 py-4"
          style={{ borderTop: `1px solid ${accentBorder}` }}
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
                  ? (isSavingFase ? "#7a7d00" : "var(--go-blue)")
                  : (isSavingFase ? "rgba(215,219,0,0.15)" : "rgba(0,89,169,0.1)"),
                border: "none",
                color: input.trim() && !loading ? "#fff" : (isSavingFase ? "rgba(215,219,0,0.5)" : "rgba(0,89,169,0.4)"),
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
          min="2024-01-01"
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
