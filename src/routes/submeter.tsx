import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, AlertTriangle, Loader2, Save, FolderClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, ApiError } from "@/lib/api-client";

import {
  ALLOWED_DOMAINS_RE, filesToDocs, TOKEN_BLOCK_CHARS,
  parseMoedaBR, numeroParaMoedaBR,
} from "@/lib/submeter/constants";
import type { FormData, FieldErrors, ChatFase, ChatMessage, SavingFormData } from "@/lib/submeter/constants";
import { saveDraft, loadDraft, clearDraft, editDraftKey, type DraftSnapshot } from "@/lib/submeter/draft-storage";
import type { VersaoSnapshot } from "@/lib/meus-projetos.functions";

function hasLocalDraft(): boolean {
  return loadDraft() !== null;
}
import { PageFrame, PageHeader, PageFooter, BrowserDots, WizardProgress, StepAnimation } from "@/lib/submeter/layout";
import { SummaryRow } from "@/lib/submeter/form-components";
import { Step1 } from "@/lib/submeter/step1";
import { Step2 } from "@/lib/submeter/step2";
import { Etapa25 } from "@/lib/submeter/step25";
import { Step3Chat, CyclingText } from "@/lib/submeter/step3-chat";

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
  // ?retomar=<id> reabre um rascunho específico (botão "Continuar" de Meus Projetos).
  validateSearch: (search: Record<string, unknown>): { retomar?: string } => ({
    retomar: typeof search.retomar === "string" ? search.retomar : undefined,
  }),
  component: SubmeterPage,
});

function SubmeterPage() {
  const { retomar } = Route.useSearch();
  return <SubmeterPageContent resumeDraftId={retomar} />;
}

/* ──────────────────────────────────────────────
   Page Component
   ────────────────────────────────────────────── */

const emptyFormDraft = (): SavingFormData => ({
  linhas: [{ cargo: "", horasAntes: "", horasDepois: "" }],
  alguemFazia: "",
  eliminaGastoExterno: "",
  temContrafactualAdicional: "",
  temCustoEvitado: "",
  custoEvitadoItens: [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
  temCustoProjeto: "",
  custoProjetoItens: [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
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
  // Usa o AI Proxy interno? Entra no meta para que uma mudança dispare metaChanged.
  usaAiProxy: "sim" | "nao" | "";
  // Projeto especial: o contexto especial é entrada determinística da fase de doc.
  contextoEspecial: string;
};

// Números finais recalculados pelo servidor na submissão (retorno de submeter-validacao).
type GanhoFinal = {
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  receita_valor: number | null;
  receita_tipo: string | null;
  custo_externo_mensal: number | null;
  ganho_total_mensal: number | null;
};

// Comparativo numérico antes×depois exibido na tela de sucesso após uma edição.
// "antes" vem do snapshot da versão anterior; "depois" dos números recalculados
// pelo servidor nesta submissão. Só renderiza quando há versão anterior.
function GanhoComparison({
  anterior,
  atual,
}: {
  anterior: VersaoSnapshot;
  atual: GanhoFinal;
}) {
  const sp = anterior.snapshot_projeto;
  const fmtHoras = (n: number | null | undefined, tipo: string | null | undefined) =>
    n != null ? `${n}h${tipo === "pontual" ? " (total)" : "/mês"}` : "—";

  const linhas: { label: string; antes: string; depois: string; mudou: boolean }[] = [];
  const push = (label: string, a: number | null | undefined, d: number | null | undefined, fmt: (v: number | null | undefined) => string) => {
    if (a == null && d == null) return;
    linhas.push({ label, antes: fmt(a), depois: fmt(d), mudou: (a ?? null) !== (d ?? null) });
  };
  // SOMENTE horas — o usuário NÃO pode ver valores financeiros de saving (R$, custo
  // externo, ganho total). Isso é visível só para a equipe que analisa as submissões.
  push("Economia (horas)", sp?.saving_horas, atual.saving_horas, (v) => fmtHoras(v, atual.tipo_saving ?? sp?.tipo_saving));

  if (linhas.length === 0) return null;

  const dataFmt = anterior.created_at
    ? new Date(anterior.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <div
      className="mb-7 text-left overflow-hidden"
      style={{
        border: "1px solid rgba(0,89,169,0.12)",
        borderRadius: "var(--go-radius-md)",
      }}
    >
      <div
        className="px-4 py-2.5 text-[11px] font-bold"
        style={{ color: "var(--go-blue)", background: "rgba(0,89,169,0.04)" }}
      >
        Comparativo com a versão anterior
        {dataFmt && (
          <span className="font-normal" style={{ color: "#8b8b9a" }}>
            {" "}· v{anterior.versao_num} de {dataFmt}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1.2fr_1fr_1fr]" style={{ borderTop: "1px solid rgba(0,89,169,0.08)" }}>
        <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: "#9b9bab" }} />
        <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: "#9b4040" }}>Antes</div>
        <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: "#166534" }}>Agora</div>
      </div>
      {linhas.map((l) => (
        <div
          key={l.label}
          className="grid grid-cols-[1.2fr_1fr_1fr] items-center"
          style={{ borderTop: "1px solid rgba(0,89,169,0.06)", background: l.mudou ? "rgba(22,163,74,0.04)" : undefined }}
        >
          <div className="px-3 py-2 text-[11px] font-medium" style={{ color: "#555" }}>{l.label}</div>
          <div className="px-3 py-2 text-[11px]" style={{ color: "#888" }}>{l.antes}</div>
          <div className="px-3 py-2 text-[11px] font-semibold" style={{ color: l.mudou ? "#166534" : "#555" }}>{l.depois}</div>
        </div>
      ))}
    </div>
  );
}

// Passos nomeados estimados por operação pesada (item: loading com etapa explícita).
const LOADING_STEPS_INICIAR = ["Lendo os arquivos…", "Analisando o código…", "Montando a documentação…"];
const LOADING_STEPS_COMPILAR = ["Compilando a documentação…", "Preparando a análise de impacto…"];
const LOADING_STEPS_REPROCESSAR = ["Relendo os arquivos…", "Reanalisando o projeto…", "Atualizando a documentação…"];
const LOADING_STEPS_ENVIAR_ESPECIAL = ["Registrando o projeto…", "Enviando para validação…"];
// Edição reprocessa o documento e REGERA a documentação via IA antes de reenviar —
// passos fiéis a esse trabalho (lento) para o usuário não achar que travou.
const LOADING_STEPS_EDITAR = [
  "Relendo o documento…",
  "Regerando a documentação (IA)…",
  "Enviando para validação…",
];

// Retry de operação idempotente do backend. `atualizar-metadados` é NÃO-DESTRUTIVO
// (regenera a doc só no fim), então retentar é seguro — cobre o timeout/cancelamento
// intermitente que derrubava edições de LEGADO (a regeneração via LLM às vezes é cortada
// pelo edge; nenhum legado tem doc prévia, então depende da regeneração dar certo). Só
// retenta transitórios (rede/timeout/5xx); erro de regra (4xx) sobe na hora.
async function apiFetchComRetry<T>(path: string, body?: unknown, tentativas = 3): Promise<T> {
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await apiFetch<T>(path, body);
    } catch (e) {
      ultimoErro = e;
      const status = e instanceof ApiError ? e.status : 0;
      const transitorio = status === 0 || status >= 500;
      if (i < tentativas - 1 && transitorio) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw ultimoErro;
}

// Popup de confirmação do "Recomeçar" (overlay embaçado + Esc, mesmo padrão do
// DistribuirEdicaoModal). Ação DESTRUTIVA: lista concretamente o que será perdido
// e exige confirmação antes de zerar o formulário. Estado sinalizado por ícone +
// rótulo (nunca só por cor). Só usado em submissão NOVA (nunca em edição).
function ConfirmarRecomecoModal({
  onClose,
  onConfirmar,
  processando,
}: {
  onClose: () => void;
  onConfirmar: () => void;
  processando: boolean;
}) {
  // Fecha no Esc (bloqueado enquanto processa, para não deixar meio-caminho).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !processando) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, processando]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(8,20,40,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={() => !processando && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Recomeçar o formulário"
    >
      <div
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--go-white)", boxShadow: "0 24px 64px rgba(8,20,40,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(217,119,6,0.12)", color: "#b45309" }}
          >
            <AlertTriangle style={{ width: 18, height: 18 }} />
          </span>
          <div className="min-w-0">
            <h2 className="font-extrabold leading-tight" style={{ color: "var(--go-text-heading)", fontSize: 16 }}>
              Recomeçar o formulário?
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "#8b8b9a" }}>
              Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-[12.5px] leading-snug" style={{ color: "#6b6b7a" }}>
            Você vai <span className="font-semibold">perder tudo o que preencheu até aqui</span> e voltar
            para o início. Isso inclui:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "As respostas das etapas e os arquivos anexados",
              "Toda a conversa com o agente e a documentação gerada",
              "Os valores de saving e receita informados",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug" style={{ color: "#5b5b6a" }}>
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "#b45309" }}
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] leading-snug" style={{ color: "#6b6b7a" }}>
            Você terá que preencher tudo de novo.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={processando}
            className="rounded-full px-4 py-2 text-[12px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-offset-2 disabled:opacity-50"
            style={{ background: "transparent", color: "#8b8b9a", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={processando}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b91c1c] focus-visible:ring-offset-2 disabled:opacity-60"
            style={{ background: "#b91c1c" }}
          >
            {processando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {processando ? "Recomeçando…" : "Sim, recomeçar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Popup do "Salvar rascunho": ação NÃO destrutiva (guarda o projeto e sai). Informa
// os cuidados — principalmente que rascunho NÃO vai para análise — e onde retomar.
// Mesmo padrão de overlay + Esc; tom informativo (azul), não de alerta.
function SalvarRascunhoModal({
  onClose,
  onConfirmar,
  processando,
}: {
  onClose: () => void;
  onConfirmar: () => void;
  processando: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !processando) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, processando]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(8,20,40,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={() => !processando && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Salvar como rascunho"
    >
      <div
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--go-white)", boxShadow: "0 24px 64px rgba(8,20,40,0.35)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-6">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
          >
            <FolderClock style={{ width: 18, height: 18 }} />
          </span>
          <div className="min-w-0">
            <h2 className="font-extrabold leading-tight" style={{ color: "var(--go-text-heading)", fontSize: 16 }}>
              Salvar como rascunho?
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "#8b8b9a" }}>
              Guardamos este projeto e você começa outro.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-[12.5px] leading-snug" style={{ color: "#6b6b7a" }}>
            Este projeto fica salvo em <span className="font-semibold">Meus Projetos › Rascunhos</span> —
            você pode voltar e continuar de onde parou quando quiser. Antes de sair, vale saber:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "O rascunho ainda NÃO foi enviado para análise — a equipe de RPA & IA só vê o projeto depois que você concluir e clicar em enviar.",
              "Ao sair, você volta para a tela inicial e pode começar uma nova submissão.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug" style={{ color: "#5b5b6a" }}>
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--go-blue)" }}
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-6 py-4" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={processando}
            className="rounded-full px-4 py-2 text-[12px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-offset-2 disabled:opacity-50"
            style={{ background: "transparent", color: "#8b8b9a", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={processando}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-offset-2 disabled:opacity-60"
            style={{ background: "var(--go-blue)" }}
          >
            {processando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {processando ? "Salvando…" : "Salvar e sair"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SubmeterPageContent({
  editProjetoId,
  resumeDraftId,
}: { editProjetoId?: string; resumeDraftId?: string } = {}) {
  const navigate = useNavigate();
  // Invalida o cache de "Meus Projetos" (staleTime 60s) após submeter/reenviar, para
  // a lista refletir o novo estado real (ex.: legado regularizado deixa de mostrar o
  // aviso de pendência) sem exigir hard-refresh do usuário.
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  // Carrega tela de "preparando" enquanto seedamos: edição (servidor) OU
  // retomada de rascunho (localStorage ou ?retomar).
  const [seedLoading, setSeedLoading] = useState(
    !!editProjetoId || !!resumeDraftId || hasLocalDraft(),
  );
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
  // Snapshot da versão anterior — capturado uma vez no seed, nunca sobrescrito.
  // Usado na tela de comparação antes/depois do FinalReview.
  const [versaoAnterior, setVersaoAnterior] = useState<VersaoSnapshot | null>(null);
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
  // Números finais recalculados pelo servidor na submissão — usados no comparativo
  // numérico antes×depois da tela de sucesso (somente edição, quando há versão anterior).
  const [ganhoFinal, setGanhoFinal] = useState<GanhoFinal | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  // "Recomeçar": confirmação + estado de processamento do reset (só submissão nova).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [recomecando, setRecomecando] = useState(false);
  // "Salvar rascunho": confirmação + estado (só quando já existe rascunho no servidor).
  const [showRascunhoConfirm, setShowRascunhoConfirm] = useState(false);
  const [salvandoRascunho, setSalvandoRascunho] = useState(false);

  // Aplica no estado do wizard os dados de um projeto vindos do servidor —
  // usado tanto na EDIÇÃO de um projeto submetido quanto na RETOMADA de um
  // rascunho (cross-device, quando não há snapshot local). `id` é o projeto a
  // seedar. A semântica de "edição" (modo:'edicao', bloqueio da etapa 1) é
  // gateada por `editProjetoId` em outros pontos — aqui o seed é idêntico.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const applySeed = useCallback((data: Record<string, unknown>, id: string) => {
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
          usaAiProxy: ((data.usa_ai_proxy as string) ?? "") as FormData["usaAiProxy"],
          especial: data.especial === true,
          contextoEspecial: (data.contexto_especial as string) ?? "",
        };

        setForm(newForm);
        setNomesExistentes((data.arquivos_nomes as string[]) ?? []);
        setProjetoId(id);
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
            // Custo evitado: repopula a partir da coluna do projeto (JSON salvo na
            // submissão). Mantém a edição fiel ao que foi enviado.
            let custoEvitadoItens: import("@/lib/submeter/constants").CustoEvitadoItemInput[] = [];
            try {
              const raw = data.custo_evitado_itens;
              const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
              if (Array.isArray(arr)) {
                custoEvitadoItens = arr.map((it: Record<string, unknown>) => ({
                  nome: String(it.nome ?? ""),
                  // valor é salvo como número no JSON → reexibe com máscara BR.
                  valor: it.valor != null && it.valor !== "" ? numeroParaMoedaBR(Number(it.valor)) : "",
                  recorrencia: (it.recorrencia as "mensal" | "pontual" | "") ?? "",
                  justificativa: String(it.justificativa ?? ""),
                }));
              }
            } catch {
              custoEvitadoItens = [];
            }
            // Custos do projeto: mesma repopulação (JSON salvo na submissão).
            let custoProjetoItens: import("@/lib/submeter/constants").CustoEvitadoItemInput[] = [];
            try {
              const raw = data.custo_projeto_itens;
              const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
              if (Array.isArray(arr)) {
                custoProjetoItens = arr.map((it: Record<string, unknown>) => ({
                  nome: String(it.nome ?? ""),
                  valor: it.valor != null && it.valor !== "" ? numeroParaMoedaBR(Number(it.valor)) : "",
                  recorrencia: (it.recorrencia as "mensal" | "pontual" | "") ?? "",
                  justificativa: String(it.justificativa ?? ""),
                }));
              }
            } catch {
              custoProjetoItens = [];
            }
            // Reconstrói a árvore do form a partir do alguem_fazia persistido:
            // 'externo' = custo evitado puro (Não → elimina Sim → sem adicional);
            // 'nao' + custo evitado = contrafactual + custo evitado (elimina Sim → adicional Sim);
            // 'nao' sem custo evitado = contrafactual puro (elimina Não); 'sim' = horas reais.
            const afRaw = (data.alguem_fazia as string) ?? "";
            const custoEvitadoFlag = (data.custo_evitado as "sim" | "nao" | "") ?? "";
            let alguemFaziaSnap: "sim" | "nao" | "" = "";
            let eliminaGastoExternoSnap: "sim" | "nao" | "" = "";
            let temContrafactualAdicionalSnap: "sim" | "nao" | "" = "";
            let temCustoEvitadoSnap: "sim" | "nao" | "" = "";
            if (afRaw === "externo") {
              alguemFaziaSnap = "nao";
              eliminaGastoExternoSnap = "sim";
              temContrafactualAdicionalSnap = "nao";
            } else if (afRaw === "nao") {
              alguemFaziaSnap = "nao";
              if (custoEvitadoFlag === "sim") {
                eliminaGastoExternoSnap = "sim";
                temContrafactualAdicionalSnap = linhas.length > 0 ? "sim" : "nao";
              } else {
                eliminaGastoExternoSnap = "nao";
              }
            } else if (afRaw === "sim") {
              alguemFaziaSnap = "sim";
              temCustoEvitadoSnap = custoEvitadoFlag;
            }
            const savingSnap: import("@/lib/submeter/constants").SavingFormData = {
              linhas: linhas.length > 0 ? linhas : [{ cargo: "", horasAntes: "", horasDepois: "" }],
              alguemFazia: alguemFaziaSnap,
              eliminaGastoExterno: eliminaGastoExternoSnap,
              temContrafactualAdicional: temContrafactualAdicionalSnap,
              temCustoEvitado: temCustoEvitadoSnap,
              custoEvitadoItens: custoEvitadoItens.length > 0
                ? custoEvitadoItens
                : [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
              temCustoProjeto: (data.custo_projeto as "sim" | "nao" | "") ?? "",
              custoProjetoItens: custoProjetoItens.length > 0
                ? custoProjetoItens
                : [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
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
              eliminaGastoExterno: "",
              temContrafactualAdicional: "",
              temCustoEvitado: "",
              custoEvitadoItens: [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
              temCustoProjeto: "",
              custoProjetoItens: [{ nome: "", valor: "", recorrencia: "", justificativa: "" }],
              tipoSaving: (receita.tipo_saving as string) ?? "mensal",
              custoExterno: "",
              custoPeriodicidade: "mensal",
              valorReceita: String(receita.valor_ganho_mensal ?? ""),
              racionalReceita: (receita.racional as string) ?? "",
            };
            setReceitaSubmitted(receitaSnap);
            if (receita.memorial_calculo) setApprovedReceitaPreview(String(receita.memorial_calculo));
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
        }

        // Snapshot congelado da última versão submetida — para a tela de comparação.
        const ultimaVersao = data.ultima_versao as VersaoSnapshot | null;
        if (ultimaVersao) setVersaoAnterior(ultimaVersao);

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
          usaAiProxy: newForm.usaAiProxy,
          contextoEspecial: newForm.contextoEspecial.trim(),
        });

        setStep(2);
        // Etapa 3 ainda não foi percorrida nesta sessão — não marcar como concluída.
        setCompletedSteps(new Set([1, 2]));
  }, []);

  // Repõe o estado do wizard a partir do snapshot local (mesmo navegador) —
  // retomada fiel de um rascunho ao atualizar/voltar à página, sem ida ao servidor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rehydrateFromLocal = useCallback((d: DraftSnapshot) => {
    setForm(d.form);
    setNomesExistentes(d.nomesExistentes ?? []);
    setProjetoId(d.projetoId);
    setCompletedSteps(new Set(d.completedSteps ?? [1, 2]));
    setChatMessages(d.chatMessages ?? []);
    setChatFase(d.chatFase ?? "doc");
    setChatComplete(!!d.chatComplete);
    setAgentTipos(d.agentTipos ?? []);
    setAgentMeta((d.agentMeta as AgentMeta | null) ?? null);
    setAgentArquivosSig(d.agentArquivosSig ?? "");
    setApprovedDocPreview(d.approvedDocPreview ?? null);
    setApprovedSavingPreview(d.approvedSavingPreview ?? null);
    setApprovedReceitaPreview(d.approvedReceitaPreview ?? null);
    setSavingSubmitted(d.savingSubmitted ?? null);
    setReceitaSubmitted(d.receitaSubmitted ?? null);
    if (d.formDraft) setFormDraft(d.formDraft);
    setRespEspecial(d.respEspecial ?? "");
    // Sub-tela ativa da etapa 3 (no mesmo batch do formDraft p/ o SavingForm montar
    // já com o draft certo). Em fase de IMPACTO em coleta ("saving"/"receita"):
    //  • dados determinísticos INALTERADOS (formDraft == *Submitted) e conversa num
    //    ponto retomável (última msg do agente) → PRESERVA o chat; nada a reprocessar
    //    e a pessoa não perde a conversa.
    //  • saving/receita ALTERADO (precisa reprocessar) OU conversa parada no meio de
    //    uma requisição (última msg é do usuário, sem resposta) → volta ao FORMULÁRIO.
    // Previews/doc/submissão completa mantêm a sub-tela que estava salva.
    const faseRetomada = d.chatFase ?? "doc";
    const msgs = d.chatMessages ?? [];
    const ultimaMsg = msgs[msgs.length - 1];
    const conversaRetomavel = !!ultimaMsg && ultimaMsg.role === "assistant";
    const inalterado = (snap: SavingFormData | null) =>
      snap != null && JSON.stringify(snap) === JSON.stringify(d.formDraft);
    if (faseRetomada === "saving") {
      const preservaChat = conversaRetomavel && inalterado(d.savingSubmitted);
      setShowSavingForm(!preservaChat);
      setShowReceitaForm(false);
    } else if (faseRetomada === "receita") {
      const preservaChat = conversaRetomavel && inalterado(d.receitaSubmitted);
      setShowReceitaForm(!preservaChat);
      setShowSavingForm(false);
    } else {
      setShowSavingForm(!!d.showSavingForm);
      setShowReceitaForm(!!d.showReceitaForm);
    }
    setStep(d.step ?? 3);
  }, []);

  // Mount: decide entre EDIÇÃO, RETOMADA de rascunho (local ou cross-device) ou
  // submissão nova (fresh). Roda uma única vez.
  useEffect(() => {
    // Sem guarda de "já seedou": sob StrictMode (dev) o efeito monta → desmonta →
    // remonta. Um ref persistente faria a 2ª montagem (a final) sair cedo, deixando
    // o seedLoading preso em true (o fetch da 1ª já vem com cancelled=true). O flag
    // `cancelled` abaixo já descarta com segurança o resultado da montagem efêmera.
    let cancelled = false;

    // Rede de segurança: o seed NUNCA pode prender a tela "Carregando seu
    // projeto…". Se algo travar (fetch pendurado, rascunho problemático), libera
    // o formulário em branco e descarta o rascunho que estava sendo retomado.
    const safety = setTimeout(() => {
      if (cancelled) return;
      console.warn("[seed] timeout ao carregar — liberando formulário e descartando rascunho local");
      clearDraft();
      setSeedLoading(false);
    }, 8000);
    const finishSeed = () => {
      clearTimeout(safety);
      if (!cancelled) setSeedLoading(false);
    };

    // ── Modo edição: seed do servidor ──
    if (editProjetoId) {
      // Rascunho de edição salvo (reload no meio da conversa)? Restaura o estado exato.
      const editDraft = loadDraft(editDraftKey(editProjetoId));
      apiFetch<Record<string, unknown>>(`/api/meus-projetos/${editProjetoId}`)
        .then((data) => {
          if (cancelled) return;
          // applySeed primeiro (traz o seed específico da edição: versão anterior,
          // custo evitado, etc.). Se houver rascunho desta edição (reload), restaura o
          // chat/wizard por cima — sem reiniciar a coleta do zero.
          applySeed(data, editProjetoId);
          if (editDraft && editDraft.projetoId === editProjetoId) {
            rehydrateFromLocal(editDraft);
          }
        })
        .catch((e) => {
          if (cancelled) return;
          console.error("[editar] falha ao carregar projeto:", e);
          toast.error("Não foi possível carregar o projeto para edição.");
        })
        .finally(finishSeed);
      return () => { cancelled = true; clearTimeout(safety); };
    }

    // ── Modo retomada de rascunho ──
    const local = loadDraft();
    const wantedId = resumeDraftId ?? local?.projetoId;
    if (!wantedId) {
      finishSeed();
      return;
    }

    apiFetch<Record<string, unknown>>(`/api/meus-projetos/${wantedId}`)
      .then(async (data) => {
        if (cancelled) return;
        // O rascunho só é retomável enquanto não foi submetido. Se já virou
        // em_validacao/aprovado (ou sumiu), descarta o snapshot e começa do zero.
        if ((data.status as string) !== "rascunho") {
          clearDraft();
          return;
        }
        if (local && local.projetoId === wantedId) {
          // Caminho rápido: snapshot local fiel.
          rehydrateFromLocal(local);
          return;
        }
        // Cross-device: sem snapshot local → seed do servidor + histórico do chat.
        applySeed(data, wantedId);
        try {
          const hist = await apiFetch<Array<Record<string, unknown>>>(
            `/api/chat/historico/${wantedId}`,
          );
          if (!cancelled && Array.isArray(hist) && hist.length > 0) {
            setChatMessages(
              hist.map((m) => ({
                role: (m.role as "user" | "assistant") ?? "assistant",
                content: String(m.content ?? ""),
                options: (m.options as ChatMessage["options"]) ?? undefined,
              })),
            );
            setStep(3);
            setCompletedSteps(new Set([1, 2, 3]));
          }
        } catch (e) {
          console.warn("[rascunho] histórico do chat indisponível:", e);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[rascunho] não foi possível retomar — começando do zero:", e);
        clearDraft();
      })
      .finally(finishSeed);
    return () => { cancelled = true; clearTimeout(safety); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editProjetoId, resumeDraftId]);

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
    usaAiProxy: "",
    especial: false,
    contextoEspecial: "",
  });

  // Identidade automática: nome + e-mail vêm da conta logada (Godeploy, via
  // /api/auth/me). O formulário não pergunta mais — preenchemos `form.nome`/
  // `form.email` UMA vez, e SÓ se estiverem vazios, para nunca sobrescrever o
  // seed da edição (applySeed) nem o rehydrate de rascunho (ambos autoritativos
  // e da mesma pessoa). O e-mail do edge é a fonte de verdade do ownership.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ email: string; name: string } | null>("/api/auth/me")
      .then((me) => {
        if (cancelled || !me?.email) return;
        setForm((prev) => {
          if (prev.nome.trim() || prev.email.trim()) return prev; // não clobber
          return { ...prev, nome: me.name ?? "", email: me.email };
        });
      })
      .catch((e) => console.warn("[auth] não foi possível obter a conta logada:", e));
    return () => { cancelled = true; };
  }, []);

  // Etapa 2.5 (tipo de projeto): sub-tela entre a etapa 2 e o início do agente.
  // Só aparece na PRIMEIRA passagem (antes do agente iniciar). Em re-entradas
  // (projetoId já existe) o fluxo padrão de "Continuar com Agente" é mantido.
  const [showEtapa25, setShowEtapa25] = useState(false);
  const [respEspecial, setRespEspecial] = useState<"sim" | "nao" | "">("");

  // Persiste o rascunho em andamento no localStorage para retomar ao
  // atualizar/voltar à página (sem criar um rascunho órfão novo). Só vale fora do
  // modo edição, depois que o rascunho existe no servidor (projetoId), e não
  // durante o seed inicial nem após submeter.
  useEffect(() => {
    if (!projetoId || submitted || seedLoading) return;
    // Persiste tanto a submissão NOVA quanto a EDIÇÃO (esta sob chave por projeto).
    // Antes a edição não salvava nada → reload no meio da conversa perdia tudo.
    saveDraft({
      projetoId,
      step,
      form,
      nomesExistentes,
      completedSteps: [...completedSteps],
      chatMessages,
      chatFase,
      chatComplete,
      agentTipos,
      agentMeta,
      agentArquivosSig,
      approvedDocPreview,
      approvedSavingPreview,
      approvedReceitaPreview,
      savingSubmitted,
      receitaSubmitted,
      formDraft,
      respEspecial,
      showSavingForm,
      showReceitaForm,
    }, editProjetoId ? editDraftKey(editProjetoId) : undefined);
  }, [
    editProjetoId, projetoId, submitted, seedLoading, step, form, nomesExistentes,
    completedSteps, chatMessages, chatFase, chatComplete, agentTipos, agentMeta,
    agentArquivosSig, approvedDocPreview, approvedSavingPreview, approvedReceitaPreview,
    savingSubmitted, receitaSubmitted, formDraft, respEspecial, showSavingForm, showReceitaForm,
  ]);

  // Ao submeter (qualquer fluxo), o rascunho deixa de existir — descarta o snapshot
  // local (da submissão nova OU da edição) para não reaparecer ao reabrir/recarregar.
  useEffect(() => {
    if (!submitted) return;
    if (editProjetoId) clearDraft(editDraftKey(editProjetoId));
    else clearDraft();
  }, [submitted, editProjetoId]);

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

  // "Recomeçar" (só submissão nova): zera TUDO e volta ao início. Apaga o rascunho
  // do servidor (evita órfão em "Meus Projetos > Rascunhos"), descarta o snapshot
  // local e faz navegação DURA para /submeter limpo — mesma abordagem robusta do
  // "Submeter outro projeto" da tela de sucesso, sem depender de resetar ~30 estados
  // à mão. A exclusão no servidor é best-effort: se falhar, o reset local segue
  // (o rascunho vira órfão, mas o usuário não fica preso).
  async function handleRecomecar() {
    setRecomecando(true);
    if (projetoId) {
      try {
        await apiFetch(`/api/meus-projetos/${projetoId}`, undefined, "DELETE");
      } catch (e) {
        console.warn("[recomeçar] não foi possível excluir o rascunho no servidor:", e);
      }
    }
    clearDraft();
    // Navegação dura para a URL limpa (descarta ?retomar e força remontagem do zero).
    window.location.assign("/submeter");
  }

  // "Salvar rascunho" (só submissão nova COM rascunho no servidor): o projeto já vive
  // como rascunho no servidor (linha `projetos` status 'rascunho', criada em
  // iniciar-submissao; conversa e metadados persistidos ao longo do fluxo). Aqui só
  // DESANEXAMOS a sessão local (clearDraft) — senão /submeter retomaria este rascunho
  // em vez de começar um novo — e voltamos para a home. A retomada acontece por
  // Meus Projetos › Rascunhos (Continuar → ?retomar=id, rehidrata do servidor).
  function handleSalvarRascunho() {
    setSalvandoRascunho(true);
    // Invalida o cache da lista para o rascunho aparecer atualizado em Meus Projetos.
    queryClient.invalidateQueries({ queryKey: ["meus-projetos"] });
    clearDraft();
    navigate({ to: "/" });
  }

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
    usaAiProxy: form.usaAiProxy,
    contextoEspecial: form.contextoEspecial.trim(),
  }), [form.nomeProjeto, form.participantes, form.dataCriacao, form.descricaoBreve, form.usaAiProxy, form.contextoEspecial, computeFerramenta]);

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
      // Nome e e-mail não são mais perguntados — vêm da conta logada (Godeploy).
      // Validamos apenas que a identidade foi detectada (caso raro de auth ausente).
      if (!form.email.trim())
        errs.email = "Não identificamos sua conta. Recarregue a página ou entre novamente.";
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
      if (!form.usaAiProxy)
        errs.usaAiProxy = "Selecione se o projeto usa o AI Proxy";
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
    // Em modo edição começa na etapa 2 — não volta para a 1.
    if (editProjetoId && step <= 2) return;
    if (step > 1) goToStep(step - 1, "back");
  }

  function handleStepClick(target: number) {
    // Em modo edição a etapa 1 não é acessível.
    if (editProjetoId && target === 1) return;
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
      const docs = await filesToDocs(arquivos);

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
          usa_ai_proxy: form.usaAiProxy || undefined,
          especial: form.especial || undefined,
          contexto_especial: form.especial ? form.contextoEspecial.trim() : undefined,
          docs,
        },
      );

      setProjetoId(result.projeto_id);
      // Cacheia os NOMES dos arquivos enviados — os File[] não sobrevivem a um
      // reload, mas os nomes são persistidos no rascunho e exibidos na etapa 2 ao
      // retomar (a pessoa vê o que já enviou, sem precisar reenviar para visualizar).
      setNomesExistentes(arquivos.map((f) => f.name));
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
    if (!editProjetoId && arquivos.length === 0) return;

    setEnviandoEspecial(true);
    try {
      const ferramentaEnviada = form.escopo === "externo"
        ? form.servicoExterno.trim()
        : form.ferramenta === "Outros" && form.ferramentaOutra.trim()
          ? `Outros: ${form.ferramentaOutra.trim()}`
          : form.ferramenta;

      if (editProjetoId && projetoId) {
        // Modo edição: atualiza metadados do projeto existente, reconstrói doc especial e reenvia.
        // filesToDocs descarta arquivos vazios; se sobrar zero doc (nada novo ou só
        // vazios), cai no reset_doc — que reusa os arquivos já enviados sem reupload.
        const docs = arquivos.length > 0 ? await filesToDocs(arquivos) : [];

        await apiFetchComRetry("/api/chat/atualizar-metadados", {
          projeto_id: projetoId,
          nome_projeto: form.nomeProjeto.trim(),
          ferramenta: ferramentaEnviada,
          membros: form.participantes,
          data_criacao: form.dataCriacao,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contexto_especial: form.contextoEspecial.trim(),
          // Monta a doc especial sem IA no backend (legado não tem doc; sem isso o
          // submeter-validacao quebrava com "Documentação ainda não foi gerada").
          // Reflete a escolha real do usuário (este handler só roda com respEspecial
          // = "sim", então é sempre true) — nunca hardcode: ver conversão especial→normal.
          especial: form.especial,
          ...(docs.length > 0 ? { docs } : { reset_doc: true }),
        });

        await apiFetch("/api/chat/submeter-validacao", { projeto_id: projetoId, modo: "edicao" });
        queryClient.invalidateQueries({ queryKey: ["meus-projetos"] });
        setSubmitted(true);
        return;
      }

      const docs = await filesToDocs(arquivos);

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
          usa_ai_proxy: form.usaAiProxy || undefined,
          especial: true,
          contexto_especial: form.contextoEspecial.trim(),
          docs,
        },
      );

      setProjetoId(result.projeto_id);

      // 2) Submete direto para a base (planilha + banco). Análise IA não se aplica.
      await apiFetch("/api/chat/submeter-validacao", { projeto_id: result.projeto_id });

      queryClient.invalidateQueries({ queryKey: ["meus-projetos"] });
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
      const docs = await filesToDocs(arquivos);
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

      const result = await apiFetchComRetry<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
        "/api/chat/atualizar-metadados",
        {
          projeto_id: projetoId,
          nome_projeto: meta.nomeProjeto,
          ferramenta: meta.ferramenta,
          membros: meta.participantes,
          data_criacao: meta.dataCriacao,
          descricao_breve: meta.descricaoBreve,
          usa_ai_proxy: meta.usaAiProxy || undefined,
          contexto_especial: meta.contextoEspecial,
          // Propaga a natureza do projeto: false sinaliza conversão especial→normal.
          especial: form.especial,
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
      // `arquivos.length > 0`: mesmo guard do ramo padrão — evita o reprocesso falso da
      // doc após reload/remontagem (arquivos File[] não sobrevivem ao localStorage).
      if (projetoId && arquivos.length > 0 && arquivosSig() !== agentArquivosSig) {
        await reprocessarComNovosArquivos();
        return;
      }
      const meta = snapshotMeta();
      const metaChanged = !agentMeta || JSON.stringify(meta) !== JSON.stringify(agentMeta);
      if (projetoId && metaChanged) {
        setContinuando(true);
        try {
          const result = await apiFetchComRetry<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
            "/api/chat/atualizar-metadados",
            {
              projeto_id: projetoId,
              nome_projeto: meta.nomeProjeto,
              ferramenta: meta.ferramenta,
              membros: meta.participantes,
              data_criacao: meta.dataCriacao,
              descricao_breve: meta.descricaoBreve,
              usa_ai_proxy: meta.usaAiProxy || undefined,
              contexto_especial: meta.contextoEspecial,
              especial: form.especial,
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
    // ⚠️ Só dispara quando há arquivo NOVO de fato (`arquivos.length > 0`). Sem esse
    // guard, após um reload/remontagem no meio da edição (recurso "reload não perde o
    // chat"), o `agentArquivosSig` volta preenchido do rascunho, mas o `arquivos: File[]`
    // NÃO (objetos File não serializam p/ localStorage) → `arquivosSig()` vira "" e a
    // comparação acusava "arquivos mudaram" falsamente, forçando o reprocesso da doc e
    // perdendo o saving já preenchido. `reprocessarComNovosArquivos` já é no-op sem
    // arquivos, então sem o guard o "Continuar com Agente" só travava (early-return).
    if (projetoId && arquivos.length > 0 && arquivosSig() !== agentArquivosSig) {
      await reprocessarComNovosArquivos();
      return;
    }

    // Metadados de texto mudaram → persiste; o agente lê frescos no próximo turno.
    if (projetoId && agentMeta) {
      const meta = snapshotMeta();
      const metaChanged = JSON.stringify(meta) !== JSON.stringify(agentMeta);
      if (metaChanged) {
        try {
          await apiFetchComRetry("/api/chat/atualizar-metadados", {
            projeto_id: projetoId,
            nome_projeto: meta.nomeProjeto,
            ferramenta: meta.ferramenta,
            membros: meta.participantes,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
            usa_ai_proxy: meta.usaAiProxy || undefined,
            // Conversão especial→normal: este ramo só roda com form.especial=false,
            // mas mandamos o valor real para o backend zerar a flag no banco.
            especial: form.especial,
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
    // GUARDA: se o preview de doc já existe (fase doc concluída) e nada mudou desde
    // o seed, não reinicia — o usuário só voltou a verificar, não alterou nada.
    const _fbMeta = snapshotMeta();
    const _fbNothingChanged = agentMeta !== null && JSON.stringify(_fbMeta) === JSON.stringify(agentMeta);
    // Marca quando o fallback reinicializou a fase de doc — nesse caso o usuário
    // deve revisar a doc, não pular direto para o formulário financeiro abaixo.
    let reinitedDoc = false;
    if (editProjetoId && chatMessages.length === 0 && !chatComplete && projetoId &&
        !(approvedDocPreview !== null && _fbNothingChanged)) {
      reinitedDoc = true;
      setContinuando(true);
      try {
        const meta = snapshotMeta();
        const result = await apiFetchComRetry<{ reset: boolean; response?: ReturnType<typeof Object.create> }>(
          "/api/chat/atualizar-metadados",
          {
            projeto_id: projetoId,
            nome_projeto: meta.nomeProjeto,
            ferramenta: meta.ferramenta,
            membros: meta.participantes,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
            usa_ai_proxy: meta.usaAiProxy || undefined,
            especial: form.especial,
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
        setContinuando(false);
        return;
      } finally {
        setContinuando(false);
      }
    }

    // Edição sem mudanças: em vez de pular direto para a revisão final, leva o
    // usuário pelas telas determinísticas (saving → receita) pré-preenchidas para
    // revisão. Se ele não mudar nada, o submit do formulário avança sem reprocessar
    // (ver handleSavingFormSubmit/handleReceitaFormSubmit).
    //
    // Dispara sempre que a documentação já existe (approvedDocPreview), não só
    // quando chatComplete=true. Projetos com a doc gerada mas SEM memorial
    // financeiro salvo (ex.: memorial_calculo nulo) entram aqui com chatComplete
    // =false — antes caíam num chat de doc vazio e travavam em "Analisando e
    // coletando informações...". Não dispara se o fallback acabou de reinicializar
    // a doc (reinitedDoc): nesse caso o usuário precisa revisar a doc primeiro.
    const docPronta = chatComplete || approvedDocPreview !== null;
    if (editProjetoId && !form.especial && !reinitedDoc && docPronta && !showSavingForm && !showReceitaForm) {
      const querSaving = form.tipoProjeto.includes("saving");
      const querReceita = form.tipoProjeto.includes("receita_incremental");
      // Fluxo "ambos": se o saving já foi aprovado e só a receita está pendente,
      // abre direto a receita em vez de re-percorrer o saving.
      const irParaReceita =
        querReceita && (!querSaving || (approvedSavingPreview !== null && approvedReceitaPreview === null));
      if (querSaving && !irParaReceita) {
        setChatComplete(false);
        openSavingForm();
      } else if (querReceita) {
        setChatComplete(false);
        openReceitaForm();
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
          if (editProjetoId) {
            // edição: pré-preenche com dados salvos anteriormente
            setFormDraft(savingSubmitted ?? emptyFormDraft());
          } else {
            setFormDraft(emptyFormDraft());
            setSavingSubmitted(null);
            setReceitaSubmitted(null);
          }
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
          if (editProjetoId) {
            // edição: pré-preenche com dados salvos anteriormente
            setFormDraft(receitaSubmitted ?? emptyFormDraft());
          } else {
            setFormDraft(emptyFormDraft());
            setReceitaSubmitted(null);
          }
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
      const temReceita = form.tipoProjeto.includes("receita_incremental");
      if (editProjetoId) {
        // Edição (revisão guiada): nada mudou → avança sem reprocessar. Se há receita,
        // abre o formulário de receita; senão, vai para a revisão final.
        if (temReceita) openReceitaForm();
        else setChatComplete(true);
      } else if (temReceita && approvedSavingPreview !== null) {
        // Fluxo "ambos": o usuário reabriu o saving (ex.: via "Voltar ao saving" da
        // receita) e não mudou nada. Como o saving já foi aprovado, volta ao
        // formulário de receita — senão cairia num chat vazio (as mensagens da fase
        // de saving foram limpas na transição para a receita).
        openReceitaForm();
      }
      // Demais casos: cai no chat da fase de saving exatamente onde estava.
      return;
    }
    setSavingFormLoading(true);
    try {
      const custoMensal = formData.custoExterno
        ? formData.custoPeriodicidade === "anual"
          ? parseFloat(formData.custoExterno) / 12
          : parseFloat(formData.custoExterno)
        : undefined;

      // Árvore "ninguém fazia": as horas (quando existem) são contrafactuais —
      // horas_depois é sempre 0 (a automação faz tudo). Custo evitado PURO (eliminou
      // gasto externo, SEM trabalho adicional) NÃO tem horas → alguem_fazia='externo'
      // e linhas vazias. Nos demais, o ganho é horas (reais no "sim", contrafactuais
      // no "não") + custo evitado quando houver.
      const isNaoBranch = formData.alguemFazia === "nao";
      const custoEvitadoPuro =
        isNaoBranch && formData.eliminaGastoExterno === "sim" && formData.temContrafactualAdicional === "nao";
      const ninguemFazia = isNaoBranch;
      const alguemFaziaPayload = custoEvitadoPuro ? "externo" : (formData.alguemFazia || undefined);
      const linhas = custoEvitadoPuro
        ? []
        : formData.linhas
            .filter((l) => l.cargo && l.horasAntes !== "" && (ninguemFazia || l.horasDepois !== ""))
            .map((l) => ({
              cargo: l.cargo,
              horas_antes: parseFloat(l.horasAntes),
              horas_depois: ninguemFazia ? 0 : parseFloat(l.horasDepois),
            }));

      // Custo evitado coletado: no ramo "Não" pela pergunta "elimina gasto externo?";
      // no ramo "Sim" pela pergunta opcional de custo distinto. Backend soma pelo valor cheio (pontual e mensal, sem ÷12).
      const temCustoEvitadoEfetivo = isNaoBranch
        ? (formData.eliminaGastoExterno === "sim" ? "sim" : "nao")
        : (formData.temCustoEvitado || undefined);
      const custoEvitadoItens =
        temCustoEvitadoEfetivo === "sim"
          ? formData.custoEvitadoItens
              .filter((it) => it.nome.trim() && it.valor !== "" && it.recorrencia)
              .map((it) => ({
                nome: it.nome.trim(),
                valor: parseMoedaBR(it.valor),
                recorrencia: it.recorrencia as "mensal" | "pontual",
                justificativa: it.justificativa.trim(),
              }))
          : [];

      // Custos do projeto: itens válidos quando "sim". O backend soma pelo valor cheio
      // (pontual e mensal, sem ÷12) e SUBTRAI do saving (custo incorrido pra operar).
      const custoProjetoItens =
        formData.temCustoProjeto === "sim"
          ? formData.custoProjetoItens
              .filter((it) => it.nome.trim() && it.valor !== "" && it.recorrencia)
              .map((it) => ({
                nome: it.nome.trim(),
                valor: parseMoedaBR(it.valor),
                recorrencia: it.recorrencia as "mensal" | "pontual",
                justificativa: it.justificativa.trim(),
              }))
          : [];

      const result = await apiFetch<ReturnType<typeof Object.create>>(
        "/api/chat/iniciar-saving",
        {
          projeto_id: projetoId,
          tipo_saving: formData.tipoSaving as "mensal" | "pontual" | "trimestral" | "semestral",
          alguem_fazia: alguemFaziaPayload,
          linhas: linhas.length ? linhas : undefined,
          custo_externo_mensal: custoMensal,
          tem_custo_evitado: temCustoEvitadoEfetivo || undefined,
          custo_evitado_itens: custoEvitadoItens.length ? custoEvitadoItens : undefined,
          tem_custo_projeto: formData.temCustoProjeto || undefined,
          custo_projeto_itens: custoProjetoItens.length ? custoProjetoItens : undefined,
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
      // Edição (revisão guiada): nada mudou → vai direto para a revisão final.
      if (editProjetoId) setChatComplete(true);
      return;
    }
    setReceitaFormLoading(true);
    try {
      const valorReceita = formData.valorReceita ? parseFloat(formData.valorReceita) : undefined;
      const result = await apiFetch<ReturnType<typeof Object.create>>(
        "/api/chat/iniciar-receita",
        {
          projeto_id: projetoId,
          tipo_saving: formData.tipoSaving as "mensal" | "pontual" | "trimestral" | "semestral",
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
    // Reabre com o saving já submetido; na falta dele, preserva o rascunho em
    // andamento (NUNCA volta a um formulário vazio descartando o que foi digitado).
    setFormDraft(savingSubmitted ?? formDraft ?? emptyFormDraft());
    setShowSavingForm(true);
  }
  function openReceitaForm() {
    if (chatLoading) return;
    setFormDraft(receitaSubmitted ?? formDraft ?? emptyFormDraft());
    setShowReceitaForm(true);
  }
  /* ── Enviar projeto ──────────────────────────────────────────────────────────
     A análise automática (analisador) NÃO roda mais no cliente: o servidor a
     dispara em background ao submeter (ver worker.ts → ctx.waitUntil). Assim a
     tela de sucesso aparece na hora, a pessoa pode fechar a aba, e o resultado
     fica disponível depois em "Meus Projetos". */
  async function handleSubmitProjeto() {
    if (!projetoId) return;
    setSubmittingProject(true);

    // Submissão — a prioridade. Se falhar, não mostra tela de sucesso.
    try {
      const res = await apiFetch<{ ok: boolean; status: string; ganho?: GanhoFinal }>(
        "/api/chat/submeter-validacao",
        {
          projeto_id: projetoId,
          ...(editProjetoId ? { modo: "edicao" } : {}),
        },
      );
      if (res?.ganho) setGanhoFinal(res.ganho);
    } catch (e) {
      console.error("[submeter] envio falhou:", e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("Já existe um projeto submetido")) {
        toast.warning(msg, { duration: 8000 });
      } else {
        toast.error("Erro ao enviar projeto. Tente novamente.");
      }
      setSubmittingProject(false);
      return;
    }

    // Submissão ok → tela de sucesso. A análise segue por trás dos panos no servidor.
    queryClient.invalidateQueries({ queryKey: ["meus-projetos"] });
    setSubmitted(true);
    setSubmittingProject(false);
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
              Pode fechar esta página — o resultado ficará disponível em <strong>Meus Projetos</strong> e você receberá um retorno por e-mail.
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

            {/* Comparativo numérico antes×depois — só em edição com versão anterior. */}
            {editProjetoId && versaoAnterior && ganhoFinal && (
              <GanhoComparison anterior={versaoAnterior} atual={ganhoFinal} />
            )}

            {/* A análise automática roda por trás dos panos no servidor — não há mais
                tela de carregamento aqui (gerava ansiedade). O resultado fica em
                "Meus Projetos". */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => navigate({ to: "/meus-projetos" })}
                className="go-btn-primary"
              >
                Ver em Meus Projetos
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-xs"
                style={{ color: "#8b8b9a" }}
              >
                Submeter outro projeto
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
            {/* Barra de "chrome" do card: os pontos à esquerda e, à direita, o
                controle discreto de recomeçar (só em submissão nova). Reaproveita a
                metáfora de janela dos BrowserDots em vez de flutuar um botão solto. */}
            <div className="flex items-center justify-between">
              <BrowserDots />
              {!editProjetoId && (
                <div className="flex items-center gap-1">
                  {/* Salvar rascunho: só quando já existe rascunho no servidor
                      (projetoId) — antes do agente iniciar não há nada para guardar. */}
                  {projetoId && (
                    <button
                      type="button"
                      onClick={() => setShowRascunhoConfirm(true)}
                      className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#a0a0ad] transition-colors hover:bg-[rgba(0,89,169,0.08)] hover:text-[var(--go-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-offset-1"
                      aria-label="Salvar como rascunho e começar outro projeto"
                      title="Salvar como rascunho"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Salvar rascunho</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[#a0a0ad] transition-colors hover:bg-[rgba(185,28,28,0.07)] hover:text-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--go-blue)] focus-visible:ring-offset-1"
                    aria-label="Recomeçar o formulário do zero"
                    title="Recomeçar do zero"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Recomeçar</span>
                  </button>
                </div>
              )}
            </div>
            <WizardProgress
              current={step}
              completed={completedSteps}
              onStepClick={handleStepClick}
              editMode={!!editProjetoId}
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
                  onSubmit={handleSubmitProjeto}
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
                  // "Editar tipo": volta à tela de seleção de tipo (Etapa 2.5), não ao
                  // início da etapa 2. showSavingForm persiste no pai; ao "Continuar com
                  // Agente" sem mudanças, o form reaparece (handleContinuarAgente não o reseta).
                  onSavingFormVoltar={() => { setShowEtapa25(true); goToStep(2, "back"); }}
                  savingFormVoltarLabel="Editar tipo"
                  // Form de receita: no fluxo "ambos" volta ao formulário de saving (sem
                  // sair da etapa 3); se for só receita, volta à seleção de tipo (2.5).
                  onReceitaFormVoltar={
                    form.tipoProjeto.includes("saving")
                      ? () => { setShowReceitaForm(false); openSavingForm(); }
                      : () => { setShowEtapa25(true); goToStep(2, "back"); }
                  }
                  receitaFormVoltarLabel={
                    form.tipoProjeto.includes("saving")
                      ? "Editar saving"
                      : "Editar tipo"
                  }
                  versaoAnterior={versaoAnterior}
                  novoResumo={{
                    nome: form.nomeProjeto.trim(),
                    descricaoBreve: form.descricaoBreve.trim(),
                    ferramenta: form.escopo === "externo"
                      ? form.servicoExterno.trim()
                      : form.ferramenta === "Outros" && form.ferramentaOutra.trim()
                        ? `Outros: ${form.ferramentaOutra.trim()}`
                        : form.ferramenta,
                    tiposProjeto: form.tipoProjeto,
                  }}
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
                style={{ visibility: (step === 1 || (editProjetoId && step === 2 && !showEtapa25)) ? "hidden" : "visible" }}
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
                      <CyclingText steps={editProjetoId ? LOADING_STEPS_EDITAR : LOADING_STEPS_ENVIAR_ESPECIAL} />
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

      {showResetConfirm && (
        <ConfirmarRecomecoModal
          onClose={() => setShowResetConfirm(false)}
          onConfirmar={handleRecomecar}
          processando={recomecando}
        />
      )}
      {showRascunhoConfirm && (
        <SalvarRascunhoModal
          onClose={() => setShowRascunhoConfirm(false)}
          onConfirmar={handleSalvarRascunho}
          processando={salvandoRascunho}
        />
      )}
    </PageFrame>
  );
}
