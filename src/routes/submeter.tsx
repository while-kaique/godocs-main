import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, FolderClock, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiStream, ApiError, setDemoBackend } from "@/lib/api-client";
import { criarDemoBackend, demoSeedForm, demoFile, CHAVE_TESTE_LIDERANCA, type FluxoDemo } from "@/lib/fluxos/demo-backend";
import { AvisoBloqueio } from "@/components/aviso-bloqueio";
import type { BloqueioSubmissao } from "@/lib/mensagens-submissao";
import { CODIGOS_TRIAGEM_ESPECIAL } from "@/lib/mensagens-submissao";

import {
  filesToDocs, TOKEN_BLOCK_CHARS,
  parseMoedaBR, numeroParaMoedaBR, montarMembrosPapeis, validarEtapa1,
  validarEtapa2, camposMinimosDocProntos, serializarAfetados, desserializarAfetados,
  limitarCoautorUnico, deveMostrarIntro,
  validarEtapa25Especial, motivoBloqueioEspecial,
  serializarFerramentas, desserializarFerramentas,
} from "@/lib/submeter/constants";
import type { FormData, FieldErrors, ChatFase, ChatMessage, SavingFormData, PapelParticipante } from "@/lib/submeter/constants";
import { saveDraft, loadDraft, clearDraft, editDraftKey, deveDescartarDraftEdicao, type DraftSnapshot } from "@/lib/submeter/draft-storage";
import type { VersaoSnapshot } from "@/lib/meus-projetos.functions";

function hasLocalDraft(): boolean {
  return loadDraft() !== null;
}

/**
 * Separa as duas naturezas de falha no ENVIO. Bloqueio de PREENCHIMENTO chega estruturado do
 * servidor (`ApiError.bloqueio`) e vai para o painel âmbar; qualquer outra coisa é falha de
 * sistema e segue no toast vermelho, que ali é verdade. Ver `spec-docs/SPEC_MENSAGENS_ERRO.md`.
 */
function bloqueioDoErro(e: unknown): BloqueioSubmissao | null {
  return e instanceof ApiError && e.bloqueio ? e.bloqueio : null;
}

/** Toast curto que só aponta para o painel — o conteúdo do bloqueio mora na tela. */
const TOAST_ENVIO_PAUSADO = "Envio pausado — veja na tela o que precisa ser corrigido.";
import { PageFrame, PageHeader, PageFooter, BrowserDots, WizardProgress, StepAnimation } from "@/lib/submeter/layout";
import { FAQ_RODAPE } from "@/lib/faq/links";
import { SummaryRow } from "@/lib/submeter/form-components";
import { Step1 } from "@/lib/submeter/step1";
import { Step2 } from "@/lib/submeter/step2";
import { Etapa25 } from "@/lib/submeter/step25";
import { Step3Chat, CyclingText } from "@/lib/submeter/step3-chat";
import { IntroSubmissao } from "@/lib/submeter/intro";

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
  // ?lideranca=1 FORÇA o fluxo direto de liderança (só vale para ADMIN — conferido no
  // servidor) para o Luis/admins testarem sem depender do cargo real na TeamGuide.
  validateSearch: (search: Record<string, unknown>): { retomar?: string; lideranca?: string } => ({
    retomar: typeof search.retomar === "string" ? search.retomar : undefined,
    lideranca: typeof search.lideranca === "string" ? search.lideranca : undefined,
  }),
  component: SubmeterPage,
});

function SubmeterPage() {
  const { retomar, lideranca } = Route.useSearch();
  return <SubmeterPageContent resumeDraftId={retomar} liderancaOverride={lideranca === "1"} />;
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
  // Papel de cada participante (e-mail→papel). Entra no meta para que trocar um
  // papel também dispare metaChanged e seja persistido (via atualizar-metadados).
  participantesPapeis: Record<string, string>;
  dataCriacao: string;
  descricaoBreve: string;
  // Usa o AI Proxy interno? Entra no meta para que uma mudança dispare metaChanged.
  usaAiProxy: "sim" | "nao" | "";
  // Contrafactual (Etapa 2). `contrafactualAfetados` viaja SERIALIZADO
  // ("pessoa:a@x;b@y") para a comparação de metaChanged ser estável — é o mesmo formato
  // gravado no SQLite.
  contrafactualAfetados: string;
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
  liderancaOverride,
  demoFluxo,
}: {
  editProjetoId?: string;
  resumeDraftId?: string;
  liderancaOverride?: boolean;
  // Sandbox admin `/fluxos`: renderiza o formulário REAL em modo demonstração (backend
  // mockado, nada persistido). Ver src/lib/fluxos/demo-backend.ts.
  demoFluxo?: FluxoDemo;
} = {}) {
  const navigate = useNavigate();
  // Invalida o cache de "Meus Projetos" (staleTime 60s) após submeter/reenviar, para
  // a lista refletir o novo estado real (ex.: legado regularizado deixa de mostrar o
  // aviso de pendência) sem exigir hard-refresh do usuário.
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  // Carrega tela de "preparando" enquanto seedamos: edição (servidor) OU
  // retomada de rascunho (localStorage ou ?retomar).
  const [seedLoading, setSeedLoading] = useState(
    !demoFluxo && (!!editProjetoId || !!resumeDraftId || hasLocalDraft()),
  );
  // Apresentação do formulário (antes da Etapa 1). Decidida UMA vez, no mount, com
  // o mesmo trio de sinais do `seedLoading` acima — a intro só vale para submissão
  // nova e limpa. Não persiste nada: por decisão de produto ela aparece SEMPRE que
  // alguém abre /submeter do zero (inclusive depois de "Recomeçar" e de
  // "Submeter outro projeto", que recarregam a página sem rascunho).
  const [showIntro, setShowIntro] = useState(() =>
    // No sandbox, sempre mostra a intro (é uma tela a inspecionar) e ignora rascunhos reais.
    demoFluxo
      ? true
      : deveMostrarIntro({
          editProjetoId,
          resumeDraftId,
          temRascunhoLocal: hasLocalDraft(),
        }),
  );
  const [nomesExistentes, setNomesExistentes] = useState<string[]>([]);
  // O usuário removeu um arquivo já enviado (box "Arquivos enviados anteriormente").
  // Como o servidor guarda a doc como texto único concatenado (não por arquivo), não dá
  // para regenerar de um subconjunto → exige re-upload dos que quer manter (Opção A).
  const [docExistenteInvalidado, setDocExistenteInvalidado] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [submitted, setSubmitted] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [shaking, setShaking] = useState(false);
  const formCardRef = useRef<HTMLDivElement>(null);
  // Bloqueio da última tentativa de ENVIO (preenchimento: saving sem ganho líquido, receita
  // incompleta, doc ausente, nome duplicado). Vem estruturado do servidor e é renderizado
  // como painel âmbar ancorado no botão — não como toast vermelho, que sumia em 20s e dizia
  // "o sistema quebrou" para um problema de preenchimento. Ver `lib/mensagens-submissao.ts`.
  const [bloqueio, setBloqueio] = useState<BloqueioSubmissao | null>(null);

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
  // Fluxo DIRETO de liderança: loading do botão "Enviar direto" (cria projeto + doc por IA).
  const [iniciandoDireto, setIniciandoDireto] = useState(false);
  // F2 — processamento da doc em segundo plano (só submissão nova). Ao subir arquivos na
  // Etapa 2, disparamos iniciar-submissao em background para a Etapa 3 abrir sem espera.
  const [bgStatus, setBgStatus] = useState<"idle" | "processando" | "pronto" | "erro">("idle");
  // Assinatura (arquivos+meta) já processada/em processamento — evita disparo duplicado.
  const bgSigRef = useRef<string>("");
  // Promise do disparo em voo — os botões da Etapa 2.5 aguardam antes de navegar.
  // Resolve com o projeto_id criado (sucesso) ou null (falha → cai no fluxo síncrono).
  const bgPromiseRef = useRef<Promise<string | null> | null>(null);
  const bgInFlightRef = useRef(false);
  const bgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sinaliza que o background já criou o projeto e a Etapa 2.5 (não-especial) deve delegar
  // ao fluxo de re-entrada (handleContinuarAgente) no PRÓXIMO render — com projetoId fresco
  // no estado, evitando ler o valor stale logo após o setProjetoId do background.
  const [pendingContinuar, setPendingContinuar] = useState(false);
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
  // "Salvar rascunho": confirmação + estado (só quando já existe rascunho no servidor).
  const [showRascunhoConfirm, setShowRascunhoConfirm] = useState(false);
  const [salvandoRascunho, setSalvandoRascunho] = useState(false);
  // "Recomeçar": confirmação + estado de processamento do reset (só submissão nova).
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [recomecando, setRecomecando] = useState(false);

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
        // Uma string no banco → lista de chips. Quebra por " + ", normaliza os valores
        // legados de quando o campo era de escolha única ("Claude", "Claude + GoDeploy")
        // e devolve o texto de "Outros: …" separado. Ver desserializarFerramentas.
        const { ferramentas, ferramentaOutra } = desserializarFerramentas(
          data.ferramenta as string | null,
        );

        // Papel de cada membro já existente: usa o papel conhecido (projetos novos)
        // ou, na falta (legado importado antes desta feature), "coexecutor" — que é a
        // semântica da coluna "Participantes" de onde esses e-mails vieram. Lookup
        // tolerante a caixa. Novos participantes adicionados na edição começam sem
        // papel (obrigatório escolher). O autor não entra aqui.
        const membrosPapeisSeed = (data.membros_papeis as Record<string, string>) ?? {};
        const papeisLower: Record<string, string> = {};
        for (const [k, v] of Object.entries(membrosPapeisSeed)) papeisLower[k.toLowerCase()] = v;
        const participantesPapeisBruto: FormData["participantesPapeis"] = {};
        for (const email of membros) {
          const p = membrosPapeisSeed[email] ?? papeisLower[email.toLowerCase()];
          participantesPapeisBruto[email] = (p as PapelParticipante) || "coexecutor";
        }
        // Coautor é único por projeto: projeto antigo/legado pode trazer vários da coluna
        // "Participantes" — mantém o primeiro e deixa os demais sem papel para o usuário
        // reclassificar (a validação da Etapa 1 exige papel de todos).
        const participantesPapeis = limitarCoautorUnico(membros, participantesPapeisBruto);

        // Contrafactual: a lista de afetados é gravada serializada ("pessoa:a@x;b@y").
        const afetadosSeed = desserializarAfetados(data.contrafactual_afetados as string | null);

        const newForm: FormData = {
          escopo: (data.escopo as string) ?? "interno",
          prodStatus: "sim",
          nome: (data.responsavel_nome as string) ?? "",
          email: (data.responsavel_email as string) ?? "",
          ferramentas,
          ferramentaOutra,
          servicoExterno: (data.servico_externo as string) ?? "",
          emEquipe: membros.length > 0 ? "sim" : "nao",
          participantes: membros,
          participantesPapeis,
          nomeProjeto: (data.nome_projeto as string) ?? "",
          dataCriacao: (data.data_criacao_projeto as string) ?? "",
          tipoProjeto: tiposProjeto,
          descricaoBreve: (data.descricao_breve as string) ?? "",
          usaAiProxy: ((data.usa_ai_proxy as string) ?? "") as FormData["usaAiProxy"],
          contrafactualAfetadosTipo: afetadosSeed.tipo,
          contrafactualAfetados: afetadosSeed.lista,
          especial: data.especial === true,
          contextoEspecial: (data.contexto_especial as string) ?? "",
          // Triagem do especial: campos SÓ DO FRONTEND (não existem no servidor), então a
          // edição de um especial já submetido começa em branco e as 2 perguntas são
          // respondidas de novo antes do reenvio — é o efeito desejado (especial legado
          // passa pela triagem que não existia quando ele entrou).
          especialDashboard: "",
          especialGanhoOrganizacional: "",
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
            : serializarFerramentas(newForm.ferramentas, newForm.ferramentaOutra),
          participantes: newForm.participantes,
          participantesPapeis: montarMembrosPapeis(newForm.participantes, newForm.participantesPapeis),
          dataCriacao: newForm.dataCriacao,
          descricaoBreve: newForm.descricaoBreve.trim(),
          usaAiProxy: newForm.usaAiProxy,
          contrafactualAfetados: serializarAfetados(
            newForm.contrafactualAfetadosTipo,
            newForm.contrafactualAfetados,
          ),
          contextoEspecial: newForm.contextoEspecial.trim(),
        });

        // R1 (refinamento pós-staging): a edição ABRE na Etapa 1 (participantes/papéis
        // são o foco). As Etapas 1 e 2 já contam como alcançadas (clicáveis no topo).
        setStep(1);
        // Etapa 3 ainda não foi percorrida nesta sessão — não marcar como concluída.
        setCompletedSteps(new Set([1, 2]));
  }, []);

  // Repõe o estado do wizard a partir do snapshot local (mesmo navegador) —
  // retomada fiel de um rascunho ao atualizar/voltar à página, sem ida ao servidor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rehydrateFromLocal = useCallback((d: DraftSnapshot) => {
    // Rascunhos salvos antes desta feature não têm `participantesPapeis` — default {}
    // para nunca ler `undefined[email]`.
    // ⚠️ Rascunho SALVO ANTES de um campo novo existir não tem a chave — espalhar o
    // objeto cru deixa o campo `undefined` e qualquer `.join()/.some()` derruba a tela
    // inteira (bug real: /submeter em branco com "This page didn't load"). Todo campo
    // novo precisa de default aqui, como o `participantesPapeis`.
    setForm({
      ...d.form,
      participantesPapeis: d.form.participantesPapeis ?? {},
      contrafactualAfetadosTipo: d.form.contrafactualAfetadosTipo ?? "pessoa",
      contrafactualAfetados: d.form.contrafactualAfetados ?? [],
      // Rascunho salvo antes da triagem do especial não tem as chaves → "" (não respondida).
      especialDashboard: d.form.especialDashboard ?? "",
      especialGanhoOrganizacional: d.form.especialGanhoOrganizacional ?? "",
      // Rascunho salvo quando a ferramenta era ESCOLHA ÚNICA guardou `ferramenta: "Claude"`
      // e não tem `ferramentas` — sem esta conversão o campo abriria vazio (perdendo o que
      // a pessoa já tinha marcado) e o `.includes()` do seletor quebraria a tela.
      ferramentas: d.form.ferramentas ?? desserializarFerramentas(
        (d.form as unknown as { ferramenta?: string }).ferramenta,
      ).ferramentas,
    });
    setNomesExistentes(d.nomesExistentes ?? []);
    setDocExistenteInvalidado(d.docExistenteInvalidado ?? false);
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
    // Sandbox de demonstração (/fluxos): não seeda de rascunho/servidor — o formulário
    // é pré-preenchido pelo efeito de demo. Sai cedo para não carregar nada real.
    if (demoFluxo) return;
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
            // Servidor manda: só reidrata o rascunho local se for consistente com o
            // servidor. Se o rascunho diz que a doc foi concluída (preview aprovado /
            // chatComplete) mas o servidor NÃO tem doc persistida (legado que nunca
            // teve o preview aprovado), descarta — senão a tela de aprovação final
            // "ressuscita" sobre um projeto sem doc e trava ("Documentação ainda não
            // foi gerada"). Descartando, o re-init abaixo (reset_doc) limpa o chat no
            // servidor e recomeça a auditoria do zero. Ver deveDescartarDraftEdicao.
            const serverTemDoc = data.documentacao != null;
            if (deveDescartarDraftEdicao({ serverTemDoc, draft: editDraft })) {
              clearDraft(editDraftKey(editProjetoId));
            } else {
              rehydrateFromLocal(editDraft);
            }
          }
        })
        .catch((e) => {
          if (cancelled) return;
          console.error("[editar] falha ao carregar projeto:", e);
          toast.error(
            "Não foi possível carregar este projeto para edição. Recarregue a página; se continuar, fale com a equipe pelo botão de ajuda.",
            { duration: 12000 },
          );
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
            // Defesa em profundidade: só bolhas de conversa. O backend já filtra a
            // role 'doc' (texto bruto dos arquivos) e parseia o JSON do assistant,
            // mas mantemos o filtro aqui para nunca renderizar conteúdo cru vindo de
            // dados legados/inesperados.
            const conversa = hist.filter(
              (m) => m.role === "user" || m.role === "assistant",
            );
            const msgs: ChatMessage[] = conversa.map((m) => ({
              role: m.role === "user" ? "user" : "assistant",
              content: String(m.content ?? ""),
              options: (m.options as ChatMessage["options"]) ?? undefined,
              isPreview: Boolean(m.isPreview),
              isComplete: Boolean(m.isComplete),
              fase: (m.fase as ChatFase | undefined) ?? undefined,
            }));
            if (msgs.length > 0) {
              setChatMessages(msgs);
              // Coerência da UI: alinha fase/estado de conclusão à última resposta do
              // agente (senão a conversa retomada ficava presa na fase "doc").
              const ultima = msgs[msgs.length - 1];
              if (ultima.fase) setChatFase(ultima.fase);
              if (ultima.isComplete) setChatComplete(true);
              setStep(3);
              setCompletedSteps(new Set([1, 2, 3]));
            }
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
    ferramentas: [],
    ferramentaOutra: "",
    servicoExterno: "",
    emEquipe: "",
    participantes: [],
    participantesPapeis: {},
    nomeProjeto: "",
    dataCriacao: today,
    tipoProjeto: [],
    descricaoBreve: "",
    usaAiProxy: "",
    contrafactualAfetadosTipo: "pessoa",
    contrafactualAfetados: [],
    especial: false,
    contextoEspecial: "",
    especialDashboard: "",
    especialGanhoOrganizacional: "",
  });

  // ── Sandbox de demonstração (/fluxos) ──────────────────────────────────────
  // Instala o backend MOCKADO e pré-preenche o formulário para percorrer o fluxo
  // escolhido (normal/especial/liderança) sem tocar servidor/banco. O handler é
  // memoizado (estado de conversa preservado entre renders) e instalado em
  // useLayoutEffect — roda ANTES dos efeitos passivos (auth/me, perfil), então essas
  // chamadas já caem no mock. Prefill roda uma vez.
  const demoBk = useMemo(() => (demoFluxo ? criarDemoBackend(demoFluxo) : null), [demoFluxo]);
  useLayoutEffect(() => {
    if (!demoBk) return;
    setDemoBackend(demoBk);
    return () => setDemoBackend(null);
  }, [demoBk]);
  const demoSeedAplicado = useRef(false);
  useEffect(() => {
    if (!demoFluxo || demoSeedAplicado.current) return;
    demoSeedAplicado.current = true;
    setForm((prev) => ({ ...prev, ...demoSeedForm(demoFluxo, today) }));
    setArquivos([demoFile()]);
    setNomesExistentes(["exemplo-demonstracao.txt"]);
  }, [demoFluxo, today]);

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

  // Perfil de submissão: o usuário logado é LIDERANÇA (cargo isento, coordenador+)? Se
  // for, o formulário oferece o FLUXO DIRETO — pula o agente conversacional e os gates
  // (doc por IA + memorial determinístico). Endpoint separado do /api/auth/me de
  // propósito (só o form precisa; não pôr a consulta à TeamGuide no caminho de todo
  // auth/me). ⚠️ É só o que PINTA: o servidor reconfere a permissão em
  // iniciar-submissao/saving/receita, então o override abaixo nunca burla um gate.
  const [perfilLideranca, setPerfilLideranca] = useState(false);
  const [perfilAdmin, setPerfilAdmin] = useState(false);
  // Até o perfil carregar, NÃO decidimos o fluxo — segura o disparo do background (que
  // inicia o agente normal) para não pré-processar a doc de um líder pelo caminho errado.
  const [perfilCarregado, setPerfilCarregado] = useState(false);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ ehLideranca?: boolean; isAdmin?: boolean } | null>("/api/submeter/perfil")
      .then((p) => {
        if (cancelled) return;
        setPerfilLideranca(!!p?.ehLideranca);
        setPerfilAdmin(!!p?.isAdmin);
      })
      .catch((e) => console.warn("[submeter] perfil de submissão indisponível:", e))
      .finally(() => { if (!cancelled) setPerfilCarregado(true); });
    return () => { cancelled = true; };
  }, []);

  // Liderança EFETIVA: cargo isento OU override de admin para testar. O override vem de
  // duas fontes: `?lideranca=1` (funciona em navegação client-side) e a flag de
  // sessionStorage setada pelo botão do /fluxos (robusta: o edge engole a query no OAuth,
  // a flag não). Ambas SÓ valem para admin (o servidor reconfere de novo).
  const liderancaFlag = useMemo(() => {
    try {
      return sessionStorage.getItem(CHAVE_TESTE_LIDERANCA) === "1";
    } catch {
      return false;
    }
  }, []);
  const overrideLideranca = perfilAdmin && (!!liderancaOverride || liderancaFlag);
  const ehLiderancaEfetivo = perfilLideranca || overrideLideranca;
  // O fluxo DIRETO vale só para SUBMISSÃO NOVA e projeto padrão. Edição de liderança
  // segue a revisão guiada normal (evita o rehydrate/re-init do doc da edição); o
  // especial já pula o agente por conta própria.
  const modoDireto = ehLiderancaEfetivo && !form.especial && !editProjetoId;

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
    // Sandbox: nunca persiste rascunho (não polui o localStorage do admin).
    if (demoFluxo) return;
    if (!projetoId || submitted || seedLoading) return;
    // Persiste tanto a submissão NOVA quanto a EDIÇÃO (esta sob chave por projeto).
    // Antes a edição não salvava nada → reload no meio da conversa perdia tudo.
    saveDraft({
      projetoId,
      step,
      form,
      nomesExistentes,
      docExistenteInvalidado,
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
    docExistenteInvalidado,
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

  // Remove de verdade um arquivo do box "Arquivos enviados anteriormente": some da lista
  // (e do rascunho persistido) e marca a doc como invalidada — o "Continuar" vai exigir
  // re-upload dos arquivos que se quer manter (o servidor não regenera subconjunto).
  const handleRemoverExistente = useCallback((nome: string) => {
    setNomesExistentes((prev) => prev.filter((n) => n !== nome));
    setDocExistenteInvalidado(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.documentacao;
      return next;
    });
  }, []);

  const clearError = useCallback((key: string) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

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

  const prodBlocked = !form.escopo || form.prodStatus === "dev" || form.prodStatus === "idle";

  /* Triagem do especial: MESMA régua pura da tela e dos handlers de envio (fonte única
     `motivoBloqueioEspecial`). Fica aqui, derivada do form a cada render, por dois motivos:
     (1) o botão de envio precisa nascer DESABILITADO enquanto a triagem bloqueia — antes ele
     seguia clicável e cada clique era mais um caminho para o mesmo bloqueio; (2) sendo
     derivado, ele SOME sozinho quando a pessoa troca a resposta para "não" — o painel que
     vinha de estado (`bloqueio`) sobrevivia à correção e mentia na tela. */
  const motivoEspecialAtual = motivoBloqueioEspecial({ ...form, especial: respEspecial === "sim" });

  /* ── Metadados do agente: snapshot + detecção de mudança ── */
  // FONTE ÚNICA da string que vai para `projetos.ferramenta` (banco/Sheets). Antes esta
  // mesma expressão estava reescrita à mão em 5 lugares; com multi-seleção seriam 5
  // cópias de uma serialização não trivial, então todos passam por aqui.
  const computeFerramenta = useCallback((): string => {
    return form.escopo === "externo"
      ? form.servicoExterno.trim()
      : serializarFerramentas(form.ferramentas ?? [], form.ferramentaOutra);
  }, [form.escopo, form.servicoExterno, form.ferramentas, form.ferramentaOutra]);

  // Escopo EXTERNO: o nome do serviço vira a "ferramenta" do projeto E tem coluna própria
  // no banco (`servico_externo`, que o orquestrador lê). Como a ferramenta é editável
  // também na edição, os dois precisam viajar juntos em `atualizar-metadados` — senão o
  // agente seguiria citando o serviço antigo. Escopo interno → não manda (undefined).
  const servicoExternoEnviado = useCallback((): string | undefined => {
    return form.escopo === "externo" ? form.servicoExterno.trim() : undefined;
  }, [form.escopo, form.servicoExterno]);

  const snapshotMeta = useCallback((): AgentMeta => ({
    nomeProjeto: form.nomeProjeto.trim(),
    ferramenta: computeFerramenta(),
    participantes: form.participantes,
    participantesPapeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
    dataCriacao: form.dataCriacao,
    descricaoBreve: form.descricaoBreve.trim(),
    usaAiProxy: form.usaAiProxy,
    contrafactualAfetados: serializarAfetados(
      form.contrafactualAfetadosTipo,
      form.contrafactualAfetados ?? [],
    ),
    contextoEspecial: form.contextoEspecial.trim(),
  }), [form.nomeProjeto, form.participantes, form.participantesPapeis, form.dataCriacao, form.descricaoBreve, form.usaAiProxy, form.contrafactualAfetadosTipo, form.contrafactualAfetados, form.contextoEspecial, computeFerramenta]);

  // Assinatura dos arquivos (caminho + tamanho) — muda se o usuário troca os arquivos.
  const arquivosSig = useCallback((): string => {
    return arquivos
      .map((f) => `${f.webkitRelativePath || f.name}:${f.size}`)
      .sort()
      .join("|");
  }, [arquivos]);

  /* ── F2: processamento da documentação em segundo plano ──────────────────────
     Ao subir arquivos na Etapa 2 (submissão nova), disparamos iniciar-submissao em
     background para a Etapa 3 abrir sem espera. Roda a fase de DOC (sem tipo/especial,
     definidos na Etapa 2.5 — o backend não precisa deles p/ documentar). Cria o rascunho
     UMA vez; depois disso o botão da 2.5 vira "Continuar com Agente" (handleContinuarAgente),
     que sincroniza tipos/meta e navega. Resolve com o projeto_id (ou null em falha). */
  const dispararDocBackground = useCallback((): Promise<string | null> => {
    const sig = `${arquivosSig()}::${JSON.stringify(snapshotMeta())}`;
    bgSigRef.current = sig;
    bgInFlightRef.current = true;
    setBgStatus("processando");
    const run: Promise<string | null> = (async () => {
      try {
        const docs = await filesToDocs(arquivos);
        const ferramentaEnviada = computeFerramenta();
        const result = await apiFetch<{ projeto_id: string; response: ReturnType<typeof Object.create> }>(
          "/api/chat/iniciar-submissao",
          {
            responsavel_nome: form.nome.trim(),
            responsavel_email: form.email.trim(),
            ferramenta: ferramentaEnviada,
            escopo: form.escopo as "interno" | "externo",
            servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
            membros: form.participantes,
            membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
            nome_projeto: form.nomeProjeto.trim(),
            data_criacao: form.dataCriacao,
            // SEM tipos/especial: a fase de doc não depende deles; a Etapa 2.5 os define
            // depois (handleContinuarAgente sincroniza; especial converte via metadados).
            descricao_breve: form.descricaoBreve.trim() || undefined,
            usa_ai_proxy: form.usaAiProxy || undefined,
            contrafactual_afetados:
              serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
              undefined,
            docs,
          },
        );
        setProjetoId(result.projeto_id);
        setNomesExistentes(arquivos.map((f) => f.name));
        setAgentTipos([]);
        setAgentMeta(snapshotMeta());
        setAgentArquivosSig(arquivosSig());
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
        setDocExistenteInvalidado(false);
        setBgStatus("pronto");
        return result.projeto_id;
      } catch (e) {
        console.warn("[submeter] processamento em background falhou (seguirá no Continuar):", e);
        bgSigRef.current = ""; // libera novo disparo (e o fluxo síncrono cria normalmente)
        setBgStatus("erro");
        return null;
      } finally {
        bgInFlightRef.current = false;
      }
    })();
    bgPromiseRef.current = run;
    return run;
  }, [arquivos, form, arquivosSig, snapshotMeta]);

  // Dispara o background (debounced) assim que HÁ arquivo anexado e a Etapa 1 está pronta
  // (`camposMinimosDocProntos` = escopo + nome; NÃO espera descrição/AI Proxy da Etapa 2 —
  // ver a função). Arrancar cedo dá ao processamento a folga em que a pessoa preenche o
  // resto da Etapa 2, para terminar antes do clique em avançar. `snapshotMeta()` entra na
  // `sig`, mas, como o efeito sai cedo quando `projetoId` já existe, o disparo é único: os
  // campos digitados depois seguem via `atualizar-metadados` ao avançar (handleContinuarAgente).
  // Só submissão NOVA (!editProjetoId) e só enquanto o projeto não existe (cria 1 vez).
  useEffect(() => {
    if (editProjetoId || projetoId) return;
    // Sandbox: sem pré-processamento em background (cada fluxo cria o projeto no clique).
    if (demoFluxo) return;
    // Liderança usa o FLUXO DIRETO (doc por IA numa passada quando clica "Enviar
    // direto") — não pré-processamos a doc pelo agente. Enquanto o perfil não carregou,
    // seguramos o disparo para não iniciar o agente por engano num líder.
    if (!perfilCarregado || ehLiderancaEfetivo) return;
    if (arquivos.length === 0) return;
    if (docExistenteInvalidado) return;
    if (!camposMinimosDocProntos(form)) return;
    if (bgInFlightRef.current) return;
    const charsEstimados = arquivos.reduce((a, f) => a + f.size, 0) + form.descricaoBreve.length;
    if (charsEstimados > TOKEN_BLOCK_CHARS) return;
    const sig = `${arquivosSig()}::${JSON.stringify(snapshotMeta())}`;
    if (bgSigRef.current === sig) return;
    if (bgDebounceRef.current) clearTimeout(bgDebounceRef.current);
    bgDebounceRef.current = setTimeout(() => { void dispararDocBackground(); }, 800);
    return () => { if (bgDebounceRef.current) clearTimeout(bgDebounceRef.current); };
  }, [editProjetoId, projetoId, arquivos, form, docExistenteInvalidado, arquivosSig, snapshotMeta, dispararDocBackground, perfilCarregado, ehLiderancaEfetivo, demoFluxo]);

  // Após o background criar o projeto, a Etapa 2.5 (não-especial) delega ao fluxo de
  // re-entrada num render com projetoId JÁ no estado (evita ler o valor stale).
  // handleContinuarAgente é redefinida a cada render (não memoizada); incluí-la nas deps
  // faria o efeito rodar todo render à toa — o guard já garante disparo único.
  useEffect(() => {
    if (pendingContinuar && projetoId && !continuando) {
      setPendingContinuar(false);
      void handleContinuarAgente();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingContinuar, projetoId, continuando]);

  /* ── Validation ── */
  function validateStep(n: number): boolean {
    // Etapa 1 (Envio): validação pura extraída. Em edição, relaxa os campos de
    // projeto legado (escopo/status/ferramenta) mas mantém identidade + participantes/
    // papéis (D2/RF-103); submissão nova segue com a validação cheia (RF-106).
    let errs: FieldErrors = n === 1 ? validarEtapa1(form, { modoEdicao: !!editProjetoId }) : {};

    if (n === 2) {
      // O tipo de projeto (saving/receita/especial) passou para a Etapa 2.5. Validação
      // pura extraída (constants.ts): campos + regra de arquivos/existentes/invalidado.
      errs = validarEtapa2(form, {
        arquivosCount: arquivos.length,
        nomesExistentesCount: nomesExistentes.length,
        docExistenteInvalidado,
        hojeISO: new Date().toISOString().split("T")[0],
      });
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
    // A edição "aterrissa" na Etapa 2, mas a Etapa 1 (participantes/papéis) é
    // navegável: o "Voltar" da Etapa 2 leva à 1 tanto na submissão nova quanto na edição.
    if (step > 1) goToStep(step - 1, "back");
  }

  function handleStepClick(target: number) {
    // A Etapa 1 é clicável no topo (submissão nova e edição), desde que já alcançada.
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
    else {
      updateField("contextoEspecial", "");
      // Projeto padrão não passa pela triagem do especial — zera as respostas para
      // não guardar resposta de pergunta que a tela não mostra mais (e para que
      // voltar a "Sim" exija reafirmar as duas).
      updateField("especialDashboard", "");
      updateField("especialGanhoOrganizacional", "");
      clearError("especialDashboard");
      clearError("especialGanhoOrganizacional");
      clearError("especialBloqueio");
    }
    clearError("especial");
    clearError("contextoEspecial");
    clearError("tipoProjeto");
  }

  /* ── Etapa 2.5: resposta de uma das 2 perguntas de triagem do especial ── */
  function handleRespTriagemEspecial(
    campo: "especialDashboard" | "especialGanhoOrganizacional",
    valor: "sim" | "nao",
  ) {
    updateField(campo, valor);
    clearError(campo);
    clearError("especialBloqueio");
    // Trocar a resposta é uma tentativa NOVA: um painel de bloqueio anterior (inclusive um
    // vindo da API, como doc ausente) não pode ficar na tela contradizendo a resposta atual.
    setBloqueio(null);
    // Trocar a 1ª resposta para "sim" torna a 2ª pergunta invisível (o projeto já está
    // bloqueado) — a resposta dela deixa de valer e é zerada, para nunca sobrar juízo
    // sobre uma pergunta que a pessoa não está mais vendo.
    if (campo === "especialDashboard" && valor === "sim") {
      updateField("especialGanhoOrganizacional", "");
      clearError("especialGanhoOrganizacional");
    }
  }

  /* ── Valida a Etapa 2.5 antes de iniciar o agente ── */
  function validateEtapa25(): boolean {
    if (respEspecial === "") {
      setError("especial", "Responda à pergunta acima para continuar");
      return false;
    }
    if (respEspecial === "sim") {
      // Triagem do especial (dashboard/painel · ganho organizacional): perguntas não
      // respondidas + o BLOQUEIO, tudo da função pura em `constants.ts`.
      const errsTriagem = validarEtapa25Especial({ ...form, especial: true });
      if (Object.keys(errsTriagem).length > 0) {
        setErrors((prev) => ({ ...prev, ...errsTriagem }));
        return false;
      }
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

    // F2: o background já criou (ou está criando) o projeto → NÃO recria (evita duplicado).
    // Aguarda o disparo em voo; se produziu um projeto, delega ao fluxo de re-entrada
    // (handleContinuarAgente via pendingContinuar, com projetoId fresco no estado).
    if (bgPromiseRef.current) {
      setIniciandoChat(true);
      let bgId: string | null = null;
      try { bgId = await bgPromiseRef.current; } catch { bgId = null; }
      setIniciandoChat(false);
      if (bgId) { setPendingContinuar(true); return; }
      // background falhou (bgId null) → segue a criação síncrona normal abaixo.
    }

    if (arquivos.length === 0) return;

    // Trava do orçamento de tokens: bloqueia se o conteúdo estimado estourar.
    // Proxy: soma dos tamanhos dos arquivos + descrição (1 byte ≈ 1 char).
    const charsEstimados =
      arquivos.reduce((acc, f) => acc + f.size, 0) + form.descricaoBreve.length;
    if (charsEstimados > TOKEN_BLOCK_CHARS) {
      const tokens = Math.round(charsEstimados / 4);
      // Âmbar: é a seleção de arquivos que passou do orçamento, não uma falha do sistema.
      toast.warning(
        `Os arquivos selecionados somam ~${Math.round(tokens / 1000)}k tokens e o limite é ~200k. ` +
        `Remova arquivos ou use o prompt de pré-documentação no Claude AI (painel acima).`,
        { duration: 10000 },
      );
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    setIniciandoChat(true);

    try {
      const docs = await filesToDocs(arquivos);

      const ferramentaEnviada = computeFerramenta();

      const result = await apiFetch<{ projeto_id: string; response: ReturnType<typeof Object.create> }>(
        "/api/chat/iniciar-submissao",
        {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          ferramenta: ferramentaEnviada,
          escopo: form.escopo as "interno" | "externo",
          servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
          membros: form.participantes,
          membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          // Projeto especial não envia tipos financeiros — o backend grava
          // tipos_projeto=["especial"] e o fluxo pula saving/receita.
          tipos_projeto: !form.especial && form.tipoProjeto.length > 0 ? form.tipoProjeto : undefined,
          tipo_projeto: !form.especial ? (form.tipoProjeto[0] || undefined) : undefined,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contrafactual_afetados:
            serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
            undefined,
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
      setDocExistenteInvalidado(false);
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
      toast.error(`Não foi possível iniciar o agente. ${msg}`, { duration: 12000 });
    } finally {
      setIniciandoChat(false);
    }
  }

  /* ── Fluxo DIRETO de liderança: cria o projeto (doc por IA numa passada) e abre
     direto o formulário determinístico de saving/receita, SEM passar pelo agente
     conversacional. Só liderança/admin chega aqui (o botão só aparece p/ eles e o
     servidor reconfere `fluxo_direto`). Espelha handleIniciarAgente na criação. ── */
  async function handleContinuarDireto() {
    if (!validateStep(2)) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    if (arquivos.length === 0) return;

    const charsEstimados =
      arquivos.reduce((acc, f) => acc + f.size, 0) + form.descricaoBreve.length;
    if (charsEstimados > TOKEN_BLOCK_CHARS) {
      const tokens = Math.round(charsEstimados / 4);
      toast.warning(
        `Os arquivos selecionados somam ~${Math.round(tokens / 1000)}k tokens e o limite é ~200k. ` +
        `Remova arquivos ou use o prompt de pré-documentação no Claude AI (painel acima).`,
        { duration: 10000 },
      );
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }

    setIniciandoDireto(true);
    try {
      const docs = await filesToDocs(arquivos);
      const ferramentaEnviada = computeFerramenta();

      const result = await apiFetch<{ projeto_id: string; fluxo_direto?: boolean }>(
        "/api/chat/iniciar-submissao",
        {
          responsavel_nome: form.nome.trim(),
          responsavel_email: form.email.trim(),
          ferramenta: ferramentaEnviada,
          escopo: form.escopo as "interno" | "externo",
          servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
          membros: form.participantes,
          membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          tipos_projeto: form.tipoProjeto.length > 0 ? form.tipoProjeto : undefined,
          tipo_projeto: form.tipoProjeto[0] || undefined,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contrafactual_afetados:
            serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
            undefined,
          // O backend gera a doc por IA numa passada e NÃO inicia o chat.
          fluxo_direto: true,
          docs,
        },
      );

      setProjetoId(result.projeto_id);
      setNomesExistentes(arquivos.map((f) => f.name));
      setDocExistenteInvalidado(false);
      setAgentTipos(form.tipoProjeto);
      setAgentMeta(snapshotMeta());
      setAgentArquivosSig(arquivosSig());

      // Sem chat: vai direto ao formulário determinístico da fase financeira. Se há
      // saving, começa por ele (o "ambos" segue para a receita depois); só receita
      // abre o formulário de receita.
      setChatMessages([]);
      setChatComplete(false);
      setFormDraft(emptyFormDraft());
      setSavingSubmitted(null);
      setReceitaSubmitted(null);
      setApprovedSavingPreview(null);
      setApprovedReceitaPreview(null);
      if (form.tipoProjeto.includes("saving")) {
        setChatFase("saving");
        setShowReceitaForm(false);
        setShowSavingForm(true);
      } else {
        setChatFase("receita");
        setShowSavingForm(false);
        setShowReceitaForm(true);
      }
      setCompletedSteps((prev) => new Set([...prev, 2, 3]));
      goToStep(3, "forward");
    } catch (err) {
      console.error("[submeter] fluxo direto falhou:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Não foi possível preparar a submissão. ${msg}`, { duration: 12000 });
    } finally {
      setIniciandoDireto(false);
    }
  }

  /* ── Projeto especial: cria o projeto e submete direto, pulando o agente ── */
  // Projeto de alto impacto e difícil mensuração não passa pela conversa nem pela
  // análise financeira: a documentação é montada no backend a partir da descrição +
  // contexto especial (sem IA) e segue direto para a base (planilha + banco). A
  // validação é humana.
  async function handleEnviarEspecial() {
    // Triagem do especial (Etapa 2.5): dashboard/painel ou ganho apenas organizacional
    // NÃO é projeto especial. Bloqueio determinístico — a tela já mostra o motivo no
    // clique do "sim", e aqui ele vai pelo MESMO canal dos outros bloqueios de
    // preenchimento (painel âmbar ancorado ao botão + toast curto): é orientação, não
    // falha do sistema, então nunca em vermelho.
    // ⚠️ NÃO chame `setBloqueio` aqui: na Etapa 2.5 o painel do especial é renderizado pelo
    // `step25`, DERIVADO da resposta. Duplicar o mesmo aviso no estado dava DOIS painéis
    // idênticos no primeiro clique e um painel que sobrevivia à troca da resposta.
    // Este ramo é defesa em profundidade — o botão já nasce desabilitado com a triagem
    // bloqueada, então só se chega aqui por teclado/automação.
    if (motivoEspecialAtual) {
      toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    if (!validateStep(2) || !validateEtapa25()) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    if (!editProjetoId && arquivos.length === 0) return;

    setBloqueio(null);
    setEnviandoEspecial(true);
    try {
      const ferramentaEnviada = computeFerramenta();

      if (editProjetoId && projetoId) {
        // Modo edição: atualiza metadados do projeto existente, reconstrói doc especial e reenvia.
        // filesToDocs descarta arquivos vazios; se sobrar zero doc (nada novo ou só
        // vazios), cai no reset_doc — que reusa os arquivos já enviados sem reupload.
        const docs = arquivos.length > 0 ? await filesToDocs(arquivos) : [];

        await apiFetchComRetry("/api/chat/atualizar-metadados", {
          projeto_id: projetoId,
          nome_projeto: form.nomeProjeto.trim(),
          ferramenta: ferramentaEnviada,
          servico_externo: servicoExternoEnviado(),
          membros: form.participantes,
          membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
          data_criacao: form.dataCriacao,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contrafactual_afetados:
            serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
            undefined,
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

      // F2: o background criou um projeto NÃO-especial para ESTA submissão nova. Em vez de
      // recriar (duplicado), CONVERTE em especial via atualizar-metadados (o backend monta
      // buildDocEspecial sem IA e marca chat_completo — ver ramo `ehEspecial`) e submete.
      // Aguarda o disparo em voo para pegar o id real (evita ler projetoId stale).
      let bgIdEspecial: string | null = null;
      if (bgPromiseRef.current) {
        try { bgIdEspecial = await bgPromiseRef.current; } catch { bgIdEspecial = null; }
      }
      const existenteId = bgIdEspecial ?? projetoId;
      if (existenteId) {
        await apiFetchComRetry("/api/chat/atualizar-metadados", {
          projeto_id: existenteId,
          nome_projeto: form.nomeProjeto.trim(),
          ferramenta: ferramentaEnviada,
          servico_externo: servicoExternoEnviado(),
          membros: form.participantes,
          membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
          data_criacao: form.dataCriacao,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contrafactual_afetados:
            serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
            undefined,
          contexto_especial: form.contextoEspecial.trim(),
          // A doc especial é montada da descrição + contexto (sem IA); não precisa reenviar
          // arquivos. reset_doc garante a substituição da doc gerada pelo background.
          especial: true,
          reset_doc: true,
        });
        await apiFetch("/api/chat/submeter-validacao", { projeto_id: existenteId });
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
          membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
          nome_projeto: form.nomeProjeto.trim(),
          data_criacao: form.dataCriacao,
          descricao_breve: form.descricaoBreve.trim() || undefined,
          usa_ai_proxy: form.usaAiProxy || undefined,
          contrafactual_afetados:
            serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
            undefined,
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
      const bloq = bloqueioDoErro(err);
      if (bloq) {
        // Mesmo painel da revisão final, aqui renderizado acima da navegação da Etapa 2.5
        // (é onde mora o botão "Enviar Projeto" do fluxo especial).
        setBloqueio(bloq);
        toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Não foi possível enviar o projeto. ${msg}`, { duration: 12000 });
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
      // Âmbar: é a seleção de arquivos que passou do orçamento, não uma falha do sistema.
      toast.warning(
        `Os arquivos selecionados somam ~${Math.round(tokens / 1000)}k tokens e o limite é ~200k. ` +
        `Remova arquivos ou use o prompt de pré-documentação no Claude AI (painel acima).`,
        { duration: 10000 },
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
          servico_externo: servicoExternoEnviado(),
          membros: meta.participantes,
          membros_papeis: meta.participantesPapeis,
          data_criacao: meta.dataCriacao,
          descricao_breve: meta.descricaoBreve,
          usa_ai_proxy: meta.usaAiProxy || undefined,
          contrafactual_afetados: meta.contrafactualAfetados || undefined,
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
      setDocExistenteInvalidado(false);
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
      toast.error(`Não foi possível reprocessar os arquivos. ${msg}`, { duration: 12000 });
    } finally {
      setContinuando(false);
    }
  }

  /* ── Step 2 → Step 3 (agente já iniciado): propaga mudanças e detecta troca de tipo ── */
  async function handleContinuarAgente() {
    // Projeto especial não tem tipo financeiro — segue direto. Para projeto padrão,
    // não permite avançar sem ao menos um tipo selecionado.
    if (!form.especial && form.tipoProjeto.length === 0) {
      // Só o erro inline + shake: o toast vermelho duplicava, em vermelho, uma frase que já
      // está na tela ao lado do campo.
      setError("tipoProjeto", "Selecione ao menos um tipo de projeto");
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
              servico_externo: servicoExternoEnviado(),
              membros: meta.participantes,
          membros_papeis: meta.participantesPapeis,
              data_criacao: meta.dataCriacao,
              descricao_breve: meta.descricaoBreve,
              usa_ai_proxy: meta.usaAiProxy || undefined,
              contrafactual_afetados: meta.contrafactualAfetados || undefined,
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
          toast.error(`Não foi possível reavaliar a documentação. ${msg}`, { duration: 12000 });
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
            servico_externo: servicoExternoEnviado(),
            membros: meta.participantes,
          membros_papeis: meta.participantesPapeis,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
            usa_ai_proxy: meta.usaAiProxy || undefined,
            contrafactual_afetados: meta.contrafactualAfetados || undefined,
            // Conversão especial→normal: este ramo só roda com form.especial=false,
            // mas mandamos o valor real para o backend zerar a flag no banco.
            especial: form.especial,
          });
          setAgentMeta(meta);
        } catch (e) {
          console.error("[submeter] falha ao atualizar metadados:", e);
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`Não foi possível salvar os dados do projeto. ${msg}`, { duration: 12000 });
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
        toast.error(`Não foi possível salvar o tipo do projeto. ${msg}`, { duration: 12000 });
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
            servico_externo: servicoExternoEnviado(),
            membros: meta.participantes,
          membros_papeis: meta.participantesPapeis,
            data_criacao: meta.dataCriacao,
            descricao_breve: meta.descricaoBreve,
            usa_ai_proxy: meta.usaAiProxy || undefined,
            contrafactual_afetados: meta.contrafactualAfetados || undefined,
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
        toast.error(`Não foi possível retomar o agente. ${msg}`, { duration: 12000 });
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
    // A pessoa voltou a agir → o bloqueio da tentativa anterior deixa de descrever a tela.
    setBloqueio(null);
    setChatLoading(true);
    // Aprovar a doc dispara a compilação (operação pesada) — mostra passos nomeados
    // em vez do loading genérico. Turnos simples de conversa ficam com os 3 pontos.
    setChatLoadingSteps(chatFase === "doc_preview" ? LOADING_STEPS_COMPILAR : null);

    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    // Streaming: a prosa vai chegando token a token e preenchendo uma bolha "viva" do
    // assistente. `streamingIniciado` marca que a bolha já foi criada por um delta. Se o
    // streaming estiver DESLIGADO no servidor, nenhum delta chega, `streamingIniciado` fica
    // false e o fluxo é idêntico ao de antes (a bolha nasce do envelope, no fim).
    let streamingIniciado = false;
    const onDelta = (chunk: string) => {
      if (!streamingIniciado) {
        streamingIniciado = true;
        setChatMessages((prev) => [...prev, { role: "assistant", content: chunk, fase: chatFase }]);
      } else {
        setChatMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: last.content + chunk };
          }
          return copy;
        });
      }
    };

    try {
      const result = await apiStream<ReturnType<typeof Object.create>>(
        "/api/chat/enviar-mensagem",
        { projeto_id: projetoId, content, selected_option: selectedOption },
        { onDelta },
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
        // Envelope canônico: se veio streaming, RECONCILIA a bolha viva (troca o texto
        // provisório pelo `content` final + aplica type/isPreview/isComplete/options);
        // senão, aparece a bolha nova de sempre.
        if (streamingIniciado) {
          setChatMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = assistantMsg;
            return copy;
          });
        } else {
          setChatMessages((prev) => [...prev, assistantMsg]);
        }
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
      // Falha de sistema (o turno não chegou ao servidor) → vermelho, mas tranquilizando:
      // a conversa até aqui está salva e a pessoa só reenvia a última mensagem.
      toast.error(
        `Sua mensagem não foi enviada. ${msg} O restante da conversa está salvo — reenvie a última mensagem.`,
        { duration: 12000 },
      );
      // Remove a última mensagem do usuário — e a bolha do assistente que estava streamando,
      // se houver (senão sobraria uma prosa provisória órfã).
      setChatMessages((prev) => prev.slice(0, streamingIniciado ? -2 : -1));
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
        // abre o formulário de receita; senão, vai para a revisão final — MAS só quando o
        // memorial de saving JÁ foi aprovado (approvedSavingPreview). Sem preview aprovado
        // (ex.: projeto convertido especial→saving cujo chat de saving parou numa pergunta,
        // sem gerar memorial), NÃO marca a conversa como concluída: cai no chat da fase de
        // saving (a pergunta pendente) para o memorial ser concluído. Antes marcava
        // chatComplete direto e o botão "Enviar" aparecia sem memorial → 500 "sem ganho
        // mensurável" mascarado por toast genérico (caso "Supply Lojas <> Estoque CDs").
        if (temReceita) openReceitaForm();
        else if (approvedSavingPreview !== null) setChatComplete(true);
      } else if (temReceita && approvedSavingPreview !== null) {
        // Fluxo "ambos": o usuário reabriu o saving (ex.: via "Voltar ao saving" da
        // receita) e não mudou nada. Como o saving já foi aprovado, volta ao
        // formulário de receita — senão cairia num chat vazio (as mensagens da fase
        // de saving foram limpas na transição para a receita).
        openReceitaForm();
      } else if (!temReceita && approvedSavingPreview !== null) {
        // Submissão nova, só saving: o usuário reabriu o formulário (ex.: via "Refazer"
        // na revisão final) e não mudou nada → volta à revisão final, simétrico à edição.
        // Só quando o memorial já foi aprovado (mesma guarda do ramo de edição).
        setChatComplete(true);
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
          // Liderança: memorial determinístico, sem gates (o servidor reconfere).
          modo_direto: modoDireto || undefined,
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
      // Fluxo DIRETO de liderança: o backend já devolveu o memorial pronto (sem gates,
      // sem chat). Aprova o preview e ou segue para a receita ("ambos") ou vai à revisão
      // final. NÃO entra no chat (nenhuma mensagem de agente é exibida).
      if (modoDireto) {
        setApprovedSavingPreview(result.content ?? null);
        setChatMessages([]);
        if (form.tipoProjeto.includes("receita_incremental")) {
          setChatFase("receita");
          openReceitaForm();
        } else {
          setChatFase("completo");
          setChatComplete(true);
        }
        return;
      }
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
      toast.error(
        `Não foi possível iniciar a análise de impacto. ${msg} Os dados que você preencheu continuam no formulário.`,
        { duration: 12000 },
      );
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
          // Liderança: memorial determinístico, sem gates (o servidor reconfere).
          modo_direto: modoDireto || undefined,
        },
      );
      setShowReceitaForm(false);
      // Registra a receita enviada (detecção de "nada mudou" e edição posterior).
      setReceitaSubmitted(formData);
      // Preview de receita aprovado anteriormente deixa de valer ao reiniciar a fase.
      setApprovedReceitaPreview(null);
      // Fluxo DIRETO de liderança: receita é a última fase → aprova o preview e vai
      // direto à revisão final, sem chat.
      if (modoDireto) {
        setApprovedReceitaPreview(result.content ?? null);
        setChatMessages([]);
        setChatFase("completo");
        setChatComplete(true);
        return;
      }
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
      toast.error(
        `Não foi possível iniciar a análise de receita. ${msg} Os dados que você preencheu continuam no formulário.`,
        { duration: 12000 },
      );
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

  /* ── Refazer o memorial financeiro a partir da revisão final ──────────────────
     Na tela "Enviar para Triagem" a pessoa só conseguia mexer na documentação
     (mandando um arquivo/informação nova, que reprocessa a doc). O memorial
     financeiro já aprovado ficava travado — para trocar cargos/horas/valores era
     preciso recomeçar tudo. Este atalho reabre o formulário determinístico da fase
     financeira (cargos, horas, custos ou receita) SEM tocar na documentação: sai da
     revisão final (`chatComplete=false`) e recoloca o snapshot já enviado, pronto
     para editar. Ao reenviar o formulário, `handleSavingFormSubmit`/`...Receita`
     reiniciam a fase (invalidando o preview antigo) ou, se nada mudou, devolvem à
     revisão final. Só faz sentido quando existe memorial financeiro: projeto
     especial (sem saving/receita) não recebe o botão. */
  function handleReiniciarMemorial() {
    if (chatLoading || submittingProject) return;
    const temSaving = form.tipoProjeto.includes("saving");
    const temReceita = form.tipoProjeto.includes("receita_incremental");
    if (!temSaving && !temReceita) return;
    setBloqueio(null);
    setChatComplete(false);
    if (temSaving) openSavingForm();
    else openReceitaForm();
  }

  /* ── Enviar projeto ──────────────────────────────────────────────────────────
     A análise automática (analisador) NÃO roda mais no cliente: o servidor a
     dispara em background ao submeter (ver worker.ts → ctx.waitUntil). Assim a
     tela de sucesso aparece na hora, a pessoa pode fechar a aba, e o resultado
     fica disponível depois em "Meus Projetos". */
  async function handleSubmitProjeto() {
    if (!projetoId) return;

    // Triagem do especial (Etapa 2.5) — mesma régua e mesma mensagem do
    // `handleEnviarEspecial`. Está aqui porque um projeto marcado como especial também
    // alcança a Etapa 3 (navegação pelo topo / conversão de tipo), e o bloqueio não pode
    // depender de qual botão a pessoa achou primeiro.
    // Idem: quem renderiza o aviso é a Etapa 2.5, para onde devolvemos a pessoa. Sem o
    // `setBloqueio`, o painel de lá é o único e acompanha a resposta.
    const motivoEspecialSubmit = motivoBloqueioEspecial(form);
    if (motivoEspecialSubmit) {
      toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      setShowEtapa25(true);
      goToStep(2, "back");
      return;
    }

    // Rede de segurança (defesa em profundidade): o botão "Enviar" só deveria aparecer
    // com o memorial aprovado, mas se algum caminho marcar a conversa como concluída sem
    // preview (ex.: handoff doc→saving + reload), barramos aqui com orientação clara em
    // vez de deixar o servidor devolver 500 "sem ganho mensurável". Especial não tem
    // memorial financeiro, então não se aplica.
    // Tom âmbar, não vermelho: falta um passo do preenchimento, e o próprio clique já reabre
    // o formulário — a frase diz o que a pessoa vai encontrar na tela.
    if (!form.especial) {
      if (form.tipoProjeto.includes("saving") && approvedSavingPreview === null) {
        toast.warning(
          "Falta aprovar o memorial de saving. Reabri o formulário de impacto — conclua as perguntas do agente até o memorial aparecer.",
          { duration: 10000 },
        );
        setChatComplete(false);
        openSavingForm();
        return;
      }
      if (form.tipoProjeto.includes("receita_incremental") && approvedReceitaPreview === null) {
        toast.warning(
          "Falta aprovar o memorial de receita. Reabri o formulário de receita — conclua as perguntas do agente até o memorial aparecer.",
          { duration: 10000 },
        );
        setChatComplete(false);
        openReceitaForm();
        return;
      }
    }

    // Tentativa nova → o bloqueio anterior deixa de valer (um aviso velho ao lado de uma
    // tentativa nova é pior que nenhum aviso).
    setBloqueio(null);
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
      const bloq = bloqueioDoErro(e);
      if (bloq) {
        // Preenchimento: o texto inteiro (veredito + por que + caminhos) vai para o painel
        // âmbar ancorado no botão, e o toast só chama a atenção para ele. Antes o parágrafo
        // inteiro morava num toast vermelho de 20s.
        setBloqueio(bloq);
        toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      } else {
        const msg = e instanceof Error ? e.message : "";
        // Falha de sistema — aqui o vermelho é informação correta. Sem prefixo "Erro ao…",
        // que empurrava a orientação do servidor para fora da vista.
        toast.error(
          msg
            ? `Não foi possível enviar o projeto. ${msg}`
            : "Não foi possível enviar o projeto: o servidor não respondeu. Nada se perdeu — tente novamente em alguns segundos.",
          { duration: 12000 },
        );
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

  /* ── Apresentação do formulário (submissão nova) ── */
  // Depois do `seedLoading` de propósito: `showIntro` e o seed são mutuamente
  // exclusivos (os 3 sinais são os mesmos), mas se um dia deixarem de ser, é a
  // tela de carregamento que tem de ganhar — a intro na frente de um seed em voo
  // esconderia um projeto sendo restaurado.
  if (showIntro) {
    return <IntroSubmissao onProsseguir={() => setShowIntro(false)} />;
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
                value={form.escopo === "externo" ? form.servicoExterno : computeFerramenta()}
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
          {/* Tela de sucesso: a dúvida deixa de ser "como preencho" e passa a ser "e
              agora?" — daí o link ir para "Acompanhamento e status" (D18). */}
          <PageFooter faq={FAQ_RODAPE.status} />
        </div>
      </PageFrame>
    );
  }

  /* ── Main Form ── */

  // Destino do link do FAQ no rodapé, por etapa (SPEC_FAQ D18). Decidido aqui, e não
  // dentro do `PageFooter`, porque quem sabe em que ponto do formulário a pessoa está é
  // esta tela — o rodapé é só quem desenha.
  const faqDoRodape =
    step === 3
      ? FAQ_RODAPE.memorial
      : step === 2 && showEtapa25
        ? FAQ_RODAPE.especial
        : step === 2
          ? FAQ_RODAPE.financeiro
          : FAQ_RODAPE.indice;

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
            {/* Barra de "chrome" do card: os pontos à esquerda e, à direita, os
                controles discretos de salvar rascunho / recomeçar — só em submissão
                nova (nunca em edição). "Salvar rascunho" só quando já existe rascunho
                no servidor (projetoId; antes do agente iniciar não há nada para
                guardar); "Recomeçar" sempre disponível. Reaproveita a metáfora de
                janela dos BrowserDots em vez de flutuar um botão solto. */}
            <div className="flex items-center justify-between">
              <BrowserDots />
              {!editProjetoId && (
                <div className="flex items-center gap-1">
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
                    readOnlyProjeto={!!editProjetoId}
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
                  onRemoverExistente={handleRemoverExistente}
                  docExistenteInvalidado={docExistenteInvalidado}
                  bgStatus={bgStatus}
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
                  onRespTriagem={handleRespTriagemEspecial}
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
                  // Refazer memorial financeiro na revisão final. Só para projeto
                  // com saving/receita (especial não tem memorial financeiro).
                  onReiniciarMemorial={
                    !form.especial &&
                    (form.tipoProjeto.includes("saving") ||
                      form.tipoProjeto.includes("receita_incremental"))
                      ? handleReiniciarMemorial
                      : undefined
                  }
                  bloqueio={bloqueio}
                  versaoAnterior={versaoAnterior}
                  novoResumo={{
                    nome: form.nomeProjeto.trim(),
                    descricaoBreve: form.descricaoBreve.trim(),
                    ferramenta: computeFerramenta(),
                    tiposProjeto: form.tipoProjeto,
                  }}
                />
              </StepAnimation>
            )}
          </div>

          {/* Bloqueio de envio do fluxo ESPECIAL (o botão "Enviar Projeto" fica na navegação
              da Etapa 2.5). Na etapa 3 o painel é renderizado dentro da revisão final, junto
              do botão "Enviar para Triagem". */}
          {bloqueio && step === 2 && showEtapa25 && !CODIGOS_TRIAGEM_ESPECIAL.includes(bloqueio.codigo) && (
            <div style={{ padding: "0 32px" }}>
              <AvisoBloqueio bloqueio={bloqueio} />
            </div>
          )}

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
                  // Com a triagem bloqueando, o botão fica QUIETO: o painel âmbar logo acima
                  // é a explicação, e um botão que só devolve o mesmo aviso a cada clique
                  // (duplicando-o) não ensina nada. `title` cobre quem chega pelo teclado.
                  disabled={enviandoEspecial || !!motivoEspecialAtual}
                  title={
                    motivoEspecialAtual
                      ? "Envio pausado: revise as respostas da triagem acima."
                      : undefined
                  }
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

              {/* Etapa 2.5 (projeto padrão) — LIDERANÇA (cargo isento): pula o agente.
                  Cria o projeto (doc por IA numa passada) e vai direto ao formulário
                  determinístico de saving/receita. O servidor reconfere a permissão. */}
              {step === 2 && showEtapa25 && respEspecial !== "sim" && modoDireto && (
                <button
                  type="button"
                  onClick={handleContinuarDireto}
                  disabled={iniciandoDireto}
                  title="Como liderança, você segue direto para o preenchimento — sem conversar com o agente."
                  className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                >
                  {iniciandoDireto ? (
                    <>
                      <CyclingText steps={LOADING_STEPS_INICIAR} />
                      <div className="go-spinner" />
                    </>
                  ) : (
                    <span>Continuar &rarr;</span>
                  )}
                </button>
              )}

              {/* Etapa 2.5 (projeto padrão): inicia o agente (1ª vez) ou retoma (re-entrada). */}
              {step === 2 && showEtapa25 && respEspecial !== "sim" && !modoDireto && (
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

        {/* O rodapé aponta para a seção do FAQ que responde a dúvida DESTA etapa (D18):
            Etapa 1 → índice · Etapa 2 → como o ganho é medido · Etapa 2.5 → projeto
            especial · Etapa 3 → o ganho tem de ser real e medido. */}
        <PageFooter faq={faqDoRodape} />
      </div>

      {showRascunhoConfirm && (
        <SalvarRascunhoModal
          onClose={() => setShowRascunhoConfirm(false)}
          onConfirmar={handleSalvarRascunho}
          processando={salvandoRascunho}
        />
      )}
      {showResetConfirm && (
        <ConfirmarRecomecoModal
          onClose={() => setShowResetConfirm(false)}
          onConfirmar={handleRecomecar}
          processando={recomecando}
        />
      )}
    </PageFrame>
  );
}
