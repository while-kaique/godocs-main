import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, FolderClock, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTituloPagina } from "@/lib/use-titulo-pagina";
import { SECAO } from "@/lib/titulo-pagina";
import { apiFetch, apiStream, ApiError, setDemoBackend } from "@/lib/api-client";
import { criarDemoBackend, demoSeedForm, demoFile, CHAVE_TESTE_LIDERANCA, type FluxoDemo } from "@/lib/fluxos/demo-backend";
import { AvisoBloqueio } from "@/components/aviso-bloqueio";
import type { BloqueioSubmissao } from "@/lib/mensagens-submissao";

import {
  filesToDocs, TOKEN_BLOCK_CHARS,
  parseMoedaBR, numeroParaMoedaBR, montarMembrosPapeis, montarMembrosContribuicoes,
  validarEtapa1,
  validarEtapa2, validarSelecaoGanho, camposMinimosDocProntos, serializarAfetados, desserializarAfetados,
  limitarCoautorUnico, deveMostrarIntro,
  serializarFerramentas, desserializarFerramentas,
} from "@/lib/submeter/constants";
import type { FormData, FieldErrors, PapelParticipante } from "@/lib/submeter/constants";
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
import { Step3Ganhos } from "@/lib/submeter/step3-ganhos";
import { SelecaoGanho } from "@/lib/submeter/selecao-ganho";
import { RevisaoGanhos } from "@/lib/submeter/revisao-ganhos";
import {
  ganhosFormVazio,
  paraGanhosDeclarados,
  validarEtapa3,
  type GanhosFormData,
} from "@/lib/submeter/validacao-etapa3";
import {
  desserializarCategorias,
  desserializarCustoRodar,
  desserializarLinhasHoras,
} from "@/lib/ganhos";
import { GANHO_ROTULOS } from "@/lib/ganhos-rotulos";
import { hojeIso } from "@/lib/calendario-datas";
import { anexosUteis } from "@/lib/submeter/evidencia";
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
  // O que cada participante fez (e-mail→texto). Entra no meta pelo MESMO motivo dos
  // papéis: mudar o texto tem de disparar metaChanged e ser persistido via
  // `atualizar-metadados`, senão a correção no meio do chat morre na tela.
  participantesContribuicoes: Record<string, string>;
  descricaoBreve: string;
  // Usa o AI Proxy interno? Entra no meta para que uma mudança dispare metaChanged.
  usaAiProxy: "sim" | "nao" | "";
  // App no GoDeploy (Etapa 2, opcional) — no meta pelo mesmo motivo: colar o link no meio
  // do fluxo tem de disparar metaChanged e ser persistido via `atualizar-metadados`.
  temAppGodeploy: "sim" | "nao" | "";
  urlGodeploy: string;
  // Contrafactual (Etapa 2). `contrafactualAfetados` viaja SERIALIZADO
  // ("pessoa:a@x;b@y") para a comparação de metaChanged ser estável — é o mesmo formato
  // gravado no SQLite.
  contrafactualAfetados: string;
  // Projeto especial: o contexto especial é entrada determinística da fase de doc.
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

  // ── Etapa 3 (v2): os blocos de ganho ──
  // Não há mais estado de CONVERSA aqui (nem mensagens, nem fase, nem preview aprovado):
  // o agente saiu do caminho do usuário (D4). O que sobra é o formulário determinístico,
  // cuja régua vive em `validacao-etapa3.ts`.
  const [ganhos, setGanhos] = useState<GanhosFormData>(ganhosFormVazio);
  // Revisão antes do envio: a Etapa 3 valida, mostra o resumo e só então envia — o clique
  // que dispara a submissão não pode ser o mesmo que descobre que falta preencher algo.
  const [revisando, setRevisando] = useState(false);
  // Qual das telas da Etapa 3 está no ar. A 1ª é a SELEÇÃO dos tipos de ganho (que era um
  // campo no fim da Etapa 2 e virou tela própria — ver `selecao-ganho.tsx`); a 2ª são os
  // blocos. Entrar na Etapa 3 sempre começa pela seleção, porque é ela que decide quais
  // blocos existem — e é assim que ela aparece também no sandbox `/fluxos`, onde o
  // formulário nasce pré-preenchido.
  const [telaGanho, setTelaGanho] = useState<"tipos" | "blocos">("tipos");
  // Loading do avanço Etapa 2 → 3 (garante o projeto criado antes de abrir os blocos).
  const [avancando, setAvancando] = useState(false);
  const [projetoId, setProjetoId] = useState<string | null>(null);
  // Tipo(s) com que o fluxo do agente está alinhado — usado para detectar troca
  // de tipo (saving ↔ receita) quando o usuário volta à etapa 2 no meio do fluxo.
  // Metadados + assinatura dos arquivos com que o agente está alinhado (item:
  // propagar mudanças de metadado/arquivos ao agente).
  const [agentMeta, setAgentMeta] = useState<AgentMeta | null>(null);
  const [agentArquivosSig, setAgentArquivosSig] = useState<string>("");
  // Snapshot da versão anterior — capturado uma vez no seed, nunca sobrescrito.
  // Usado na tela de comparação antes/depois do FinalReview.
  const [versaoAnterior, setVersaoAnterior] = useState<VersaoSnapshot | null>(null);
  // Passos nomeados exibidos no chat durante operações pesadas (null = 3 pontinhos).
  // Fluxo DIRETO de liderança: loading do botão "Enviar direto" (cria projeto + doc por IA).
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
  // Projeto especial: envio direto (cria projeto + submete), pulando o agente.
  const [submittingProject, setSubmittingProject] = useState(false);
  // Rascunho do formulário de impacto (SavingForm) — vive no pai para persistir
  // quando o usuário navega para fora da etapa 3 e volta (o step 3 desmonta).
  // Snapshots do que foi enviado em cada fase financeira (separados para o fluxo
  // "ambos": permite editar o saving mesmo já estando na receita). Reenvio idêntico
  // ao snapshot volta ao chat sem reanalisar. O de saving sobrevive à transição
  // saving→receita; o de receita reseta ao (re)entrar na fase de receita.
  // Números finais recalculados pelo servidor na submissão — usados no comparativo
  // numérico antes×depois da tela de sucesso (somente edição, quando há versão anterior).
  const [ganhoFinal, setGanhoFinal] = useState<GanhoFinal | null>(null);
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

        // O que cada participante fez: seed do texto já escrito, com o MESMO lookup
        // tolerante a caixa dos papéis. Legado/projeto anterior à feature vem vazio — a
        // validação da Etapa 1 cobra o texto de todos antes de avançar.
        const contribSeed = (data.membros_contribuicoes as Record<string, string>) ?? {};
        const contribLower: Record<string, string> = {};
        for (const [k, v] of Object.entries(contribSeed)) contribLower[k.toLowerCase()] = v;
        const participantesContribuicoes: FormData["participantesContribuicoes"] = {};
        for (const email of membros) {
          participantesContribuicoes[email] =
            contribSeed[email] ?? contribLower[email.toLowerCase()] ?? "";
        }

        // Contrafactual: a lista de afetados é gravada serializada ("pessoa:a@x;b@y").
        const afetadosSeed = desserializarAfetados(data.contrafactual_afetados as string | null);

        const newForm: FormData = {
          escopo: ((data.escopo as string) ?? "interno") as FormData["escopo"],
          prodStatus: "sim",
          nome: (data.responsavel_nome as string) ?? "",
          email: (data.responsavel_email as string) ?? "",
          ferramentas,
          ferramentaOutra,
          servicoExterno: (data.servico_externo as string) ?? "",
          emEquipe: membros.length > 0 ? "sim" : "nao",
          participantes: membros,
          participantesPapeis,
          participantesContribuicoes,
          nomeProjeto: (data.nome_projeto as string) ?? "",
          // v2: as categorias vêm da coluna `ganho_categorias` (JSON). A leitura NUNCA
          // lança e nunca inventa categoria — projeto gravado antes da v2 simplesmente
          // volta sem nenhuma, e a Etapa 2 cobra a escolha.
          ganhoCategorias: desserializarCategorias(data.ganho_categorias as string | null),
          descricaoBreve: (data.descricao_breve as string) ?? "",
          usaAiProxy: ((data.usa_ai_proxy as string) ?? "") as FormData["usaAiProxy"],
          contrafactualAfetadosTipo: afetadosSeed.tipo,
          contrafactualAfetados: afetadosSeed.lista,
          // Vínculo de FEATURE é read-only na edição (só a submissão nova o cria). O
          // prefixo "[feature de <pai>]" no nome já mostra o vínculo; aqui só semeamos o
          // estado para o step1 exibir a referência.
          // ⚠️ Os campos do ESPECIAL que a branch de origem semeava aqui NÃO voltaram: a v2
          // os removeu do formulário (D5 — especial passou a ser derivado da estrela).
          vinculo: (data.projeto_pai_id as string | null) ? "feature" : "novo",
          paiId: (data.projeto_pai_id as string | null) ?? "",
          // O NOME do pai não vem no seed (o backend devolve só o id) — e não precisa: o
          // prefixo "[feature de <pai>]" já está no nome do projeto, e na edição o vínculo
          // é read-only.
          paiNome: "",
          temAppGodeploy: (data.url_godeploy as string | null) ? "sim" : "",
          urlGodeploy: (data.url_godeploy as string | null) ?? "",
        };

        setForm(newForm);
        setNomesExistentes((data.arquivos_nomes as string[]) ?? []);
        setProjetoId(id);

        // ── Etapa 3: repõe os blocos de ganho das colunas da v2 ──
        // ⚠️ Os valores voltam com MÁSCARA BR (`numeroParaMoedaBR`): a coluna guarda
        // número, o input mostra "1.234,56", e reabrir com o número cru faria a máscara
        // reler "1234.56" como centavos na primeira tecla digitada.
        const moeda = (v: unknown) =>
          v != null && v !== "" ? numeroParaMoedaBR(Number(v)) : "";
        const freq = (v: unknown) => ((v as string) ?? "") as GanhosFormData["savingFrequencia"];
        setGanhos({
          ...ganhosFormVazio(),
          // ⚠️ O par antes/agora vem das colunas NOVAS. `saving_efetivado_valor` e
          // `_desde` são LEGADO (nunca escritos — ver `schema.ts`): não semear deles.
          savingValorAntes: moeda(data.saving_efetivado_valor_antes),
          savingValorAgora: moeda(data.saving_efetivado_valor_agora),
          savingFrequencia: freq(data.saving_efetivado_frequencia),
          savingEvidencia: (data.saving_efetivado_evidencia as string) ?? "",
          ceFrequencia: freq(data.custo_evitado_frequencia),
          ceLinhas: (() => {
            const linhas = desserializarLinhasHoras(
              data.custo_evitado_horas_linhas as string | null,
            ).map((l) => ({
              funcao: l.funcao,
              funcaoDescricao: l.funcaoDescricao ?? "",
              horasAntes: String(l.horasAntes),
              horasDepois: String(l.horasDepois),
            }));
            return linhas.length > 0 ? linhas : ganhosFormVazio().ceLinhas;
          })(),
          ceNaoContratado: moeda(data.custo_evitado_nao_contratado),
          ceRacional: (data.custo_evitado_racional as string) ?? "",
          receitaValor: moeda(data.receita_incremental_valor),
          receitaFrequencia: freq(data.receita_incremental_frequencia),
          receitaRacional: (data.receita_incremental_racional as string) ?? "",
          imensuravelRacional: (data.ganho_imensuravel_racional as string) ?? "",
          custoRodar: (() => {
            const itens = desserializarCustoRodar(data.custo_rodar_itens as string | null).map(
              (i) => ({
                nome: i.nome,
                valor: numeroParaMoedaBR(i.valor),
                frequencia: i.frequencia as GanhosFormData["custoRodar"][number]["frequencia"],
                descricao: i.oQueE,
              }),
            );
            return itens.length > 0 ? itens : ganhosFormVazio().custoRodar;
          })(),
        });

        // Doc preview não existe mais como tela (a doc é invisível — D6), mas o snapshot
        // congelado da última versão segue alimentando a comparação antes/depois.
        const ultimaVersao = data.ultima_versao as VersaoSnapshot | null;
        if (ultimaVersao) setVersaoAnterior(ultimaVersao);

        // Snapshot do agentMeta para não reprocessar a doc se nada mudou.
        setAgentMeta({
          nomeProjeto: newForm.nomeProjeto.trim(),
          ferramenta: newForm.escopo === "externo"
            ? newForm.servicoExterno.trim()
            : serializarFerramentas(newForm.ferramentas, newForm.ferramentaOutra),
          participantes: newForm.participantes,
          participantesPapeis: montarMembrosPapeis(newForm.participantes, newForm.participantesPapeis),
          participantesContribuicoes: montarMembrosContribuicoes(
            newForm.participantes,
            newForm.participantesContribuicoes,
          ),
          descricaoBreve: newForm.descricaoBreve.trim(),
          temAppGodeploy: newForm.temAppGodeploy,
          urlGodeploy: newForm.urlGodeploy,
          usaAiProxy: newForm.usaAiProxy,
          contrafactualAfetados: serializarAfetados(
            newForm.contrafactualAfetadosTipo,
            newForm.contrafactualAfetados,
          ),
        });

        // A edição ABRE na Etapa 1 (participantes/papéis são o foco). As Etapas 1 e 2 já
        // contam como alcançadas (clicáveis no topo).
        setStep(1);
        setCompletedSteps(new Set([1, 2]));
  }, []);

  // Repõe o estado do wizard a partir do snapshot local (mesmo navegador) —
  // retomada fiel de um rascunho ao atualizar/voltar à página, sem ida ao servidor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rehydrateFromLocal = useCallback((d: DraftSnapshot) => {
    // ⚠️ Rascunho SALVO ANTES de um campo novo existir não tem a chave — espalhar o
    // objeto cru deixa o campo `undefined` e qualquer `.join()/.some()/.length` derruba a
    // tela inteira (bug real: /submeter em branco com "This page didn't load"). TODO campo
    // novo precisa de default aqui.
    setForm({
      ...d.form,
      participantesPapeis: d.form.participantesPapeis ?? {},
      participantesContribuicoes: d.form.participantesContribuicoes ?? {},
      contrafactualAfetadosTipo: d.form.contrafactualAfetadosTipo ?? "pessoa",
      contrafactualAfetados: d.form.contrafactualAfetados ?? [],
      // Rascunho da v1 não tem as categorias (tinha `tipoProjeto` + `especial`). Volta
      // VAZIO de propósito: converter "saving" → "saving_efetivado" seria adivinhar a
      // régua D1 no lugar da pessoa, e a régua D1 é justamente o que a v2 pergunta.
      ganhoCategorias: d.form.ganhoCategorias ?? [],
      ferramentas: d.form.ferramentas ?? desserializarFerramentas(
        (d.form as unknown as { ferramenta?: string }).ferramenta,
      ).ferramentas,
    });
    setNomesExistentes(d.nomesExistentes ?? []);
    setDocExistenteInvalidado(d.docExistenteInvalidado ?? false);
    setProjetoId(d.projetoId);
    setCompletedSteps(new Set(d.completedSteps ?? [1, 2]));
    setAgentMeta((d.agentMeta as AgentMeta | null) ?? null);
    setAgentArquivosSig(d.agentArquivosSig ?? "");
    // Blocos de ganho: rascunho da v1 não os tem — cai no formulário em branco.
    setGanhos(d.ganhos ?? ganhosFormVazio());
    // A revisão NUNCA volta aberta: ela afirma "confira e envie" sobre dados que podem
    // ter sido restaurados pela metade, e o clique seguinte submete.
    setRevisando(false);
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
        // ⚠️ A retomada cross-device NÃO repõe mais histórico de conversa: não existe
        // conversa (D4). O `applySeed` acima já traz os blocos de ganho das colunas, que
        // é o estado que a pessoa tinha. A rota `/api/chat/historico/:id` continua
        // existindo para o Investigador, mas o formulário não a consome.
        if (!cancelled) {
          setStep(3);
          setCompletedSteps(new Set([1, 2, 3]));
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
    participantesContribuicoes: {},
    nomeProjeto: "",
    ganhoCategorias: [],
    descricaoBreve: "",
    usaAiProxy: "",
    temAppGodeploy: "",
    urlGodeploy: "",
    contrafactualAfetadosTipo: "pessoa",
    contrafactualAfetados: [],
    vinculo: "novo",
    paiId: "",
    paiNome: "",
  });

  // Título da aba. Esta tela é a MESMA em dois modos (nova submissão × edição), e é
  // comum ter as duas abertas — o rótulo separa uma da outra. Enquanto o projeto não
  // tem nome, a etapa é o detalhe útil ("Nova submissão · Etapa 2").
  useTituloPagina(
    demoFluxo ? SECAO.fluxos : editProjetoId ? SECAO.editar : SECAO.submeter,
    form.nomeProjeto.trim() || `Etapa ${step}`,
  );

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
  // ⚠️ O "fluxo direto de liderança" DEIXOU DE EXISTIR como bifurcação: na v2 não há
  // agente no caminho de ninguém (D4), então o caminho determinístico é o único e a
  // liderança não precisa de um atalho para escapar da conversa. `ehLiderancaEfetivo`
  // sobrevive porque o perfil ainda decide o que o analisador pode fazer com o projeto.

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
      agentMeta,
      agentArquivosSig,
      ganhos,
    }, editProjetoId ? editDraftKey(editProjetoId) : undefined);
  }, [
    editProjetoId, projetoId, submitted, seedLoading, step, form, nomesExistentes,
    docExistenteInvalidado, completedSteps, agentMeta, agentArquivosSig, ganhos,
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
    temAppGodeploy: form.temAppGodeploy,
    urlGodeploy: form.urlGodeploy,
    nomeProjeto: form.nomeProjeto.trim(),
    ferramenta: computeFerramenta(),
    participantes: form.participantes,
    participantesPapeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
    participantesContribuicoes: montarMembrosContribuicoes(
      form.participantes,
      form.participantesContribuicoes,
    ),
    descricaoBreve: form.descricaoBreve.trim(),
    usaAiProxy: form.usaAiProxy,
    contrafactualAfetados: serializarAfetados(
      form.contrafactualAfetadosTipo,
      form.contrafactualAfetados ?? [],
    ),
  }), [form.nomeProjeto, form.participantes, form.participantesPapeis, form.participantesContribuicoes, form.descricaoBreve, form.usaAiProxy, form.contrafactualAfetadosTipo, form.contrafactualAfetados, computeFerramenta]);

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
        // Rota SSE: `apiStream` trata tanto event-stream (flag ON) quanto JSON (flag OFF).
        // A compilação da doc é SILENCIOSA (não streama prosa) — só aguardamos o envelope.
        const result = await apiStream<{ projeto_id: string; response: ReturnType<typeof Object.create> }>(
          "/api/chat/iniciar-submissao",
          {
            responsavel_nome: form.nome.trim(),
            responsavel_email: form.email.trim(),
            ferramenta: ferramentaEnviada,
            escopo: form.escopo as "interno" | "externo",
            servico_externo: form.escopo === "externo" ? form.servicoExterno.trim() : undefined,
            membros: form.participantes,
            membros_papeis: montarMembrosPapeis(form.participantes, form.participantesPapeis),
            membros_contribuicoes: montarMembrosContribuicoes(
              form.participantes,
              form.participantesContribuicoes,
            ),
            nome_projeto: form.nomeProjeto.trim(),
            // ⚠️ SEM `data_criacao`: o campo saiu do formulário na v2 (a data que vale é a
            // de SUBMISSÃO). E sem tipos/categorias: a fase de doc não depende delas — o
            // ganho declarado é gravado no envio, pela rota própria.
            projeto_pai_id: form.vinculo === "feature" && form.paiId ? form.paiId : undefined,
            descricao_breve: form.descricaoBreve.trim() || undefined,
            usa_ai_proxy: form.usaAiProxy || undefined,
            url_godeploy: form.temAppGodeploy === "sim" ? form.urlGodeploy.trim() || undefined : undefined,
            contrafactual_afetados:
              serializarAfetados(form.contrafactualAfetadosTipo, form.contrafactualAfetados ?? []) ||
              undefined,
            docs,
          },
        );
        setProjetoId(result.projeto_id);
        setNomesExistentes(arquivos.map((f) => f.name));
        setAgentMeta(snapshotMeta());
        setAgentArquivosSig(arquivosSig());
        // ⚠️ A resposta do servidor NÃO vira mensagem na tela: a documentação é invisível
        // (D6). O que interessa aqui é só o `projeto_id` — a doc segue compilando por
        // trás e, se não terminar, o cron reconcilia.
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
    // Sair da Etapa 3 fecha a revisão: ela afirma "confira e envie" sobre um estado que a
    // pessoa vai justamente voltar para mudar.
    if (target !== 3) {
      setRevisando(false);
      // Sair da Etapa 3 rearma a seleção: quem volta para mexer na descrição reentra pela
      // tela que decide os blocos, com o que marcou ainda marcado.
      setTelaGanho("tipos");
    }
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
    // Ir para a Etapa 3 pelo topo usa o MESMO caminho do botão: valida a Etapa 2, garante
    // o projeto criado e propaga os metadados. Sem isto, a navegação pelo índice pularia a
    // sincronização e o servidor ficaria sem a descrição/AI Proxy que a pessoa digitou.
    if (target === 3) {
      void handleAvancarParaGanhos();
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

  /* ── Step 2 → Step 3 ────────────────────────────────────────────────────────
     Garante que o projeto EXISTE antes de abrir os blocos de ganho, e propaga o que a
     pessoa digitou depois do disparo em background.

     ⚠️ Não espera a DOCUMENTAÇÃO (D6): ela vem sendo compilada desde que o arquivo foi
     anexado e continua rodando enquanto a pessoa preenche a Etapa 3. Se não terminar
     antes do envio, o cron reconcilia — a submissão nunca fica presa na IA, que é o
     critério de aceitação nº 1 do plano. */
  async function handleAvancarParaGanhos() {
    if (!validateStep(2)) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    setAvancando(true);
    try {
      let id = projetoId;
      if (!id) {
        // ⚠️ Se o background está EM VOO, espera por ele em vez de disparar de novo:
        // criar um segundo projeto aqui deixaria um órfão no banco a cada avanço rápido.
        id = bgPromiseRef.current ? await bgPromiseRef.current : null;
        if (!id) id = await dispararDocBackground();
      }
      if (!id) {
        toast.error(
          "Não foi possível registrar o projeto agora. Nada se perdeu — tente novamente em alguns segundos.",
          { duration: 10000 },
        );
        return;
      }
      await sincronizarMetadados(id);
      setRevisando(false);
      setTelaGanho("tipos");
      goToStep(3, "forward");
    } finally {
      setAvancando(false);
    }
  }

  /* ── Etapa 3, tela 1 (seleção dos tipos) → tela 2 (os blocos) ──
     Portão puro `validarSelecaoGanho`: ao menos um tipo, e imensurável sem mistura. Sem
     I/O — o projeto já foi criado no avanço da Etapa 2. */
  function handleAvancarParaBlocos() {
    const errs = validarSelecaoGanho(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    setTelaGanho("blocos");
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Propaga metadados/arquivos ao servidor, só quando algo mudou ──
     O disparo em background acontece assim que há arquivo + nome (`camposMinimosDocProntos`),
     então descrição, AI Proxy e "quem sentiria falta" normalmente são digitados DEPOIS.
     Este é o ponto em que eles chegam ao servidor. Falha aqui NÃO barra o avanço: os dados
     estão no formulário e voltam no envio; travar a navegação por causa da sincronização
     seria trocar um dado incompleto por uma submissão impossível. */
  async function sincronizarMetadados(id: string) {
    const meta = snapshotMeta();
    const sigArquivos = arquivosSig();
    const metaMudou = JSON.stringify(meta) !== JSON.stringify(agentMeta);
    const arquivosMudaram = sigArquivos !== agentArquivosSig;
    if (!metaMudou && !arquivosMudaram) return;

    try {
      const docs = arquivosMudaram && arquivos.length > 0 ? await filesToDocs(arquivos) : undefined;
      await apiFetchComRetry("/api/chat/atualizar-metadados", {
        projeto_id: id,
        nome_projeto: meta.nomeProjeto,
        ferramenta: meta.ferramenta,
        servico_externo: servicoExternoEnviado(),
        membros: meta.participantes,
        membros_papeis: meta.participantesPapeis,
        membros_contribuicoes: meta.participantesContribuicoes,
        descricao_breve: meta.descricaoBreve,
        usa_ai_proxy: meta.usaAiProxy || undefined,
        url_godeploy: meta.temAppGodeploy === "sim" ? meta.urlGodeploy.trim() || undefined : undefined,
        contrafactual_afetados: meta.contrafactualAfetados || undefined,
        ...(docs ? { docs } : {}),
      });
      setAgentMeta(meta);
      setAgentArquivosSig(sigArquivos);
      if (docs) {
        setNomesExistentes(arquivos.map((f) => f.name));
        setDocExistenteInvalidado(false);
      }
    } catch (e) {
      console.warn("[submeter] falha ao sincronizar metadados (segue para a Etapa 3):", e);
    }
  }

  /* ── Etapa 3 → revisão ──
     O clique que dispara a submissão não pode ser o mesmo que descobre que falta
     preencher algo: aqui validamos e mostramos o resumo; o envio é o clique seguinte. */
  function handleRevisar() {
    const errs = validarEtapa3(form.ganhoCategorias ?? [], ganhos, { hojeISO: hojeIso() });
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setShaking(true);
      setTimeout(() => setShaking(false), 350);
      return;
    }
    setBloqueio(null);
    setRevisando(true);
    formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmitProjeto() {
    if (!projetoId) return;

    // Rede de segurança: a revisão só abre com a Etapa 3 válida, mas revalidamos antes de
    // enviar — o estado pode ter mudado entre os dois cliques (voltar, editar, reabrir).
    const errs = validarEtapa3(form.ganhoCategorias ?? [], ganhos, { hojeISO: hojeIso() });
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setRevisando(false);
      toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      return;
    }

    // Tentativa nova → o bloqueio anterior deixa de valer (um aviso velho ao lado de uma
    // tentativa nova é pior que nenhum aviso).
    setBloqueio(null);
    setSubmittingProject(true);

    try {
      // 1) Grava o ganho declarado. Vem ANTES da submissão porque é o que o servidor
      //    recompõe para calcular o impacto — submeter sem isto daria projeto sem ganho.
      await apiFetch("/api/submeter/ganhos", {
        projeto_id: projetoId,
        ganhos: paraGanhosDeclarados(form.ganhoCategorias ?? [], ganhos),
        // Os anexos de evidência sobem como os documentos do projeto (Drive). Os vazios
        // são descartados aqui: base64 em branco estoura o zod do servidor.
        anexos: [
          ...anexosUteis(ganhos.savingAnexos),
          ...anexosUteis(ganhos.receitaAnexos),
          ...anexosUteis(ganhos.imensuravelAnexos),
        ],
      });

      // 2) Submete para a triagem.
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
        // âmbar ancorado no botão, e o toast só chama a atenção para ele.
        setBloqueio(bloq);
        toast.warning(TOAST_ENVIO_PAUSADO, { duration: 6000 });
      } else {
        const msg = e instanceof Error ? e.message : "";
        // Falha de sistema — aqui o vermelho é informação correta.
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
    return <IntroSubmissao onProsseguir={() => setShowIntro(false)} demo={!!demoFluxo} />;
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
              <SummaryRow label="Status" value="Aguardando análise" badge last />
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
            {step === 2 && (
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
            {step === 3 && (
              <StepAnimation direction={direction}>
                {revisando ? (
                  <RevisaoGanhos
                    form={form}
                    ganhos={ganhos}
                    bloqueio={bloqueio}
                    submitting={submittingProject}
                    onEditar={() => setRevisando(false)}
                    onEnviar={handleSubmitProjeto}
                    ferramenta={computeFerramenta()}
                  />
                ) : telaGanho === "tipos" ? (
                  <SelecaoGanho
                    categorias={form.ganhoCategorias ?? []}
                    erro={errors.ganhoCategorias}
                    onChange={(proximas) => updateField("ganhoCategorias", proximas)}
                    onLimparErro={() => clearError("ganhoCategorias")}
                    onVoltar={() => goToStep(2, "back")}
                    onProximo={handleAvancarParaBlocos}
                  />
                ) : (
                  <Step3Ganhos
                    categorias={form.ganhoCategorias ?? []}
                    dados={ganhos}
                    errors={errors}
                    onChange={(patch) => setGanhos((atual) => ({ ...atual, ...patch }))}
                    onSubmit={handleRevisar}
                    onVoltar={() => setTelaGanho("tipos")}
                    loading={submittingProject}
                  />
                )}
              </StepAnimation>
            )}
          </div>

          {/* Bloqueio de envio do fluxo ESPECIAL (o botão "Enviar Projeto" fica na navegação
              da Etapa 2.5). Na etapa 3 o painel é renderizado dentro da revisão final, junto
              do botão "Enviar para Triagem". */}
          {/* Navegação. A Etapa 3 tem os botões dela dentro do próprio componente (e a
              revisão tem os seus), por isso ela fica fora daqui. */}
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

              {/* Etapa 2 → Etapa 3. Um botão só: a Etapa 2.5 (tipo de projeto + triagem do
                  especial) saiu, e o "Analisar com Agente" não existe mais — o ganho é
                  declarado num formulário, não conversado. */}
              {step === 2 && (
                <button
                  type="button"
                  onClick={handleAvancarParaGanhos}
                  disabled={avancando}
                  className={cn("go-btn-next inline-flex items-center justify-center gap-2", shaking && "go-shake")}
                >
                  {avancando ? (
                    <>
                      <span>Preparando…</span>
                      <div className="go-spinner" />
                    </>
                  ) : (
                    <span>Próximo &rarr;</span>
                  )}
                </button>
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
