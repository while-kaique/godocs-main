import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";

import {
  EMAIL_RE, ALLOWED_DOMAINS_RE, readFileAsBase64, TOKEN_BLOCK_CHARS,
} from "@/lib/submeter/constants";
import type { FormData, FieldErrors, ChatFase, ChatMessage, SavingFormData, AnaliseResult } from "@/lib/submeter/constants";
import { PageFrame, PageHeader, PageFooter, BrowserDots, WizardProgress, StepAnimation } from "@/lib/submeter/layout";
import { SummaryRow } from "@/lib/submeter/form-components";
import { Step1 } from "@/lib/submeter/step1";
import { Step2 } from "@/lib/submeter/step2";
import { Step3Chat, CyclingText } from "@/lib/submeter/step3-chat";
import { AnalyzerCard } from "@/lib/submeter/analyzer-overlay";

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

const emptyFormDraft = (): SavingFormData => ({
  linhas: [{ cargo: "", horasAntes: "", horasDepois: "" }],
  tinhaAntes: "",
  tipoSaving: "",
  custoExterno: "",
  custoPeriodicidade: "",
  valorReceita: "",
  racionalReceita: "",
});

// Snapshot dos metadados com que o agente está alinhado — usado para detectar
// edições feitas nas etapas anteriores depois que o agente já iniciou (item:
// adaptação a idas e vindas).
type AgentMeta = {
  nomeProjeto: string;
  area: string;
  ferramenta: string;
  participantes: string[];
  dataCriacao: string;
  descricaoBreve: string;
};

// Passos nomeados estimados por operação pesada (item: loading com etapa explícita).
const LOADING_STEPS_INICIAR = ["Lendo os arquivos…", "Analisando o código…", "Montando a documentação…"];
const LOADING_STEPS_COMPILAR = ["Compilando a documentação…", "Preparando a análise de impacto…"];
const LOADING_STEPS_REPROCESSAR = ["Relendo os arquivos…", "Reanalisando o projeto…", "Atualizando a documentação…"];

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
  // Tipo(s) com que o fluxo do agente está alinhado — usado para detectar troca
  // de tipo (saving ↔ receita) quando o usuário volta à etapa 2 no meio do fluxo.
  const [agentTipos, setAgentTipos] = useState<("saving" | "receita_incremental")[]>([]);
  // Metadados + assinatura dos arquivos com que o agente está alinhado (item:
  // propagar mudanças de metadado/arquivos ao agente).
  const [agentMeta, setAgentMeta] = useState<AgentMeta | null>(null);
  const [agentArquivosSig, setAgentArquivosSig] = useState<string>("");
  const [continuando, setContinuando] = useState(false);
  // Passos nomeados exibidos no chat durante operações pesadas (null = 3 pontinhos).
  const [chatLoadingSteps, setChatLoadingSteps] = useState<string[] | null>(null);
  const [iniciandoChat, setIniciandoChat] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [approvedDocPreview, setApprovedDocPreview] = useState<string | null>(null);
  const [approvedSavingPreview, setApprovedSavingPreview] = useState<string | null>(null);
  const [submittingProject, setSubmittingProject] = useState(false);
  const [showSavingForm, setShowSavingForm] = useState(false);
  const [savingFormLoading, setSavingFormLoading] = useState(false);
  const [approvedReceitaPreview, setApprovedReceitaPreview] = useState<string | null>(null);
  const [showReceitaForm, setShowReceitaForm] = useState(false);
  const [receitaFormLoading, setReceitaFormLoading] = useState(false);
  const [transitionType, setTransitionType] = useState<"saving" | "receita">("saving");
  // Rascunho do formulário de impacto (SavingForm) — vive no pai para persistir
  // quando o usuário navega para fora da etapa 3 e volta (o step 3 desmonta).
  const [formDraft, setFormDraft] = useState<SavingFormData>(emptyFormDraft);
  // Snapshots do que foi enviado em cada fase financeira (separados para o fluxo
  // "ambos": permite editar o saving mesmo já estando na receita). Reenvio idêntico
  // ao snapshot volta ao chat sem reanalisar. O de saving sobrevive à transição
  // saving→receita; o de receita reseta ao (re)entrar na fase de receita.
  const [savingSubmitted, setSavingSubmitted] = useState<SavingFormData | null>(null);
  const [receitaSubmitted, setReceitaSubmitted] = useState<SavingFormData | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnaliseResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Alerta ao tentar fechar/recarregar a página durante a análise
  useEffect(() => {
    if (!analyzing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [analyzing]);

  const today = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  }, []);

  const [form, setForm] = useState<FormData>({
    escopo: "",
    prodStatus: "",
    nome: "",
    email: "",
    area: "",
    ferramenta: "",
    ferramentaOutra: "",
    servicoExterno: "",
    emEquipe: "",
    participantes: [],
    nomeProjeto: "",
    dataCriacao: today,
    tipoProjeto: [],
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

  const prodBlocked = !form.escopo || form.prodStatus === "dev" || form.prodStatus === "idle";

  /* ── Metadados do agente: snapshot + detecção de mudança ── */
  const computeFerramenta = useCallback((): string => {
    return form.escopo === "externo"
      ? form.servicoExterno.trim()
      : form.ferramenta === "Outros" && form.ferramentaOutra.trim()
        ? `Outros: ${form.ferramentaOutra.trim()}`
        : form.ferramenta;
  }, [form.escopo, form.servicoExterno, form.ferramenta, form.ferramentaOutra]);

  const snapshotMeta = useCallback((): AgentMeta => ({
    nomeProjeto: form.nomeProjeto.trim(),
    area: form.area,
    ferramenta: computeFerramenta(),
    participantes: form.participantes,
    dataCriacao: form.dataCriacao,
    descricaoBreve: form.descricaoBreve.trim(),
  }), [form.nomeProjeto, form.area, form.participantes, form.dataCriacao, form.descricaoBreve, computeFerramenta]);

  // Assinatura dos arquivos (caminho + tamanho) — muda se o usuário troca os arquivos.
  const arquivosSig = useCallback((): string => {
    return arquivos
      .map((f) => `${f.webkitRelativePath || f.name}:${f.size}`)
      .sort()
      .join("|");
  }, [arquivos]);

  /* ── Validation ── */
  function validateStep(n: number): boolean {
    const errs: FieldErrors = {};

    if (n === 1) {
      if (!form.escopo)
        errs.escopo = "Selecione se a solução é interna ou externa";
      if (!form.prodStatus)
        errs.prodStatus = "Selecione o status do projeto";
      else if (form.prodStatus !== "sim")
        errs.prodStatus = form.escopo === "externo"
          ? "Apenas ferramentas externas já em uso podem ser submetidas"
          : "Apenas projetos em produção podem ser submetidos";
      if (!form.nome.trim() || form.nome.trim().length < 2)
        errs.nome = "Este campo é obrigatório";
      else if (/[0-9]/.test(form.nome))
        errs.nome = "O nome não pode conter números";
      if (!EMAIL_RE.test(form.email.trim()))
        errs.email = "Informe um e-mail válido";
      else if (!ALLOWED_DOMAINS_RE.test(form.email.trim()))
        errs.email = "Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos";
      if (!form.area) errs.area = "Selecione sua área";
      if (form.escopo === "externo") {
        if (!form.servicoExterno.trim())
          errs.servicoExterno = "Informe o nome do serviço externo";
      } else {
        if (!form.ferramenta) errs.ferramenta = "Selecione a ferramenta";
        if (form.ferramenta === "Outros" && !form.ferramentaOutra.trim())
          errs.ferramentaOutra = "Especifique a ferramenta utilizada";
      }
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
      if (form.tipoProjeto.length === 0)
        errs.tipoProjeto = "Selecione ao menos um tipo de projeto";
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
    // Todo step ALCANÇADO fica navegável pelos índices do topo — não só os que o
    // usuário "concluiu" avançando. Senão, ao entrar no step 2 e voltar ao 1, o
    // índice do 2 ficava bloqueado (só "Próximo" funcionava).
    setCompletedSteps((prev) => (prev.has(target) ? prev : new Set([...prev, target])));
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleBack() {
    if (step > 1) goToStep(step - 1, "back");
  }

  function handleStepClick(target: number) {
    if (!completedSteps.has(target) || target === step) return;
    // Ir para a etapa 3 com o agente já iniciado: usa o mesmo fluxo do botão
    // "Continuar com Agente" para detectar troca de tipo (saving ↔ receita) e
    // reajustar o agente — senão a navegação pelo topo pularia essa detecção.
    if (target === 3 && projetoId) {
      handleContinuarAgente();
      return;
    }
    goToStep(target, target < step ? "back" : "forward");
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

      const ferramentaEnviada = form.escopo === "externo"
        ? form.servicoExterno.trim()
        : form.ferramenta === "Outros" && form.ferramentaOutra.trim()
          ? `Outros: ${form.ferramentaOutra.trim()}`
          : form.ferramenta;

      const result = await apiFetch<{ projeto_id: string; response: ReturnType<typeof Object.create> }>(
        "/api/chat/iniciar-submissao",
        {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          area: form.area,
          ferramenta: ferramentaEnviada,
          escopo: form.escopo as "interno" | "externo",
          servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
          membros: form.participantes,
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          tipos_projeto: form.tipoProjeto.length > 0 ? form.tipoProjeto : undefined,
          tipo_projeto: form.tipoProjeto[0] || undefined,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          docs,
        },
      );

      setProjetoId(result.projeto_id);
      setAgentTipos(form.tipoProjeto);
      setAgentMeta(snapshotMeta());
      setAgentArquivosSig(arquivosSig());

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

      setCompletedSteps((prev) => new Set([...prev, 2, 3]));
      goToStep(3, "forward");
    } catch (err) {
      console.error('[submeter] iniciarAgente falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao iniciar análise: ${msg}`);
    } finally {
      setIniciandoChat(false);
    }
  }

  /* ── Reprocessa a documentação quando os ARQUIVOS mudam após o agente iniciar ── */
  async function reprocessarComNovosArquivos() {
    if (!projetoId || arquivos.length === 0) return;

    // Mesma trava de tokens do início.
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

    setContinuando(true);
    try {
      const docs = await Promise.all(
        arquivos.map(async (f) => ({ base64: await readFileAsBase64(f), filename: f.name })),
      );
      const meta = snapshotMeta();

      // Tipos podem ter mudado junto — persiste antes (a doc re-roteia o impacto).
      const tiposChanged =
        form.tipoProjeto.length !== agentTipos.length ||
        [...form.tipoProjeto].sort().join(",") !== [...agentTipos].sort().join(",");
      if (tiposChanged) {
        await apiFetch("/api/chat/atualizar-tipos", {
          projeto_id: projetoId,
          tipos_projeto: form.tipoProjeto,
        });
      }

      const result = await apiFetch<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
        "/api/chat/atualizar-metadados",
        {
          projeto_id: projetoId,
          nome_projeto: meta.nomeProjeto,
          area: meta.area,
          ferramenta: meta.ferramenta,
          membros: meta.participantes,
          data_criacao: meta.dataCriacao,
          descricao_breve: meta.descricaoBreve,
          docs,
        },
      );

      // A base mudou → reseta TODO o estado do chat para a fase de doc.
      setAgentMeta(meta);
      setAgentArquivosSig(arquivosSig());
      setAgentTipos(form.tipoProjeto);
      setShowTransition(false);
      setShowSavingForm(false);
      setShowReceitaForm(false);
      setApprovedDocPreview(null);
      setApprovedSavingPreview(null);
      setApprovedReceitaPreview(null);
      setChatComplete(false);
      setFormDraft(emptyFormDraft());
      setSavingSubmitted(null);
      setReceitaSubmitted(null);

      if (result.reset && result.response) {
        const msg: ChatMessage = {
          role: "assistant",
          content: result.response.content,
          options: result.response.options ?? undefined,
          isComplete: result.response.isComplete,
          isPreview: result.response.isPreview,
          fase: result.response.fase,
        };
        setChatMessages([msg]);
        setChatFase(result.response.fase ?? "doc");
        if (result.response.isComplete) setChatComplete(true);
      }

      toast.success("Arquivos atualizados — a documentação foi reprocessada.");
      goToStep(3, "forward");
    } catch (e) {
      console.error("[submeter] falha ao reprocessar arquivos:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao reprocessar os arquivos: ${msg}`);
    } finally {
      setContinuando(false);
    }
  }

  /* ── Step 2 → Step 3 (agente já iniciado): propaga mudanças e detecta troca de tipo ── */
  async function handleContinuarAgente() {
    // Não permite avançar sem ao menos um tipo selecionado.
    if (form.tipoProjeto.length === 0) {
      setError("tipoProjeto", "Selecione ao menos um tipo de projeto");
      toast.error("Selecione ao menos um tipo de projeto para continuar.");
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    // Arquivos trocados → reprocessa a doc do zero (cuida da navegação e retorna).
    if (projetoId && arquivosSig() !== agentArquivosSig) {
      await reprocessarComNovosArquivos();
      return;
    }

    // Metadados de texto mudaram → persiste; o agente lê frescos no próximo turno.
    if (projetoId && agentMeta) {
      const meta = snapshotMeta();
      const metaChanged = JSON.stringify(meta) !== JSON.stringify(agentMeta);
      if (metaChanged) {
        try {
          await apiFetch("/api/chat/atualizar-metadados", {
            projeto_id: projetoId,
            nome_projeto: meta.nomeProjeto,
            area: meta.area,
            ferramenta: meta.ferramenta,
            membros: meta.participantes,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
          });
          setAgentMeta(meta);
        } catch (e) {
          console.error("[submeter] falha ao atualizar metadados:", e);
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`Erro ao atualizar os dados do projeto: ${msg}`);
          return;
        }
      }
    }

    const changed =
      form.tipoProjeto.length !== agentTipos.length ||
      [...form.tipoProjeto].sort().join(",") !== [...agentTipos].sort().join(",");

    if (changed && projetoId) {
      try {
        await apiFetch("/api/chat/atualizar-tipos", {
          projeto_id: projetoId,
          tipos_projeto: form.tipoProjeto,
        });
        setAgentTipos(form.tipoProjeto);

        // Se a documentação (fase 1) já foi concluída, ajustamos a fase de impacto.
        // Em fase de doc, o próprio agente roteia ao aprovar a doc (lê tipos do banco).
        const docConcluida = chatFase !== "doc" && chatFase !== "doc_preview";
        if (docConcluida) {
          const querSaving = form.tipoProjeto.includes("saving");
          const querReceita = form.tipoProjeto.includes("receita_incremental");
          const savingDone = approvedSavingPreview !== null;
          const receitaDone = approvedReceitaPreview !== null;

          if (querSaving && querReceita && savingDone && !receitaDone) {
            // Caso comum: a pessoa concluiu o saving e só agora adicionou a receita.
            // PRESERVA o saving já feito e segue direto para a fase de receita —
            // antes, isso reiniciava o saving do zero (bug reportado).
            setChatMessages([]);
            setChatComplete(false);
            setFormDraft(emptyFormDraft());
            setReceitaSubmitted(null);
            setShowSavingForm(false);
            setShowReceitaForm(true);
            setChatFase("receita");
          } else {
            // Demais casos (troca de tipo, remoção, mudança no meio da fase) →
            // reinicia a fase de impacto a partir do saving (ou receita, se só receita).
            setChatMessages([]);
            setChatComplete(false);
            setApprovedSavingPreview(null);
            setApprovedReceitaPreview(null);
            setFormDraft(emptyFormDraft());
            setSavingSubmitted(null);
            setReceitaSubmitted(null);
            setShowSavingForm(querSaving);
            setShowReceitaForm(!querSaving);
            setChatFase(querSaving ? "saving" : "receita");
          }
        }
      } catch (e) {
        console.error("[submeter] falha ao atualizar tipos:", e);
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Erro ao atualizar o tipo de projeto: ${msg}`);
        return;
      }
    }

    goToStep(3, "forward");
  }

  /* ── Chat: enviar mensagem ── */
  async function handleSendMessage(content: string, selectedOption?: number) {
    if (!projetoId || chatLoading || chatComplete) return;

    const userMsg: ChatMessage = { role: "user", content };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    // Aprovar a doc dispara a compilação (operação pesada) — mostra passos nomeados
    // em vez do loading genérico. Turnos simples de conversa ficam com os 3 pontos.
    setChatLoadingSteps(chatFase === "doc_preview" ? LOADING_STEPS_COMPILAR : null);

    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    try {
      const result = await apiFetch<ReturnType<typeof Object.create>>(
        "/api/chat/enviar-mensagem",
        { projeto_id: projetoId, content, selected_option: selectedOption },
      );

      const newFase: ChatFase = result.fase ?? chatFase;
      const transitionToSaving = chatFase !== "saving" && newFase === "saving";
      const transitionToReceita = chatFase !== "receita" && newFase === "receita";

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

        setTransitionType("saving");
        setShowTransition(true);
        setChatFase(newFase);
        setTimeout(() => {
          setShowTransition(false);
          setChatMessages([]);
          setFormDraft(emptyFormDraft()); // fase nova → formulário em branco
          setSavingSubmitted(null);
          setReceitaSubmitted(null);
          setShowSavingForm(true);
        }, 3000);
      } else if (transitionToReceita) {
        const lastPreviewMsg = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        // Captura preview de saving se vier de saving_preview, ou doc se vier de doc_preview
        if (lastPreviewMsg) {
          if (chatFase === "saving_preview") setApprovedSavingPreview(lastPreviewMsg.content);
          else setApprovedDocPreview(lastPreviewMsg.content);
        }

        setTransitionType("receita");
        setShowTransition(true);
        setChatFase(newFase);
        setTimeout(() => {
          setShowTransition(false);
          setChatMessages([]);
          setFormDraft(emptyFormDraft()); // fase nova → formulário em branco
          setReceitaSubmitted(null); // saving (se houver) é preservado p/ edição posterior
          setShowReceitaForm(true);
        }, 3000);
      } else {
        setChatMessages((prev) => [...prev, assistantMsg]);
        setChatFase(newFase);
      }

      if (result.isComplete) {
        const lastPreviewMsg = chatMessages.slice().reverse().find(m => m.isPreview && m.role === "assistant");
        if (lastPreviewMsg) {
          // No caso "só saving" ou "ambos" (último preview é de receita ou saving)
          if (chatFase === "receita_preview") setApprovedReceitaPreview(lastPreviewMsg.content);
          else setApprovedSavingPreview(lastPreviewMsg.content);
        }
        setChatComplete(true);
      }
    } catch (err) {
      console.error('[submeter] enviarMensagem falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Erro ao enviar mensagem: ${msg}`);
      setChatMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatLoading(false);
      setChatLoadingSteps(null);
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }

  /* ── Saving form: envia dados determinísticos e inicia chat ── */
  async function handleSavingFormSubmit(formData: SavingFormData) {
    if (!projetoId) return;
    // Reabriu o formulário e reenviou sem mudar nada → não reanalisa, só volta ao
    // chat exatamente onde estava (as mensagens da fase continuam em memória). Vale
    // inclusive quando se edita o saving estando já na receita (fluxo "ambos").
    if (savingSubmitted && JSON.stringify(formData) === JSON.stringify(savingSubmitted)) {
      setShowSavingForm(false);
      return;
    }
    setSavingFormLoading(true);
    try {
      const custoMensal = formData.custoExterno
        ? formData.custoPeriodicidade === "anual"
          ? parseFloat(formData.custoExterno) / 12
          : parseFloat(formData.custoExterno)
        : undefined;

      const linhas = formData.linhas
        .filter((l) => l.cargo && l.horasAntes !== "" && l.horasDepois !== "")
        .map((l) => ({
          cargo: l.cargo,
          horas_antes: parseFloat(l.horasAntes),
          horas_depois: parseFloat(l.horasDepois),
        }));

      const result = await apiFetch<ReturnType<typeof Object.create>>(
        "/api/chat/iniciar-saving",
        {
          projeto_id: projetoId,
          tipo_saving: formData.tipoSaving as "mensal" | "pontual",
          linhas: linhas.length ? linhas : undefined,
          custo_externo_mensal: custoMensal,
        },
      );
      setShowSavingForm(false);
      // Registra o saving enviado (detecção de "nada mudou" e edição posterior).
      setSavingSubmitted(formData);
      // Preview de saving aprovado anteriormente deixa de valer ao reiniciar a fase.
      setApprovedSavingPreview(null);
      // O saving mudou → tudo a jusante (receita) é invalidado: o backend apaga a
      // conversa a partir do marcador de saving (inclui a receita), então resetamos
      // o estado da receita aqui também. A pessoa refaz a receita depois.
      setReceitaSubmitted(null);
      setApprovedReceitaPreview(null);
      setShowReceitaForm(false);
      setChatComplete(false);
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

  /* ── Receita form: inicia fase receita incremental ── */
  async function handleReceitaFormSubmit(formData: SavingFormData) {
    if (!projetoId) return;
    // Reenvio idêntico → volta ao chat existente sem reanalisar.
    if (receitaSubmitted && JSON.stringify(formData) === JSON.stringify(receitaSubmitted)) {
      setShowReceitaForm(false);
      return;
    }
    setReceitaFormLoading(true);
    try {
      const valorReceita = formData.valorReceita ? parseFloat(formData.valorReceita) : undefined;
      const result = await apiFetch<ReturnType<typeof Object.create>>(
        "/api/chat/iniciar-receita",
        {
          projeto_id: projetoId,
          tipo_saving: formData.tipoSaving as "mensal" | "pontual",
          valor_ganho_mensal: valorReceita,
          racional: formData.racionalReceita.trim() || undefined,
        },
      );
      setShowReceitaForm(false);
      // Registra a receita enviada (detecção de "nada mudou" e edição posterior).
      setReceitaSubmitted(formData);
      // Preview de receita aprovado anteriormente deixa de valer ao reiniciar a fase.
      setApprovedReceitaPreview(null);
      const receitaMsg: ChatMessage = {
        role: "assistant",
        content: result.content,
        options: result.options ?? undefined,
        isComplete: result.isComplete,
        isPreview: result.isPreview,
        fase: result.fase ?? "receita",
      };
      setChatMessages([receitaMsg]);
      if (result.fase) setChatFase(result.fase);
    } catch (e) {
      console.error("[submeter] falha ao iniciar receita:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Erro ao iniciar análise de receita: ${msg}`);
    } finally {
      setReceitaFormLoading(false);
    }
  }

  /* ── Voltar ao formulário determinístico para editar os dados ── */
  // A pessoa pode ter errado horas/cargo (saving) ou valor/racional (receita) e só
  // perceber dentro do chat. Reabrir o formulário recoloca o snapshot da fase para
  // edição. No fluxo "ambos" dá pra editar o saving mesmo já estando na receita —
  // por isso cada um recoloca o SEU snapshot (não o rascunho compartilhado).
  function openSavingForm() {
    if (chatLoading) return;
    setFormDraft(savingSubmitted ?? emptyFormDraft());
    setShowSavingForm(true);
  }
  function openReceitaForm() {
    if (chatLoading) return;
    setFormDraft(receitaSubmitted ?? emptyFormDraft());
    setShowReceitaForm(true);
  }

  const [analysisError, setAnalysisError] = useState<string | null>(null);

  /* ── Enviar projeto + disparar análise IA em paralelo ── */
  async function handleSubmitAndAnalyze() {
    if (!projetoId) return;
    setSubmittingProject(true);
    setAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisError(null);

    // 1) Submissão — a prioridade. Se falhar, não mostra tela de sucesso.
    try {
      await apiFetch("/api/chat/submeter-validacao", { projeto_id: projetoId });
    } catch (e) {
      console.error("[submeter] envio falhou:", e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Já existe um projeto submetido")) {
        toast.warning(msg, { duration: 8000 });
      } else {
        toast.error("Erro ao enviar projeto. Tente novamente.");
      }
      setSubmittingProject(false);
      setAnalyzing(false);
      return;
    }

    // 2) Submissão ok → mostra tela de sucesso imediatamente
    setSubmitted(true);
    setSubmittingProject(false);

    // 3) Análise IA em background — não bloqueia a tela de sucesso
    try {
      const result = await apiFetch<AnaliseResult>("/api/chat/analisar", { projeto_id: projetoId });
      setAnalysisResult(result);
    } catch (e) {
      console.error("[submeter] análise falhou:", e);
      setAnalysisError("Não foi possível gerar a análise automática. Isso não afeta o envio do seu projeto.");
    } finally {
      setAnalyzing(false);
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
              <SummaryRow
                label={form.escopo === "externo" ? "Serviço Externo" : "Ferramenta"}
                value={form.escopo === "externo" ? form.servicoExterno : form.ferramenta}
              />
              <SummaryRow label="Status" value="Aguardando análise" badge last />
            </div>

            {/* Card da análise IA (inline — loading ou resultado) */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#8b8b9a",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}
              >
                Análise automática
              </div>
              <AnalyzerCard
                loading={analyzing}
                result={analysisResult}
                error={analysisError}
              />
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="go-btn-primary"
                disabled={analyzing}
                style={analyzing ? { opacity: 0.4, cursor: "not-allowed", pointerEvents: "none" } : undefined}
              >
                {analyzing ? "Aguardando análise..." : "Submeter outro projeto"}
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
                  loadingSteps={chatLoadingSteps}
                  isComplete={chatComplete}
                  onSubmit={handleSubmitAndAnalyze}
                  submitting={submittingProject}
                  chatBottomRef={chatBottomRef}
                  fase={chatFase}
                  showTransition={showTransition}
                  transitionType={transitionType}
                  approvedDocPreview={approvedDocPreview}
                  approvedSavingPreview={approvedSavingPreview}
                  approvedReceitaPreview={approvedReceitaPreview}
                  tipoProjeto={form.tipoProjeto}
                  escopo={form.escopo}
                  showSavingForm={showSavingForm}
                  onSavingFormSubmit={handleSavingFormSubmit}
                  savingFormLoading={savingFormLoading}
                  showReceitaForm={showReceitaForm}
                  onReceitaFormSubmit={handleReceitaFormSubmit}
                  receitaFormLoading={receitaFormLoading}
                  formDraft={formDraft}
                  onFormDraftChange={setFormDraft}
                  onEditSaving={
                    chatFase === "saving" || chatFase === "saving_preview"
                      ? openSavingForm
                      : (chatFase === "receita" || chatFase === "receita_preview") &&
                          form.tipoProjeto.includes("saving") &&
                          savingSubmitted
                        ? openSavingForm
                        : undefined
                  }
                  onEditReceita={
                    chatFase === "receita" || chatFase === "receita_preview"
                      ? openReceitaForm
                      : undefined
                  }
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
                projetoId ? (
                  <button
                    type="button"
                    onClick={handleContinuarAgente}
                    disabled={continuando}
                    className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                  >
                    {continuando ? (
                      <>
                        <CyclingText steps={LOADING_STEPS_REPROCESSAR} />
                        <div className="go-spinner" />
                      </>
                    ) : (
                      <span>Continuar com Agente &rarr;</span>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleIniciarAgente}
                    disabled={iniciandoChat}
                    className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                  >
                    {iniciandoChat ? (
                      <>
                        <CyclingText steps={LOADING_STEPS_INICIAR} />
                        <div className="go-spinner" />
                      </>
                    ) : (
                      <span>Analisar com Agente &rarr;</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        <PageFooter />
      </div>

    </PageFrame>
  );
}
