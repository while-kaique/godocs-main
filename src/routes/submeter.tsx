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
import { Etapa25 } from "@/lib/submeter/step25";
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

function SubmeterPage() {
  return <SubmeterPageContent />;
}

/* ──────────────────────────────────────────────
   Page Component
   ────────────────────────────────────────────── */

const emptyFormDraft = (): SavingFormData => ({
  linhas: [{ cargo: "", horasAntes: "", horasDepois: "" }],
  alguemFazia: "",
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
  ferramenta: string;
  participantes: string[];
  dataCriacao: string;
  descricaoBreve: string;
  // Projeto especial: o contexto especial é entrada determinística da fase de doc.
  contextoEspecial: string;
};

// Passos nomeados estimados por operação pesada (item: loading com etapa explícita).
const LOADING_STEPS_INICIAR = ["Lendo os arquivos…", "Analisando o código…", "Montando a documentação…"];
const LOADING_STEPS_COMPILAR = ["Compilando a documentação…", "Preparando a análise de impacto…"];
const LOADING_STEPS_REPROCESSAR = ["Relendo os arquivos…", "Reanalisando o projeto…", "Atualizando a documentação…"];
const LOADING_STEPS_ENVIAR_ESPECIAL = ["Registrando o projeto…", "Enviando para validação…"];

export function SubmeterPageContent({ editProjetoId }: { editProjetoId?: string } = {}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [seedLoading, setSeedLoading] = useState(!!editProjetoId);
  const [nomesExistentes, setNomesExistentes] = useState<string[]>([]);
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
  // Projeto especial: envio direto (cria projeto + submete), pulando o agente.
  const [enviandoEspecial, setEnviandoEspecial] = useState(false);
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

  // Seed do estado quando em modo edição
  useEffect(() => {
    if (!editProjetoId) return;
    let cancelled = false;
    apiFetch(`/api/meus-projetos/${editProjetoId}`)
      .then((data: Record<string, unknown>) => {
        if (cancelled) return;
        const membros = (data.membros as string[]) ?? [];
        const tiposProjeto = ((data.tipos_projeto as string[]) ?? []).filter(
          (t): t is "saving" | "receita_incremental" =>
            t === "saving" || t === "receita_incremental"
        );
        const ferramentaRaw = (data.ferramenta as string) ?? "";
        let ferramenta = ferramentaRaw;
        let ferramentaOutra = "";
        if (ferramentaRaw.startsWith("Outros: ")) {
          ferramenta = "Outros";
          ferramentaOutra = ferramentaRaw.slice("Outros: ".length);
        }

        const newForm: FormData = {
          escopo: (data.escopo as string) ?? "interno",
          prodStatus: "sim",
          nome: (data.responsavel_nome as string) ?? "",
          email: (data.responsavel_email as string) ?? "",
          ferramenta,
          ferramentaOutra,
          servicoExterno: (data.servico_externo as string) ?? "",
          emEquipe: membros.length > 0 ? "sim" : "nao",
          participantes: membros,
          nomeProjeto: (data.nome_projeto as string) ?? "",
          dataCriacao: (data.data_criacao_projeto as string) ?? "",
          tipoProjeto: tiposProjeto,
          descricaoBreve: (data.descricao_breve as string) ?? "",
          especial: data.especial === true,
          contextoEspecial: (data.contexto_especial as string) ?? "",
        };

        setForm(newForm);
        setNomesExistentes((data.arquivos_nomes as string[]) ?? []);
        setProjetoId(editProjetoId);
        setAgentTipos(tiposProjeto);
        setRespEspecial(data.especial ? "sim" : "nao");

        // Seed de previews e snapshots financeiros a partir da documentação já salva
        const doc = data.documentacao as Record<string, unknown> | null;
        if (doc) {
          // Doc preview
          const conteudo = doc as Record<string, unknown>;
          const partes: string[] = [];
          if (conteudo.o_que_faz) partes.push(`**O que faz:** ${conteudo.o_que_faz}`);
          if (conteudo.execucao) partes.push(`**Execução:** ${conteudo.execucao}`);
          if (partes.length > 0) setApprovedDocPreview(partes.join("\n\n"));

          // Saving snapshot
          const saving = conteudo.saving as Record<string, unknown> | undefined;
          if (saving) {
            const linhasRaw = (saving.linhas as Array<Record<string, unknown>>) ?? [];
            const linhas = linhasRaw.map((l) => ({
              cargo: String(l.cargo ?? ""),
              horasAntes: String(l.horas_antes ?? ""),
              horasDepois: String(l.horas_depois ?? ""),
            }));
            const savingSnap: import("@/lib/submeter/constants").SavingFormData = {
              linhas: linhas.length > 0 ? linhas : [{ cargo: "", horasAntes: "", horasDepois: "" }],
              alguemFazia: (data.alguem_fazia as string) ?? "",
              tipoSaving: (data.tipo_saving as string) ?? "",
              custoExterno: String(data.custo_externo_mensal ?? ""),
              custoPeriodicidade: "mensal",
              valorReceita: "",
              racionalReceita: "",
            };
            setSavingSubmitted(savingSnap);
            setFormDraft(savingSnap);
            if (saving.memorial_calculo) setApprovedSavingPreview(String(saving.memorial_calculo));
          }

          // Receita snapshot
          const receita = conteudo.receita as Record<string, unknown> | undefined;
          if (receita) {
            const receitaSnap: import("@/lib/submeter/constants").SavingFormData = {
              linhas: [{ cargo: "", horasAntes: "", horasDepois: "" }],
              alguemFazia: "",
              tipoSaving: (receita.tipo_saving as string) ?? "mensal",
              custoExterno: "",
              custoPeriodicidade: "mensal",
              valorReceita: String(receita.valor_ganho_mensal ?? ""),
              racionalReceita: (receita.racional as string) ?? "",
            };
            setReceitaSubmitted(receitaSnap);
            if (receita.memorial_calculo) setApprovedReceitaPreview(String(receita.memorial_calculo));
          }
        }

        // Se o projeto já tem previews completos, não precisa rodar o agente novamente.
        // chatComplete = true faz o botão "Enviar" aparecer direto na etapa 3.
        // Quando o usuário altera algo, handleContinuarAgente reseta chatComplete.
        if (!data.especial && partes.length > 0) {
          const hasSavingType = tiposProjeto.includes("saving");
          const hasReceitaType = tiposProjeto.includes("receita_incremental");
          const savingOk = !hasSavingType || (saving && saving.memorial_calculo);
          const receitaOk = !hasReceitaType || (receita && receita.memorial_calculo);
          if (savingOk && receitaOk) setChatComplete(true);
        }

        // Snapshot do agentMeta para que o agente não reprocesse se nada mudou
        setAgentMeta({
          nomeProjeto: newForm.nomeProjeto.trim(),
          ferramenta: newForm.escopo === "externo"
            ? newForm.servicoExterno.trim()
            : newForm.ferramenta === "Outros" && newForm.ferramentaOutra.trim()
              ? `Outros: ${newForm.ferramentaOutra.trim()}`
              : newForm.ferramenta,
          participantes: newForm.participantes,
          dataCriacao: newForm.dataCriacao,
          descricaoBreve: newForm.descricaoBreve.trim(),
          contextoEspecial: newForm.contextoEspecial.trim(),
        });

        setStep(2);
        setCompletedSteps(new Set([1, 2, 3]));
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[editar] falha ao carregar projeto:", e);
        toast.error("Não foi possível carregar o projeto para edição.");
      })
      .finally(() => {
        if (!cancelled) setSeedLoading(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProjetoId]);

  const today = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  }, []);

  const [form, setForm] = useState<FormData>({
    escopo: "",
    prodStatus: "",
    nome: "",
    email: "",
    ferramenta: "",
    ferramentaOutra: "",
    servicoExterno: "",
    emEquipe: "",
    participantes: [],
    nomeProjeto: "",
    dataCriacao: today,
    tipoProjeto: [],
    descricaoBreve: "",
    especial: false,
    contextoEspecial: "",
  });

  // Etapa 2.5 (tipo de projeto): sub-tela entre a etapa 2 e o início do agente.
  // Só aparece na PRIMEIRA passagem (antes do agente iniciar). Em re-entradas
  // (projetoId já existe) o fluxo padrão de "Continuar com Agente" é mantido.
  const [showEtapa25, setShowEtapa25] = useState(false);
  const [respEspecial, setRespEspecial] = useState<"sim" | "nao" | "">("");

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
    ferramenta: computeFerramenta(),
    participantes: form.participantes,
    dataCriacao: form.dataCriacao,
    descricaoBreve: form.descricaoBreve.trim(),
    contextoEspecial: form.contextoEspecial.trim(),
  }), [form.nomeProjeto, form.participantes, form.dataCriacao, form.descricaoBreve, form.contextoEspecial, computeFerramenta]);

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
      // O tipo de projeto (saving/receita/especial) passou para a Etapa 2.5.
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
      if (arquivos.length === 0 && nomesExistentes.length === 0)
        errs.documentacao = "Selecione pelo menos um arquivo do projeto";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  /* ── Navigation ── */
  function goToStep(target: number, dir: "forward" | "back") {
    setDirection(dir);
    // Sair da etapa 2 (para 1 ou 3) fecha a sub-tela 2.5.
    if (target !== 2) setShowEtapa25(false);
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

  /* ── Step 2 → Etapa 2.5 (abre a sub-tela de tipo de projeto) ── */
  function handleAbrirEtapa25() {
    if (!validateStep(2)) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    // Re-entrada: reflete a resposta já dada (especial vs. saving/receita).
    if (respEspecial === "") {
      if (form.especial) setRespEspecial("sim");
      else if (form.tipoProjeto.length > 0) setRespEspecial("nao");
    }
    setShowEtapa25(true);
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Etapa 2.5: resposta sim/não ── */
  function handleRespEspecial(r: "sim" | "nao") {
    setRespEspecial(r);
    updateField("especial", r === "sim");
    // Limpa o campo da opção oposta para não enviar dado obsoleto.
    if (r === "sim") updateField("tipoProjeto", []);
    else updateField("contextoEspecial", "");
    clearError("especial");
    clearError("contextoEspecial");
    clearError("tipoProjeto");
  }

  /* ── Valida a Etapa 2.5 antes de iniciar o agente ── */
  function validateEtapa25(): boolean {
    if (respEspecial === "") {
      setError("especial", "Responda à pergunta acima para continuar");
      return false;
    }
    if (respEspecial === "sim") {
      if (!form.contextoEspecial.trim() || form.contextoEspecial.trim().length < 20) {
        setError("contextoEspecial", "Descreva o contexto do projeto em pelo menos 20 caracteres");
        return false;
      }
    } else if (form.tipoProjeto.length === 0) {
      setError("tipoProjeto", "Selecione ao menos um tipo de projeto");
      return false;
    }
    return true;
  }

  /* ── Step 2 → Step 3: inicia o agente ── */
  async function handleIniciarAgente() {
    if (!validateStep(2) || !validateEtapa25()) {
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
          ferramenta: ferramentaEnviada,
          escopo: form.escopo as "interno" | "externo",
          servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
          membros: form.participantes,
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          // Projeto especial não envia tipos financeiros — o backend grava
          // tipos_projeto=["especial"] e o fluxo pula saving/receita.
          tipos_projeto: !form.especial && form.tipoProjeto.length > 0 ? form.tipoProjeto : undefined,
          tipo_projeto: !form.especial ? (form.tipoProjeto[0] || undefined) : undefined,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          especial: form.especial || undefined,
          contexto_especial: form.especial ? form.contextoEspecial.trim() : undefined,
          docs,
        },
      );

      setProjetoId(result.projeto_id);
      setAgentTipos(form.especial ? [] : form.tipoProjeto);
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

  /* ── Projeto especial: cria o projeto e submete direto, pulando o agente ── */
  // Projeto de alto impacto e difícil mensuração não passa pela conversa nem pela
  // análise financeira: a documentação é montada no backend a partir da descrição +
  // contexto especial (sem IA) e segue direto para a base (planilha + banco). A
  // validação é humana.
  async function handleEnviarEspecial() {
    if (!validateStep(2) || !validateEtapa25()) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    if (arquivos.length === 0) return;

    setEnviandoEspecial(true);
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

      // 1) Cria o projeto (backend monta a doc sem IA e marca chat_completo).
      const result = await apiFetch<{ projeto_id: string; especial?: boolean }>(
        "/api/chat/iniciar-submissao",
        {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          ferramenta: ferramentaEnviada,
          escopo: form.escopo as "interno" | "externo",
          servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
          membros: form.participantes,
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          especial: true,
          contexto_especial: form.contextoEspecial.trim(),
          docs,
        },
      );

      setProjetoId(result.projeto_id);

      // 2) Submete direto para a base (planilha + banco). Análise IA não se aplica.
      await apiFetch("/api/chat/submeter-validacao", { projeto_id: result.projeto_id });

      setSubmitted(true);
    } catch (err) {
      console.error('[submeter] envio de projeto especial falhou:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Já existe um projeto submetido")) {
        toast.warning(msg, { duration: 8000 });
      } else {
        toast.error(`Erro ao enviar projeto: ${msg}`);
      }
    } finally {
      setEnviandoEspecial(false);
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
          ferramenta: meta.ferramenta,
          membros: meta.participantes,
          data_criacao: meta.dataCriacao,
          descricao_breve: meta.descricaoBreve,
          contexto_especial: meta.contextoEspecial,
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
    // Projeto especial não tem tipo financeiro — segue direto. Para projeto padrão,
    // não permite avançar sem ao menos um tipo selecionado.
    if (!form.especial && form.tipoProjeto.length === 0) {
      setError("tipoProjeto", "Selecione ao menos um tipo de projeto");
      toast.error("Selecione ao menos um tipo de projeto para continuar.");
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    // ── Projeto especial ──────────────────────────────────────────────────────
    // As entradas determinísticas da documentação são a descrição de negócio e o
    // contexto especial. Se algum deles (ou os arquivos) mudou, a documentação é
    // reavaliada do zero; se nada mudou, só voltamos ao chat (aceita, sem reanalisar)
    // — mesma lógica do "Editar Dados" do saving/receita.
    if (form.especial) {
      if (projetoId && arquivosSig() !== agentArquivosSig) {
        await reprocessarComNovosArquivos();
        return;
      }
      const meta = snapshotMeta();
      const metaChanged = !agentMeta || JSON.stringify(meta) !== JSON.stringify(agentMeta);
      if (projetoId && metaChanged) {
        setContinuando(true);
        try {
          const result = await apiFetch<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
            "/api/chat/atualizar-metadados",
            {
              projeto_id: projetoId,
              nome_projeto: meta.nomeProjeto,
              ferramenta: meta.ferramenta,
              membros: meta.participantes,
              data_criacao: meta.dataCriacao,
              descricao_breve: meta.descricaoBreve,
              contexto_especial: meta.contextoEspecial,
              reset_doc: true,
            },
          );
          setAgentMeta(meta);
          // A doc foi reavaliada → reseta o estado do chat para a nova fase de doc.
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
            setChatMessages([{
              role: "assistant",
              content: result.response.content,
              options: result.response.options ?? undefined,
              isComplete: result.response.isComplete,
              isPreview: result.response.isPreview,
              fase: result.response.fase,
            }]);
            setChatFase(result.response.fase ?? "doc");
            if (result.response.isComplete) setChatComplete(true);
          }
          toast.success("Documentação reavaliada com o novo contexto.");
        } catch (e) {
          console.error("[submeter] falha ao reavaliar projeto especial:", e);
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`Erro ao reavaliar a documentação: ${msg}`);
          setContinuando(false);
          return;
        } finally {
          setContinuando(false);
        }
      }
      goToStep(3, "forward");
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

    // Projeto especial não tem tipos financeiros — pula a sincronização de tipos
    // (enviar tipos_projeto=[] seria rejeitado pelo backend).
    if (!form.especial && changed && projetoId) {
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

    // Fallback de edição: se chegou aqui sem mensagens e sem estar completo,
    // o projeto tem documentação mas nenhum preview foi gerado (estado incompleto).
    // Reinicializa o agente a partir do texto já extraído no banco.
    if (editProjetoId && chatMessages.length === 0 && !chatComplete && projetoId) {
      setContinuando(true);
      try {
        const meta = snapshotMeta();
        const result = await apiFetch<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
          "/api/chat/atualizar-metadados",
          {
            projeto_id: projetoId,
            nome_projeto: meta.nomeProjeto,
            ferramenta: meta.ferramenta,
            membros: meta.participantes,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
            reset_doc: true,
          }
        );
        setAgentMeta(meta);
        if (result.reset && result.response) {
          setChatMessages([{
            role: "assistant",
            content: result.response.content,
            options: result.response.options ?? undefined,
            isComplete: result.response.isComplete,
            isPreview: result.response.isPreview,
            fase: result.response.fase,
          }]);
          setChatFase(result.response.fase ?? "doc");
          if (result.response.isComplete) setChatComplete(true);
        }
      } catch (e) {
        console.error("[submeter] falha ao inicializar agente (edit fallback):", e);
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Erro ao inicializar análise: ${msg}`);
      } finally {
        setContinuando(false);
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
          // Projeto especial encerra na fase de doc (sem saving/receita) → o preview
          // aprovado é o da documentação. Demais casos: receita ou saving.
          if (chatFase === "doc_preview") setApprovedDocPreview(lastPreviewMsg.content);
          else if (chatFase === "receita_preview") setApprovedReceitaPreview(lastPreviewMsg.content);
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
          alguem_fazia: formData.alguemFazia || undefined,
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
      await apiFetch("/api/chat/submeter-validacao", {
        projeto_id: projetoId,
        ...(editProjetoId ? { modo: "edicao" } : {}),
      });
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

    // Projeto especial é validado por um humano (não pelo analisador IA) — não
    // dispara a análise automática. O status fica "Pendente" até a avaliação humana.
    if (form.especial) {
      setAnalyzing(false);
      return;
    }

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

  /* ── Seed Loading Screen (modo edição) ── */
  if (seedLoading) {
    return (
      <PageFrame>
        <div className="relative z-[1] mx-auto flex w-full max-w-[540px] flex-col items-center justify-center py-24 text-center">
          <div
            className="mb-4 h-10 w-10 animate-spin rounded-full border-4"
            style={{ borderColor: "var(--go-blue)", borderTopColor: "transparent" }}
          />
          <p className="text-sm font-medium" style={{ color: "var(--go-text-heading)" }}>
            Carregando seu projeto…
          </p>
        </div>
      </PageFrame>
    );
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
              <SummaryRow
                label={form.escopo === "externo" ? "Serviço Externo" : "Ferramenta"}
                value={form.escopo === "externo" ? form.servicoExterno : form.ferramenta}
              />
              <SummaryRow label="Status" value={form.especial ? "Aguardando validação" : "Aguardando análise"} badge last />
            </div>

            {/* Card da análise IA (inline — loading ou resultado). Projeto especial
                não passa pela análise automática (validação é humana) → seção oculta. */}
            {!form.especial && (
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
            )}

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
            {step === 2 && !showEtapa25 && (
              <StepAnimation direction={direction}>
                <Step2
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  clearError={clearError}
                  arquivos={arquivos}
                  setArquivos={setArquivos}
                  nomesExistentes={nomesExistentes}
                />
              </StepAnimation>
            )}
            {step === 2 && showEtapa25 && (
              <StepAnimation direction={direction}>
                <Etapa25
                  form={form}
                  errors={errors}
                  updateField={updateField}
                  clearError={clearError}
                  resp={respEspecial}
                  onResp={handleRespEspecial}
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
                onClick={showEtapa25 ? () => setShowEtapa25(false) : handleBack}
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

              {/* Etapa 2 (formulário) → abre a sub-tela 2.5 (tipo de projeto).
                  Vale na primeira passagem e em re-entradas (permite trocar o tipo). */}
              {step === 2 && !showEtapa25 && (
                <button
                  type="button"
                  onClick={handleAbrirEtapa25}
                  className={cn("go-btn-next", shaking && "go-shake")}
                >
                  Próximo &rarr;
                </button>
              )}

              {/* Etapa 2.5 — projeto especial: pula o agente e envia direto à base. */}
              {step === 2 && showEtapa25 && respEspecial === "sim" && (
                <button
                  type="button"
                  onClick={handleEnviarEspecial}
                  disabled={enviandoEspecial}
                  className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                >
                  {enviandoEspecial ? (
                    <>
                      <CyclingText steps={LOADING_STEPS_ENVIAR_ESPECIAL} />
                      <div className="go-spinner" />
                    </>
                  ) : (
                    <span>Enviar Projeto &rarr;</span>
                  )}
                </button>
              )}

              {/* Etapa 2.5 (projeto padrão): inicia o agente (1ª vez) ou retoma (re-entrada). */}
              {step === 2 && showEtapa25 && respEspecial !== "sim" && (
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
