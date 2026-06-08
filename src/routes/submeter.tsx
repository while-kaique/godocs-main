import { createFileRoute, useNavigate } from "@tanstack/react-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────── */

const WEBHOOK_URL =
  "https://n8n-study.gogroupgl.com/webhook/submit_workflows_post";

const GEMINI_DOC_LINK =
  "https://gemini.google.com/gem/1xDpt0qEhDq1WAPuXgqbDkhUWad5aRqZR";

const AREAS = [
  "AZ",
  "B2B Gobeauté",
  "B2B Gocase",
  "Contabilidade",
  "CSC",
  "CX",
  "CX - Agentes",
  "Dados",
  "Departamento Pessoal",
  "E-commerce",
  "Facilities",
  "Financeiro",
  "Fiscal",
  "FP&A",
  "Gente e Gestão",
  "Growth",
  "Ilustração",
  "Jurídico",
  "Logística",
  "M&A",
  "Marketing de Influência",
  "Offline - Administrativo",
  "Offline - Lojas",
  "Operações Gobeauté",
  "Operações Gocase - Administrativo",
  "Transportes",
  "Qualidade",
  "Manutenção",
  "Expedição",
  "Almoxarifado",
  "Produção",
  "Produto Gobeauté",
  "Produto Gocase",
  "Projetos e Integrações",
  "RPA",
  "Marketing - Branding",
  "Sourcing & Procurement Gobeauté",
  "Supply Gogroup",
  "Tecnologia",
] as const;

const FERRAMENTAS = [
  "n8n",
  "Python",
  "Google Apps Script",
  "Make",
  "Lovable",
  "Selenium",
  "Puppeteer",
  "Power BI",
  "Claude + Vercel",
  "Outros",
] as const;

const ACCEPTED_DOC_EXT = [".pdf", ".docx", ".doc", ".txt", ".md"];
const MAX_FILE_MB = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_DOMAINS_RE = /^[^\s@]+@(gocase|gobeaute|gogroup)\.(com|com\.br)$/i;

const STEPS = [
  { id: 1, label: "Envio" },
  { id: 2, label: "Projeto" },
  { id: 3, label: "Impacto" },
  { id: 4, label: "Enviar" },
];

const CUSTO_HORA_TABLE = [
  { cargo: "Estagiário", valor: "R$ 10,78" },
  { cargo: "Assistente", valor: "R$ 13,94" },
  { cargo: "Analista Júnior", valor: "R$ 21,29" },
  { cargo: "Analista Pleno", valor: "R$ 29,90" },
  { cargo: "Analista Sênior", valor: "R$ 33,10" },
  { cargo: "Coordenador / Especialista", valor: "R$ 55,15" },
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
  descricao: string;
  checkMercado: "sim" | "nao" | "";
  savingHoras: string;
  savingReais: string;
  tipoSaving: "mensal" | "pontual" | "";
  memorialCalculo: string;
}

interface FieldErrors {
  [key: string]: string;
}

/* ──────────────────────────────────────────────
   Route
   ────────────────────────────────────────────── */

export const Route = createFileRoute("/submeter")({
  head: () => ({
    meta: [
      { title: "Triagem de Fluxos | RPA & IA" },
      {
        name: "description",
        content:
          "Formulário interno para submissão de projetos de RPA e IA.",
      },
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
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [shaking, setShaking] = useState(false);
  const formCardRef = useRef<HTMLDivElement>(null);

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
    descricao: "",
    checkMercado: "",
    savingHoras: "",
    savingReais: "",
    tipoSaving: "",
    memorialCalculo: "",
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
    [],
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

  /* ── Computed ── */
  const horas = parseFloat(form.savingHoras) || 0;
  const reais = parseFloat(form.savingReais) || 0;
  const valorHora = horas > 0 ? reais / horas : 0;
  const ratioBlock = horas > 0 && reais > 0 && valorHora < 8;
  const ratioWarn = valorHora > 60 && !ratioBlock;
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
      // Validar domínios dos participantes
      if (form.emEquipe === "sim" && form.participantes.length > 0) {
        const invalid = form.participantes.filter(
          (p) => !ALLOWED_DOMAINS_RE.test(p),
        );
        if (invalid.length > 0)
          errs.participantes =
            "Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos";
      }
    }

    if (n === 2) {
      if (!form.nomeProjeto.trim() || form.nomeProjeto.trim().length < 3)
        errs.nomeProjeto = "Informe o nome do projeto";
      if (!form.dataCriacao) errs.dataCriacao = "Informe a data de criação";
      if (!form.descricao.trim() || form.descricao.trim().length < 10)
        errs.descricao = "Descreva o projeto (mínimo 10 caracteres)";
      if (!arquivo) errs.documentacao = "Envie a documentação do projeto";
    }

    if (n === 3) {
      if (!form.checkMercado) errs.checkMercado = "Selecione uma opção";
      if (!form.savingHoras || parseFloat(form.savingHoras) <= 0)
        errs.savingHoras = "Informe as horas economizadas (maior que 0)";
      if (!form.savingReais || parseFloat(form.savingReais) <= 0)
        errs.savingReais = "Informe o valor economizado (maior que 0)";
      if (
        parseFloat(form.savingHoras) > 0 &&
        parseFloat(form.savingReais) > 0
      ) {
        const ratio =
          parseFloat(form.savingReais) / parseFloat(form.savingHoras);
        if (ratio < 8)
          errs.savingReais =
            "Valor/hora abaixo de R$ 8 — revise os dados";
      }
      if (!form.tipoSaving) errs.tipoSaving = "Selecione o tipo de saving";
    }

    if (n === 4) {
      if (
        !form.memorialCalculo.trim() ||
        form.memorialCalculo.trim().length < 20
      )
        errs.memorialCalculo =
          "Descreva o memorial de cálculo (mínimo 20 caracteres)";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  /* ── Navigation ── */
  function goToStep(target: number, dir: "forward" | "back") {
    setDirection(dir);
    setStep(target);
    formCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function handleNext() {
    if (validateStep(step)) {
      setCompletedSteps((prev) => new Set([...prev, step]));
      goToStep(step + 1, "forward");
    } else {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
    }
  }

  function handleBack() {
    if (step > 1) goToStep(step - 1, "back");
  }

  function handleStepClick(target: number) {
    if (completedSteps.has(target) && target !== step) {
      goToStep(target, target < step ? "back" : "forward");
    }
  }

  /* ── Submit ── */
  async function handleSubmit() {
    // Validate all steps
    let allValid = true;
    for (let s = 1; s <= 4; s++) {
      if (!validateStep(s)) {
        allValid = false;
        if (s !== step) goToStep(s, s < step ? "back" : "forward");
        break;
      }
    }
    if (!allValid) return;

    setSubmitting(true);
    try {
      const fd = new window.FormData();
      fd.append("nome", form.nome.trim());
      fd.append("email", form.email.trim());
      fd.append("area", form.area);
      fd.append(
        "ferramenta",
        form.ferramenta === "Outros" && form.ferramentaOutra.trim()
          ? `Outros: ${form.ferramentaOutra.trim()}`
          : form.ferramenta,
      );
      fd.append("em_equipe", form.emEquipe === "sim" ? "Sim" : "Não");
      if (form.emEquipe === "sim") {
        fd.append("participantes", form.participantes.join(", "));
      }
      fd.append("nome_projeto", form.nomeProjeto.trim());
      fd.append("data_criacao", form.dataCriacao);
      fd.append("descricao", form.descricao.trim());
      fd.append("check_mercado", form.checkMercado === "sim" ? "Sim" : "Não");
      fd.append("saving_horas", form.savingHoras);
      fd.append("saving_reais", form.savingReais);
      fd.append("tipo_saving", form.tipoSaving === "mensal" ? "Mensal" : "Pontual");
      fd.append("memorial_calculo", form.memorialCalculo.trim());
      fd.append(
        "valor_por_hora",
        (parseFloat(form.savingReais) / parseFloat(form.savingHoras)).toFixed(
          2,
        ),
      );
      if (arquivo) {
        fd.append("documentacao", arquivo, arquivo.name);
      }

      const res = await fetch(WEBHOOK_URL, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Erro ${res.status}`);

      setSubmitted(true);
      toast.success("Projeto submetido com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Falha ao enviar o projeto. Tente novamente.");
    } finally {
      setSubmitting(false);
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
            {/* Green gradient bar */}
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{
                background:
                  "linear-gradient(90deg, #16a34a 0%, #4ade80 50%, var(--go-lime) 100%)",
              }}
            />
            <BrowserDots centered />
            {/* Success icon */}
            <div
              className="mx-auto mb-6 flex items-center justify-center"
              style={{
                width: 72,
                height: 72,
                background: "rgba(22,163,74,0.06)",
                border: "2px solid rgba(22,163,74,0.15)",
                borderRadius: "50%",
                animation: "go-pulse-ring 2.5s ease-in-out infinite",
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
              Enviado com Sucesso!
            </h2>
            <p
              className="mb-7 text-sm leading-relaxed"
              style={{ color: "var(--go-text-primary)" }}
            >
              Sua submissão foi recebida e será analisada pela equipe de RPA/IA.
              <br />
              Você receberá um retorno em breve.
            </p>
            {/* Info box */}
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
              <SummaryRow
                label="Saving Horas"
                value={`${form.savingHoras}h/mês`}
                highlight
              />
              <SummaryRow
                label="Saving Reais"
                value={`R$ ${parseFloat(form.savingReais).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês`}
                highlight
              />
              <SummaryRow
                label="Status"
                value="Pendente de análise"
                badge
                last
              />
            </div>
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="go-btn-primary"
              >
                Submeter outro fluxo
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
            padding: "32px 32px 24px",
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

          <BrowserDots />

          <WizardProgress
            current={step}
            completed={completedSteps}
            onStepClick={handleStepClick}
          />

          {/* Steps container */}
          <div className="relative min-h-[200px]">
            {step === 1 && (
              <StepAnimation direction={direction}>
                <Step1
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  setError={setError}
                  clearError={clearError}
                />
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
                <Step3
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  clearError={clearError}
                  horas={horas}
                  reais={reais}
                  valorHora={valorHora}
                  ratioBlock={ratioBlock}
                  ratioWarn={ratioWarn}
                />
              </StepAnimation>
            )}
            {step === 4 && (
              <StepAnimation direction={direction}>
                <Step4
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  clearError={clearError}
                />
              </StepAnimation>
            )}
          </div>

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="go-btn-back"
              style={{ visibility: step === 1 ? "hidden" : "visible" }}
            >
              &larr; Voltar
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className={cn("go-btn-next", shaking && "go-shake")}
                disabled={prodBlocked && step === 1}
              >
                Proximo &rarr;
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="go-btn-submit"
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
            )}
          </div>
        </div>

        <PageFooter />
      </div>
    </PageFrame>
  );
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
    <div
      className={cn("mb-6 flex gap-[7px] pt-3", centered && "justify-center")}
    >
      <span
        className="block h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--go-blue)", opacity: 0.25 }}
      />
      <span
        className="block h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--go-blue)", opacity: 0.15 }}
      />
      <span
        className="block h-2.5 w-2.5 rounded-full"
        style={{ background: "var(--go-lime)" }}
      />
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
                isDone && "cursor-pointer",
              )}
              onClick={() => onStepClick(s.id)}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300",
                  isActive &&
                    "bg-[var(--go-blue)] text-white shadow-[0_0_0_4px_rgba(0,89,169,0.1)]",
                  isDone && "bg-[var(--go-blue)] text-white",
                  !isActive &&
                    !isDone &&
                    "border-[2.5px] border-[rgba(0,89,169,0.18)] bg-white text-[rgba(0,89,169,0.35)]",
                )}
                style={
                  isActive || isDone
                    ? { borderWidth: "2.5px", borderColor: "var(--go-blue)" }
                    : undefined
                }
              >
                {isDone ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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
                  !isActive &&
                    !isDone &&
                    "text-[rgba(0,89,169,0.4)]",
                )}
              >
                {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className="relative mt-[17px] min-w-8 flex-1 self-start"
                style={{
                  height: "2.5px",
                  background: "rgba(0,89,169,0.1)",
                  borderRadius: 2,
                }}
              >
                <div
                  className="absolute top-0 left-0 bottom-0 w-full transition-transform duration-400"
                  style={{
                    background: "var(--go-blue)",
                    borderRadius: 2,
                    transformOrigin: "left",
                    transform:
                      current > s.id || completed.has(s.id)
                        ? "scaleX(1)"
                        : "scaleX(0)",
                    transition:
                      "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
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

function StepAnimation({
  direction,
  children,
}: {
  direction: "forward" | "back";
  children: React.ReactNode;
}) {
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

function SectionTitle({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-5 flex items-center gap-2.5 border-b pb-2.5 text-[13px] font-bold uppercase tracking-[0.05em]"
      style={{
        color: "var(--go-text-heading)",
        borderColor: "rgba(0,89,169,0.1)",
      }}
    >
      <div
        className="flex h-7 w-7 items-center justify-center text-sm"
        style={{
          background: "rgba(0,89,169,0.07)",
          borderRadius: "var(--go-radius-sm)",
        }}
      >
        {icon}
      </div>
      {children}
    </div>
  );
}

function FormGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("mb-[18px]", className)}>{children}</div>;
}

function FormLabel({
  children,
  required,
  hint,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label
      className="mb-1.5 block text-[13px] font-semibold"
      style={{ color: "var(--go-text-primary)" }}
    >
      {children}
      {required && (
        <span className="ml-0.5" style={{ color: "#dc2626" }}>
          *
        </span>
      )}
      {hint && (
        <span
          className="mt-0.5 block text-[11px] font-normal"
          style={{ color: "#8b8b9a" }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function FormInput({
  error,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <>
      <input
        className={cn("go-input", error && "go-input-invalid", className)}
        {...props}
      />
      <FieldError message={error} />
    </>
  );
}

function FormSelect({
  error,
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <>
      <select className={cn("go-select", error && "go-input-invalid", className)} {...props}>
        {children}
      </select>
      <FieldError message={error} />
    </>
  );
}

function FormTextarea({
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <>
      <textarea
        className={cn("go-textarea", error && "go-input-invalid", className)}
        {...props}
      />
      <FieldError message={error} />
    </>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      className="mt-1 text-[11px] font-semibold"
      style={{
        color: "#dc2626",
        animation: "go-slide-down 0.2s ease",
      }}
    >
      {message}
    </p>
  );
}

function RadioGroup({
  name,
  options,
  value,
  onChange,
  error,
  vertical,
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
              vertical && "justify-start px-3.5 py-3",
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
   Chips Input (for participants)
   ══════════════════════════════════════════════ */

function ChipsInput({
  chips,
  onAdd,
  onRemove,
  error,
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
    if (onAdd(val)) {
      setInputValue("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (
      e.key === "Enter" ||
      e.key === " " ||
      e.key === "," ||
      e.key === ";" ||
      e.key === "Tab"
    ) {
      const val = inputValue.trim();
      if (val) {
        e.preventDefault();
        tryAdd(val);
      } else if (e.key === "Enter") {
        e.preventDefault();
      }
    } else if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
      onRemove(chips[chips.length - 1]);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (text && /[,;\s]/.test(text)) {
      e.preventDefault();
      const parts = text.split(/[,;\s]+/);
      parts.forEach((p) => {
        if (p.trim()) tryAdd(p);
      });
      setInputValue("");
    }
  }

  return (
    <>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1 rounded-lg px-2 py-1 transition-colors cursor-text",
          error && "!border-[#dc2626] shadow-[0_0_0_3px_rgba(220,38,38,0.08)]",
        )}
        style={{
          background: "var(--go-white)",
          border: "1.5px solid rgba(215, 219, 0, 0.35)",
        }}
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
            <span className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">
              {chip}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(chip);
              }}
              className="flex h-[15px] w-[15px] items-center justify-center rounded-full text-xs transition-colors"
              style={{
                background: "rgba(0,89,169,0.1)",
                border: "none",
                color: "inherit",
              }}
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
          onChange={(e) => {
            setInputValue(e.target.value);
            setTipMessage(null);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={() => {
            const val = inputValue.trim();
            if (val) tryAdd(val);
          }}
        />
      </div>
      {tipMessage && (
        <p
          className="mt-1 text-[11px] font-semibold"
          style={{
            color: "#dc2626",
            animation: "go-slide-down 0.2s ease",
          }}
        >
          {tipMessage}
        </p>
      )}
      <FieldError message={error} />
    </>
  );
}

/* ══════════════════════════════════════════════
   Summary components
   ══════════════════════════════════════════════ */

function SummaryRow({
  label,
  value,
  highlight,
  badge,
  last,
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
          <span className="font-bold" style={{ color: "#16a34a" }}>
            {value}
          </span>
        ) : (
          value || "\u2014"
        )}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════
   STEP 1: Quem Envia
   ══════════════════════════════════════════════ */

function Step1({
  form,
  errors,
  updateField,
  setError,
  clearError,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  setError: (key: string, msg: string) => void;
  clearError: (key: string) => void;
}) {
  const prodBlocked =
    form.prodStatus === "dev" || form.prodStatus === "idle";

  function addParticipant(email: string): boolean {
    const lower = email.toLowerCase();
    if (form.participantes.some((p) => p.toLowerCase() === lower))
      return false;
    updateField("participantes", [...form.participantes, email]);
    return true;
  }

  function removeParticipant(email: string) {
    updateField(
      "participantes",
      form.participantes.filter((p) => p !== email),
    );
  }

  return (
    <div>
      {/* Production Gate */}
      <div
        className="relative mb-6 rounded-xl p-4"
        style={{
          background: "rgba(199,233,253,0.3)",
          border: "1px solid rgba(0,89,169,0.08)",
        }}
      >
        <div
          className="mb-3.5 flex items-center gap-2 text-[13px] font-bold"
          style={{ color: "var(--go-text-heading)" }}
        >
          Este projeto já está em produção?
          <InfoTooltip>
            <strong className="mb-0.5 block text-white">
              Somente projetos em produção
            </strong>
            O projeto precisa estar{" "}
            <em
              className="not-italic font-bold"
              style={{ color: "var(--go-lime)" }}
            >
              ativo e sendo utilizado
            </em>{" "}
            no dia a dia, com engajamento real de usuários ou processos. Projetos
            em fase de ideia, desenvolvimento ou que nunca foram utilizados não
            devem ser submetidos.
          </InfoTooltip>
        </div>

        <RadioGroup
          name="prodStatus"
          value={form.prodStatus}
          onChange={(v) => updateField("prodStatus", v as FormData["prodStatus"])}
          error={errors.prodStatus}
          vertical
          options={[
            {
              value: "sim",
              label: "\uD83D\uDFE2 Sim, já está em produção e sendo utilizado",
            },
            {
              value: "dev",
              label: "\uD83D\uDD27 Não, ainda está sendo desenvolvido",
            },
            {
              value: "idle",
              label: "\u23F8\uFE0F Está pronto, mas ainda não é utilizado",
            },
          ]}
        />

        {/* Block message */}
        {prodBlocked && (
          <div
            className="mt-3.5 rounded-lg p-3.5"
            style={{
              background: "rgba(220,38,38,0.03)",
              border: "1px solid rgba(220,38,38,0.12)",
              animation: "go-slide-down 0.3s ease",
            }}
          >
            <div className="mb-1.5 text-xl">{"\uD83D\uDEAB"}</div>
            <div
              className="mb-1 text-[13px] font-bold"
              style={{ color: "#dc2626" }}
            >
              Submissão não permitida neste momento
            </div>
            <div
              className="text-xs leading-relaxed"
              style={{ color: "var(--go-text-primary)" }}
            >
              {form.prodStatus === "dev" ? (
                <>
                  Projetos{" "}
                  <strong style={{ color: "#dc2626" }}>
                    ainda em desenvolvimento
                  </strong>{" "}
                  não podem ser submetidos. Finalize a implementação, coloque em
                  produção com engajamento real e então submeta para avaliação.
                </>
              ) : (
                <>
                  Projetos prontos mas{" "}
                  <strong style={{ color: "#dc2626" }}>
                    sem utilização ativa
                  </strong>{" "}
                  não podem ser submetidos. É necessário que o projeto esteja
                  sendo usado no dia a dia, com engajamento real, antes da
                  submissão.
                </>
              )}
            </div>
          </div>
        )}

        {/* OK message */}
        {form.prodStatus === "sim" && (
          <div
            className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold"
            style={{
              background: "rgba(34,197,94,0.05)",
              border: "1px solid rgba(34,197,94,0.12)",
              color: "#16a34a",
              animation: "go-slide-down 0.25s ease",
            }}
          >
            {"\u2705"} Ótimo! Prossiga com o preenchimento abaixo.
          </div>
        )}
      </div>

      <SectionTitle icon={"\uD83D\uDC64"}>Dados do Responsável</SectionTitle>

      {/* Row: Nome + Email */}
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

      {/* Row: Area + Ferramenta */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormGroup>
          <FormLabel required>Área</FormLabel>
          <FormSelect
            value={form.area}
            onChange={(e) => updateField("area", e.currentTarget.value)}
            error={errors.area}
          >
            <option value="">Selecione sua área</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
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
            {FERRAMENTAS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </FormSelect>
          {/* Conditional: outra ferramenta */}
          {form.ferramenta === "Outros" && (
            <div
              className="mt-2.5"
              style={{ animation: "go-slide-down 0.25s ease" }}
            >
              <label
                className="mb-1 flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: "#8a7d00" }}
              >
                {"\u270F\uFE0F"} Especifique a ferramenta:
              </label>
              <FormInput
                placeholder="Nome da ferramenta..."
                value={form.ferramentaOutra}
                onChange={(e) =>
                  updateField("ferramentaOutra", e.currentTarget.value)
                }
                error={errors.ferramentaOutra}
                className="!border-[rgba(215,219,0,0.35)] focus:!border-[#b8a600] focus:!shadow-[0_0_0_3px_rgba(215,219,0,0.08)]"
              />
            </div>
          )}
        </FormGroup>
      </div>

      {/* Em equipe? */}
      <FormGroup>
        <FormLabel required>Projeto desenvolvido em equipe?</FormLabel>
        <RadioGroup
          name="emEquipe"
          value={form.emEquipe}
          onChange={(v) => updateField("emEquipe", v as FormData["emEquipe"])}
          error={errors.emEquipe}
          options={[
            { value: "sim", label: "\uD83D\uDC65 Sim, em equipe" },
            { value: "nao", label: "\uD83D\uDC64 Não, individual" },
          ]}
        />

        {/* Conditional: participantes */}
        {form.emEquipe === "sim" && (
          <div
            className="mt-2.5"
            style={{ animation: "go-slide-down 0.25s ease" }}
          >
            <label
              className="mb-1 flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: "#8a7d00" }}
            >
              {"\uD83D\uDC65"} E-mails dos participantes:
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
   STEP 2: O Projeto
   ══════════════════════════════════════════════ */

function Step2({
  form,
  errors,
  updateField,
  clearError,
  arquivo,
  setArquivo,
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
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // n8n name detection
  const n8nNameStatus = useMemo(() => {
    if (!isN8n || form.nomeProjeto.length < 3) return null;
    if (/^\[.+\]/.test(form.nomeProjeto)) return "ok";
    return "warn";
  }, [isN8n, form.nomeProjeto]);

  function handleFileSelect(file: File | null) {
    if (!file) return;
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_DOC_EXT.includes(ext)) {
      clearError("documentacao");
      // Show error inline
      setArquivo(null);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setArquivo(null);
      return;
    }
    setArquivo(file);
    clearError("documentacao");
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(GEMINI_DOC_LINK);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement("input");
      input.value = GEMINI_DOC_LINK;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div>
      <SectionTitle icon={"\uD83D\uDCCB"}>Dados do Projeto</SectionTitle>

      <FormGroup>
        <FormLabel
          required
          hint={
            isN8n
              ? "Copie e cole o nome do fluxo principal exatamente como aparece no n8n"
              : "Informe um nome descritivo para o projeto"
          }
        >
          {isN8n ? "Nome exato do Fluxo Principal do projeto" : "Nome do Projeto"}
        </FormLabel>
        <FormInput
          type="text"
          placeholder={
            isN8n
              ? "Ex: [CX] Envio de NPS Automático"
              : "Ex: Automação de Relatórios de Vendas"
          }
          value={form.nomeProjeto}
          onChange={(e) => updateField("nomeProjeto", e.currentTarget.value)}
          error={errors.nomeProjeto}
        />

        {/* n8n alert */}
        {isN8n && (
          <div
            className="mt-2 rounded-lg p-2.5"
            style={{
              background: "rgba(215,219,0,0.06)",
              border: "1px solid rgba(215,219,0,0.2)",
              animation: "go-slide-down 0.25s ease",
            }}
          >
            <div
              className="mb-1 flex items-center gap-1 text-[11px] font-bold"
              style={{ color: "#8a7d00" }}
            >
              {"\u26A0\uFE0F"} Atenção: nome deve ser idêntico ao do n8n
            </div>
            <div
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--go-text-primary)" }}
            >
              O nome informado aqui precisa ser{" "}
              <strong style={{ color: "#8a7d00" }}>copiado exatamente</strong>{" "}
              como aparece no n8n — incluindo maiúsculas, minúsculas, espaços e
              o prefixo entre colchetes.
              <ol
                className="mt-1 list-decimal pl-3.5 text-[10px]"
                style={{ color: "#8b8b9a" }}
              >
                <li>Abra o n8n e localize o fluxo principal do projeto</li>
                <li>Copie o nome que aparece no topo do editor</li>
                <li>Cole aqui sem modificar nada</li>
              </ol>
            </div>
          </div>
        )}

        {/* n8n name status badge */}
        {n8nNameStatus && (
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={
              n8nNameStatus === "ok"
                ? {
                    background: "rgba(34,197,94,0.06)",
                    color: "#16a34a",
                    border: "1px solid rgba(34,197,94,0.15)",
                  }
                : {
                    background: "rgba(215,219,0,0.06)",
                    color: "#8a7d00",
                    border: "1px solid rgba(215,219,0,0.2)",
                  }
            }
          >
            {n8nNameStatus === "ok"
              ? "\u2705 Prefixo detectado — parece um nome de fluxo n8n válido"
              : "\u26A0\uFE0F Nenhum prefixo detectado — verifique se copiou o nome correto do n8n"}
          </span>
        )}
      </FormGroup>

      <FormGroup>
        <FormLabel required hint="Quando o projeto foi desenvolvido">
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
        <FormLabel required>Descrição do Projeto</FormLabel>
        <FormTextarea
          rows={4}
          placeholder="Descreva brevemente o que o fluxo faz, qual problema resolve e os principais benefícios..."
          value={form.descricao}
          onChange={(e) => updateField("descricao", e.currentTarget.value)}
          error={errors.descricao}
        />
      </FormGroup>

      <FormGroup>
        <FormLabel required>Documentação do Projeto</FormLabel>

        {/* No JSON warning */}
        <div
          className="mb-2 flex items-start gap-2 rounded-lg p-2.5 text-[11px] leading-relaxed"
          style={{
            background: "rgba(220,38,38,0.03)",
            border: "1px solid rgba(220,38,38,0.12)",
            color: "#dc2626",
          }}
        >
          <span className="shrink-0 text-sm">{"\uD83D\uDEAB"}</span>
          <span>
            <strong style={{ color: "#b91c1c" }}>
              Não envie o JSON do fluxo.
            </strong>{" "}
            Este campo é para a{" "}
            <strong style={{ color: "#b91c1c" }}>documentação escrita</strong>{" "}
            explicando como o projeto funciona. Formatos aceitos: PDF, DOCX, DOC,
            TXT ou MD.
          </span>
        </div>

        {/* File upload area */}
        <div
          className={cn(
            "relative cursor-pointer rounded-xl p-6 text-center transition-colors",
            dragOver && "!border-[var(--go-blue)] !bg-[rgba(199,233,253,0.4)]",
            errors.documentacao && "!border-[#dc2626]",
          )}
          style={{
            border: "2px dashed rgba(0,89,169,0.25)",
            background: "rgba(199,233,253,0.15)",
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
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
          <div className="mb-2 text-[28px] opacity-60">{"\uD83D\uDCC4"}</div>
          <div
            className="text-xs"
            style={{ color: "var(--go-text-primary)" }}
          >
            <strong style={{ color: "var(--go-blue)" }}>
              Clique para selecionar
            </strong>{" "}
            ou arraste o arquivo
            <br />
            <small>PDF, DOCX, DOC, TXT, MD - max. {MAX_FILE_MB}MB</small>
          </div>
        </div>

        {/* File name display */}
        {arquivo && (
          <div
            className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{
              background: "rgba(0,89,169,0.04)",
              color: "var(--go-blue)",
            }}
          >
            {"\uD83D\uDCCE"} {arquivo.name}
          </div>
        )}

        <FieldError message={errors.documentacao} />

        {/* Doc helper - Gemini agent link */}
        <div
          className="mt-2.5 rounded-lg p-2.5"
          style={{
            background: "rgba(215,219,0,0.05)",
            border: "1px solid rgba(215,219,0,0.2)",
          }}
        >
          <div className="mb-2 flex items-start gap-2">
            <span className="shrink-0 text-sm">{"\uD83E\uDD16"}</span>
            <span
              className="text-[11px] leading-relaxed"
              style={{ color: "var(--go-text-primary)" }}
            >
              Ainda não tem? Use nosso{" "}
              <strong style={{ color: "var(--go-blue)" }}>
                Agente Construtor de Documentações
              </strong>{" "}
              para criar automaticamente!
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-lg px-2 py-2"
            style={{
              background: "rgba(0,89,169,0.03)",
              border: "1px solid rgba(0,89,169,0.1)",
            }}
          >
            <input
              type="text"
              readOnly
              value={GEMINI_DOC_LINK}
              className="min-w-0 flex-1 border-none bg-transparent text-[10px] font-mono outline-none"
              style={{ color: "var(--go-blue)" }}
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-transform"
              style={{
                background: copied
                  ? "rgba(34,197,94,0.12)"
                  : "var(--go-lime)",
                color: copied ? "#16a34a" : "var(--go-blue)",
                border: "none",
              }}
            >
              {copied ? "\u2705 Copiado!" : "\uD83D\uDCCB Copiar"}
            </button>
          </div>
          <div
            className="mt-1 text-center text-[10px]"
            style={{ color: "#8b8b9a" }}
          >
            Cole o link em uma nova aba do navegador
          </div>
        </div>
      </FormGroup>
    </div>
  );
}

/* ══════════════════════════════════════════════
   STEP 3: Impacto
   ══════════════════════════════════════════════ */

function Step3({
  form,
  errors,
  updateField,
  clearError,
  horas,
  reais,
  valorHora,
  ratioBlock,
  ratioWarn,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  horas: number;
  reais: number;
  valorHora: number;
  ratioBlock: boolean;
  ratioWarn: boolean;
}) {
  const [tableOpen, setTableOpen] = useState(false);

  return (
    <div>
      <SectionTitle icon={"\uD83D\uDCCA"}>Impacto e Mercado</SectionTitle>

      <FormGroup>
        <FormLabel required>
          Existe solução similar paga no mercado?
        </FormLabel>
        <RadioGroup
          name="checkMercado"
          value={form.checkMercado}
          onChange={(v) =>
            updateField("checkMercado", v as FormData["checkMercado"])
          }
          error={errors.checkMercado}
          options={[
            { value: "sim", label: "\u2705 Sim" },
            { value: "nao", label: "\u274C Não" },
          ]}
        />
      </FormGroup>

      <div
        className="my-5"
        style={{ height: "1.5px", background: "rgba(0,89,169,0.08)" }}
      />

      <div
        className="mb-2.5 text-xs font-bold uppercase tracking-[0.05em]"
        style={{ color: "var(--go-blue)" }}
      >
        Saving Mensal Estimado
      </div>

      {/* Saving cards grid */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {/* Hours card */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(199,233,253,0.25)",
            border: "1px solid rgba(0,89,169,0.08)",
          }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <div
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[17px]"
              style={{ background: "rgba(0,89,169,0.07)" }}
            >
              {"\u23F1\uFE0F"}
            </div>
            <div>
              <div
                className="text-xs font-bold"
                style={{ color: "var(--go-text-heading)" }}
              >
                Horas Economizadas
              </div>
              <div className="text-[10px]" style={{ color: "#8b8b9a" }}>
                Por mês
              </div>
            </div>
          </div>
          <FormInput
            type="number"
            step="0.01"
            min="0"
            placeholder="Ex: 40"
            value={form.savingHoras}
            onChange={(e) =>
              updateField("savingHoras", e.currentTarget.value)
            }
            error={errors.savingHoras}
          />
        </div>

        {/* Money card */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(199,233,253,0.25)",
            border: "1px solid rgba(0,89,169,0.08)",
          }}
        >
          <div className="mb-2.5 flex items-center gap-2">
            <div
              className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[17px]"
              style={{ background: "rgba(215,219,0,0.15)" }}
            >
              {"\uD83D\uDCB5"}
            </div>
            <div>
              <div
                className="text-xs font-bold"
                style={{ color: "var(--go-text-heading)" }}
              >
                Valor Economizado
              </div>
              <div className="text-[10px]" style={{ color: "#8b8b9a" }}>
                Em reais por mês
              </div>
            </div>
          </div>
          <div className="relative">
            <span
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold"
              style={{ color: "var(--go-blue)" }}
            >
              R$
            </span>
            <FormInput
              type="number"
              step="0.01"
              min="0"
              placeholder="Ex: 5000.00"
              value={form.savingReais}
              onChange={(e) =>
                updateField("savingReais", e.currentTarget.value)
              }
              error={errors.savingReais}
              className="!pl-10"
            />
          </div>
        </div>
      </div>

      {/* Ratio tip */}
      {(ratioBlock || ratioWarn) && (
        <div
          className="mt-3 rounded-lg p-3 text-[11px] font-semibold"
          style={{
            animation: "go-slide-down 0.2s ease",
            ...(ratioBlock
              ? {
                  background: "rgba(220,38,38,0.03)",
                  border: "1px solid rgba(220,38,38,0.12)",
                  color: "#dc2626",
                }
              : {
                  background: "rgba(215,219,0,0.06)",
                  border: "1px solid rgba(215,219,0,0.2)",
                  color: "#8a7d00",
                }),
          }}
        >
          <div className="mb-2 leading-relaxed">
            {ratioBlock
              ? `O valor por hora (R$/h) ficou abaixo de R$ 8,00. Confira se os valores informados estão corretos.`
              : `O valor por hora (R$/h) ficou acima de R$ 60,00 — confira se os valores estão proporcionais.`}
          </div>
          <button
            type="button"
            onClick={() => setTableOpen(!tableOpen)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold transition-colors"
            style={{
              background: "rgba(0,89,169,0.05)",
              border: "1px solid rgba(0,89,169,0.12)",
              color: "var(--go-blue)",
            }}
          >
            {tableOpen
              ? "\u2715 Fechar tabela"
              : "\uD83D\uDCCA Ver tabela de custo/hora por cargo"}
          </button>
          {tableOpen && (
            <div
              className="mt-2"
              style={{ animation: "go-slide-down 0.25s ease" }}
            >
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th
                      className="border-b-[1.5px] px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-[0.05em]"
                      style={{
                        color: "var(--go-blue)",
                        borderColor: "rgba(0,89,169,0.12)",
                      }}
                    >
                      Cargo
                    </th>
                    <th
                      className="border-b-[1.5px] px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-[0.05em]"
                      style={{
                        color: "var(--go-blue)",
                        borderColor: "rgba(0,89,169,0.12)",
                      }}
                    >
                      R$/hora + encargos
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CUSTO_HORA_TABLE.map((row) => (
                    <tr
                      key={row.cargo}
                      className="transition-colors hover:bg-[rgba(0,89,169,0.02)]"
                    >
                      <td
                        className="border-b px-2 py-1.5 font-semibold"
                        style={{
                          color: "var(--go-text-primary)",
                          borderColor: "rgba(0,89,169,0.04)",
                        }}
                      >
                        {row.cargo}
                      </td>
                      <td
                        className="border-b px-2 py-1.5 text-right font-bold font-mono"
                        style={{
                          color: "#16a34a",
                          borderColor: "rgba(0,89,169,0.04)",
                        }}
                      >
                        {row.valor}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                className="mt-1 text-center text-[9px]"
                style={{ color: "#8b8b9a" }}
              >
                Valores com encargos — use como referência para o cálculo do
                saving
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tipo saving */}
      <FormGroup className="!mt-5">
        <FormLabel required>
          Esse saving é de qual tipo?
          <InfoTooltip>
            <strong className="mb-0.5 block text-white">Mensal</strong>
            O saving acontece{" "}
            <em
              className="not-italic font-bold"
              style={{ color: "var(--go-lime)" }}
            >
              todo mês
            </em>
            , de forma recorrente. Ex: uma automação que economiza 40h/mês
            enquanto o fluxo estiver rodando.
            <br />
            <br />
            <strong className="mb-0.5 block text-white">Pontual</strong>
            O saving acontece{" "}
            <em
              className="not-italic font-bold"
              style={{ color: "var(--go-lime)" }}
            >
              uma única vez
            </em>{" "}
            e não se repete. Ex: uma automação criada para um projeto específico
            ou mutirão que terminou.
          </InfoTooltip>
        </FormLabel>
        <RadioGroup
          name="tipoSaving"
          value={form.tipoSaving}
          onChange={(v) =>
            updateField("tipoSaving", v as FormData["tipoSaving"])
          }
          error={errors.tipoSaving}
          options={[
            { value: "mensal", label: "\uD83D\uDD01 Mensal" },
            { value: "pontual", label: "\uD83D\uDCCD Pontual" },
          ]}
        />
      </FormGroup>
    </div>
  );
}

/* ══════════════════════════════════════════════
   STEP 4: Memorial + Summary
   ══════════════════════════════════════════════ */

function Step4({
  form,
  errors,
  updateField,
  clearError,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
}) {
  const ferramenta =
    form.ferramenta === "Outros" && form.ferramentaOutra.trim()
      ? `Outros: ${form.ferramentaOutra.trim()}`
      : form.ferramenta;

  return (
    <div>
      <SectionTitle icon={"\uD83E\uDDEE"}>Memorial de Cálculo</SectionTitle>

      <FormGroup>
        <FormLabel
          required
          hint="Detalhe como chegou ao número de horas/valor economizado"
        >
          Descreva o memorial de cálculo
        </FormLabel>
        <FormTextarea
          rows={6}
          placeholder="Explique detalhadamente como calculou o saving informado. Inclua: tempo gasto antes da automação, frequência da tarefa, número de pessoas envolvidas, etc."
          value={form.memorialCalculo}
          onChange={(e) =>
            updateField("memorialCalculo", e.currentTarget.value)
          }
          error={errors.memorialCalculo}
          className="!min-h-[150px]"
        />

        {/* Example box */}
        <div
          className="mt-2 rounded-lg p-3 text-[11px]"
          style={{
            background: "rgba(0,89,169,0.03)",
            border: "1px solid rgba(0,89,169,0.08)",
            color: "var(--go-text-primary)",
          }}
        >
          <strong
            className="mb-1 block"
            style={{ color: "var(--go-blue)" }}
          >
            {"\uD83D\uDCA1"} Exemplo de memorial:
          </strong>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Tarefa executada 4x por dia, 5 dias por semana</li>
            <li>Tempo médio por execução: 30 minutos</li>
            <li>Total mensal: 4 x 5 x 4 x 0,5h = 40 horas/mês</li>
            <li>Custo hora do colaborador: R$ 50,00</li>
            <li>Saving mensal: 40h x R$ 50 = R$ 2.000,00</li>
          </ul>
        </div>
      </FormGroup>

      {/* Summary card */}
      <div
        className="mt-6 rounded-xl p-4"
        style={{
          background: "var(--go-light-blue)",
          border: "1px solid rgba(0,89,169,0.1)",
        }}
      >
        <div
          className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em]"
          style={{ color: "var(--go-blue)" }}
        >
          Resumo da submissão
        </div>
        <SummaryRow label="Projeto" value={form.nomeProjeto || "\u2014"} />
        <SummaryRow label="Ferramenta" value={ferramenta || "\u2014"} />
        <SummaryRow label="Área" value={form.area || "\u2014"} />
        <SummaryRow
          label="Horas/mês"
          value={form.savingHoras ? `${form.savingHoras}h` : "\u2014"}
        />
        <SummaryRow
          label="Valor/mês"
          value={form.savingReais ? `R$ ${form.savingReais}` : "\u2014"}
        />
        <SummaryRow
          label="Tipo"
          value={
            form.tipoSaving === "mensal"
              ? "Mensal"
              : form.tipoSaving === "pontual"
                ? "Pontual"
                : "\u2014"
          }
          last
        />
      </div>
    </div>
  );
}
