// Fila de PRÉ-APROVAÇÃO do líder (F1 da SPEC_APROVACAO_LIDER).
//
// A pessoa que lidera um time vê aqui os projetos do time esperando a leitura dela e
// dá o parecer sem sair da tela: o card já traz dono, participantes, saving e memorial
// (pedido do Lucas, 03/08/2026 — "o mais fácil, rápido e intuitivo possível pro líder").
//
// Antes de decidir, o líder responde 3 perguntas de sim/não (CHECKLIST_APROVACAO) — é
// o que só quem conhece a área sabe responder, e é o que a triagem da equipe RPA lê.
//
// Nomenclatura: é PRÉ-aprovação, nunca "aprovação". O parecer do líder não decide o
// projeto e não trava a triagem da RPA (D3) — a copy repete isso onde o líder decide.
//
// DOIS CARDS, UMA FILA (17/08/2026): submissão nova e EDIÇÃO não se leem do mesmo jeito.
// Na submissão o líder conhece o projeto agora, então o card apresenta tudo. No reenvio ele
// JÁ leu — o que ele precisa é a diferença. `CardEdicao` inverte a hierarquia: o que mudou
// vem na frente, em "antes → depois"; o que não mudou vai para um bloco fechado; e texto
// longo (memorial, documentação) abre só quando ele pede. Quem escolhe o card é o SERVIDOR
// (`item.edicao`), nunca o líder — ele não deveria ter de saber em que caso está.
//
// UM PROJETO POR VEZ (slider, 04/08/2026): com 12 projetos na fila, a lista empilhada
// obrigava o líder a rolar procurando onde parou. Agora a fila avança como as etapas do
// formulário — decide, cai no próximo pendente — e a barra de posição no topo diz onde
// ele está ("Projeto 3 de 12") e o que já resolveu. O total NÃO encolhe ao decidir: a
// fila é a de quando ele abriu a tela, então "3 de 12" continua sendo 3 de 12 e ele pode
// voltar para rever o próprio parecer.
//
// Identidade GoGroup (header azul + onda creme + cards brancos, Poppins). Estado NUNCA
// só por cor: rótulo + ícone sempre.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTituloPagina } from "@/lib/use-titulo-pagina";
import { SECAO } from "@/lib/titulo-pagina";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import { SimpleMarkdown } from "@/lib/submeter/step3-chat";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  AVISO_SAVING_INCOERENTE,
  CHECKLIST_APROVACAO,
  JUSTIFICATIVA_POR_CHAVE,
  bloqueiaPreAprovacao,
  chavesQueExigemJustificativa,
  checklistCompleto,
  type ChaveChecklist,
  type RespostaChecklist,
} from "@/lib/aprovacoes-checklist";
import { TIPOS_PROJETO_LABEL, TIPO_SAVING_LABEL, fmtHoras, fmtReais } from "@/lib/projeto-rotulos";
import type { CampoComparado } from "@/lib/diff-versoes";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Equal,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  CircleX,
  MessageSquareWarning,
  Minus,
  PencilLine,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  User,
  Users,
} from "lucide-react";

type Participante = { nome: string; email: string; papel: string };

type ItemAprovacao = {
  projeto_id: string;
  projeto_nome: string | null;
  autor_nome: string | null;
  autor_email: string | null;
  area: string | null;
  submitted_at: string | null;
  tipos_projeto: string[];
  especial: boolean;
  criado_em: string | null;
  descricao_breve: string | null;
  participantes: Participante[];
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  ganho_total: number | null;
  custo_evitado_reais: number | null;
  custo_externo_mensal: number | null;
  receita_mensal: number | null;
  memorial: string | null;
  resumo: string | null;
  /** Preenchido só quando o item é uma EDIÇÃO (reenvio) — ver `CardEdicao`. */
  edicao: Edicao | null;
};

/** O reenvio como o servidor o entrega (`EdicaoAprovacao` em aprovacoes.functions.ts). */
type Edicao = {
  versao: number;
  versao_anterior: number | null;
  reenviado_em: string | null;
  anterior_em: string | null;
  /** false = não há snapshot da versão anterior; a tela DIZ isso e mostra o card completo. */
  comparavel: boolean;
  mudancas: CampoComparado[];
  iguais: CampoComparado[];
};

type Fila = {
  lidera: boolean;
  itens: ItemAprovacao[];
  /** E-mail da fila que estou vendo, quando um admin abre com `?como=` (validação). */
  visualizando_como?: string | null;
};

type Respostas = Partial<Record<ChaveChecklist, RespostaChecklist>>;

/**
 * Parecer que o líder já deu nesta sessão (o card fica no slider, marcado). 3 desfechos
 * desde 04/08/2026 (decisão do Lucas): ajuste devolve para corrigir, reprovado é recusa.
 */
type Veredito = "aprovado" | "ajuste" | "reprovado";

/** Caixa de texto aberta no card. Cada modo tem título, cor e destino próprios. */
type CaixaTexto = "ajuste" | "reprovar" | "justificar" | null;

/**
 * Tudo que a zona do parecer precisa. Vive num objeto só porque os DOIS cards (submissão e
 * edição) montam a MESMA zona — o checklist, o bloqueio e a caixa de texto são regra de
 * negócio, não decoração de layout, e não podem divergir entre os cards.
 */
type ParecerProps = {
  projetoId: string;
  decidido: Veredito | null;
  respostas: Respostas;
  onResponder: (chave: ChaveChecklist, valor: RespostaChecklist) => void;
  ocupado: boolean;
  caixa: CaixaTexto;
  onAbrirCaixa: (modo: Exclude<CaixaTexto, null>) => void;
  onFecharCaixa: () => void;
  comentario: string;
  onComentario: (v: string) => void;
  onAprovar: () => void;
  onPedirAjuste: () => void;
  onReprovar: () => void;
  /** Salta para o próximo projeto sem parecer (null quando não há mais nenhum). */
  proximoPendente: (() => void) | null;
};

/** Pé do card: sair deste projeto sem decidir. Igual nos dois cards. */
type NavegacaoProps = {
  podeVoltar: boolean;
  podeAvancar: boolean;
  onVoltar: () => void;
  onAvancar: () => void;
};

// Rótulos e formatação (`TIPOS_PROJETO_LABEL`, `TIPO_SAVING_LABEL`, `fmtHoras`, `fmtReais`)
// moram em `@/lib/projeto-rotulos` — FONTE ÚNICA compartilhada com a comparação de versões
// (`diff-versoes.ts`), que fala dos MESMOS números. Não redigitar aqui.

function fmtDate(iso: string | null): string {
  return iso ? fmtDataBR(iso) : "—";
}

// Título da aba: o projeto ATUAL do slider (`useTituloPagina` no componente) — a fila
// troca de projeto sem trocar de rota, então `head:` não serviria.
export const Route = createFileRoute("/aprovacoes")({
  component: AprovacoesPage,
});

function AprovacoesPage() {
  const queryClient = useQueryClient();
  // `?como=` só funciona para admin (o servidor ignora para os demais) — é o caminho de
  // validação da tela: abrir a fila do líder sem ser ele.
  const como = new URLSearchParams(window.location.search).get("como")?.trim() ?? "";
  const { data, isLoading, error } = useQuery({
    queryKey: ["aprovacoes-pendentes", como],
    queryFn: () =>
      apiFetch<Fila>(`/api/aprovacoes/pendentes${como ? `?como=${encodeURIComponent(como)}` : ""}`),
    staleTime: 30_000,
  });

  // Estado por projeto: respostas do checklist, caixa de texto aberta e envio em curso.
  // A caixa tem 2 propósitos (mesmo campo de texto, destinos de leitura diferentes):
  // "ajuste" = o que o autor precisa mudar; "justificar" = por que pré-aprova apesar do
  // "não" no checklist.
  const [respostas, setRespostas] = useState<Record<string, Respostas>>({});
  const [memorialAberto, setMemorialAberto] = useState<Record<string, boolean>>({});
  const [caixa, setCaixa] = useState<CaixaTexto>(null);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState<string | null>(null);

  // A fila do slider é ESTÁVEL: cresce quando chega projeto novo do servidor, nunca
  // encolhe quando o líder decide (senão "3 de 12" viraria "3 de 11" no meio do caminho
  // e ele perderia a referência de quanto falta). O parecer já dado fica em `decididos`.
  const [fila, setFila] = useState<ItemAprovacao[]>([]);
  const [decididos, setDecididos] = useState<Record<string, Veredito>>({});
  const [indice, setIndice] = useState(0);
  // Direção do último movimento — só para a animação entrar do lado certo.
  const [voltando, setVoltando] = useState(false);

  useEffect(() => {
    if (!data) return;
    setFila((prev) => {
      const jaNaFila = new Set(prev.map((i) => i.projeto_id));
      const novos = data.itens.filter((i) => !jaNaFila.has(i.projeto_id));
      return novos.length > 0 ? [...prev, ...novos] : prev;
    });
  }, [data]);

  const total = fila.length;
  const atual = fila[indice] ?? null;

  // Título da aba = o projeto que está na tela agora. Fila vazia (ou ainda carregando)
  // fica em "Aprovações · GoDocs".
  useTituloPagina(SECAO.aprovacoes, atual?.projeto_nome ?? null);

  const pendentes = fila.filter((i) => !decididos[i.projeto_id]).length;
  const erro = error ? (error instanceof Error ? error.message : "Erro ao carregar a fila.") : null;

  const irPara = useCallback(
    (destino: number) => {
      if (destino < 0 || destino >= fila.length || destino === indice) return;
      setVoltando(destino < indice);
      setIndice(destino);
      setCaixa(null);
      setComentario("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [fila.length, indice],
  );

  /** Próximo projeto ainda sem parecer, começando depois de `de` e dando a volta. */
  function proximoPendente(de: number): number | null {
    for (let passo = 1; passo <= fila.length; passo++) {
      const i = (de + passo) % fila.length;
      if (!decididos[fila[i].projeto_id]) return i;
    }
    return null;
  }

  // Setas do teclado navegam a fila (fora de campos de texto, para não brigar com o
  // cursor da caixa de ajuste).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const alvo = e.target as HTMLElement | null;
      const tag = alvo?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || alvo?.isContentEditable) return;
      if (e.key === "ArrowRight") irPara(indice + 1);
      if (e.key === "ArrowLeft") irPara(indice - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [indice, irPara]);

  function marcar(projetoId: string, chave: ChaveChecklist, valor: RespostaChecklist) {
    setRespostas((prev) => ({ ...prev, [projetoId]: { ...prev[projetoId], [chave]: valor } }));
    // ⚠️ BUG que o Lucas pegou (04/08/2026): ele marcou tudo "não", abriu a caixa, mudou
    // tudo para "sim" — e a caixa continuou com a pergunta do "não". Mudar QUALQUER
    // resposta fecha a caixa e limpa o texto: a pergunta e o texto escrito sempre
    // correspondem às respostas do momento do clique. Reabrir custa 1 clique; caixa
    // dessincronizada gravaria justificativa de uma pergunta que virou "sim".
    setCaixa(null);
    setComentario("");
  }

  async function decidir(projetoId: string, veredito: Veredito, texto?: string) {
    setEnviando(projetoId);
    try {
      await apiFetch(
        "/api/aprovacoes/decidir",
        {
          projeto_id: projetoId,
          veredito,
          comentario: texto ?? null,
          respostas: respostas[projetoId] ?? {},
          ...(como ? { como } : {}),
        },
        "POST",
      );
      setDecididos((prev) => ({ ...prev, [projetoId]: veredito }));
      // O cache perde o item (a fila do servidor não o traz mais); o slider mantém.
      queryClient.setQueryData<Fila>(["aprovacoes-pendentes", como], (old) =>
        old ? { ...old, itens: old.itens.filter((i) => i.projeto_id !== projetoId) } : old,
      );
      setCaixa(null);
      setComentario("");
      const proximo = proximoPendente(indice);
      if (proximo !== null) irPara(proximo);
      toast.success(
        veredito === "aprovado"
          ? "Projeto pré-aprovado. O autor e a equipe RPA já veem o seu parecer."
          : veredito === "ajuste"
            ? "Ajuste solicitado. O autor recebe o seu comentário."
            : "Projeto reprovado. O autor recebe o seu motivo.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o seu parecer.");
    } finally {
      setEnviando(null);
    }
  }

  /** A zona do parecer do projeto em foco — os dois cards recebem a MESMA. */
  function parecerDoAtual(item: ItemAprovacao): ParecerProps {
    return {
      projetoId: item.projeto_id,
      decidido: decididos[item.projeto_id] ?? null,
      respostas: respostas[item.projeto_id] ?? {},
      onResponder: (chave, valor) => marcar(item.projeto_id, chave, valor),
      ocupado: enviando === item.projeto_id,
      caixa,
      onAbrirCaixa: (modo) => {
        setCaixa(caixa === modo ? null : modo);
        setComentario("");
      },
      onFecharCaixa: () => {
        setCaixa(null);
        setComentario("");
      },
      comentario,
      onComentario: setComentario,
      // Com um "não" no checklist, "Pré-aprovar" NÃO grava direto: abre a caixa para o
      // líder explicar. Quem garante é o servidor.
      onAprovar: () => {
        const resp = respostas[item.projeto_id] ?? {};
        if (chavesQueExigemJustificativa(resp).length > 0 && !comentario.trim()) {
          setCaixa("justificar");
          return;
        }
        decidir(item.projeto_id, "aprovado", comentario.trim() || undefined);
      },
      onPedirAjuste: () => decidir(item.projeto_id, "ajuste", comentario.trim()),
      onReprovar: () => decidir(item.projeto_id, "reprovado", comentario.trim()),
      proximoPendente:
        pendentes > 0
          ? () => {
              const p = proximoPendente(indice);
              if (p !== null) irPara(p);
            }
          : null,
    };
  }

  function navegacaoDoAtual(): NavegacaoProps {
    return {
      podeVoltar: indice > 0,
      podeAvancar: indice < total - 1,
      onVoltar: () => irPara(indice - 1),
      onAvancar: () => irPara(indice + 1),
    };
  }

  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)",
        }}
      >
        {/* Header azul + onda creme (mesma assinatura das telas internas) */}
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 108 }}>
          <div className="absolute bottom-0 left-0 right-0">
            <svg
              viewBox="0 0 1440 60"
              preserveAspectRatio="none"
              className="block w-full"
              style={{ height: 26 }}
            >
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl px-8 pb-7 pt-5">
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              ← Início
            </Link>
            {/* O título já explica a página; o "i" carrega o resto (o que é
                pré-aprovação, que a RPA valida em paralelo) sem ocupar a tela. */}
            <div className="flex items-center gap-2">
              <h1
                className="font-extrabold tracking-tight"
                style={{ fontSize: "clamp(1.35rem,3vw,1.7rem)", color: "var(--go-white)" }}
              >
                Pré-aprovações do meu time
              </h1>
              <span style={{ color: "var(--go-white)" }}>
                <InfoTooltip
                  tone="claro"
                  label="O que é esta página"
                  text="Aqui ficam os projetos que pessoas do seu time submeteram e esperam a sua leitura. Você responde 3 perguntas rápidas e dá o parecer: pré-aprovar ou pedir ajuste. É uma pré-aprovação, não a decisão final: a equipe RPA valida cada projeto em paralelo, então nada fica parado esperando você."
                />
              </span>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-4xl px-8 pb-8 pt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
            </div>
          )}

          {!isLoading && erro && (
            <div
              className="rounded-xl p-6 text-center text-sm"
              style={{
                background: "rgba(220,38,38,0.05)",
                border: "1px solid rgba(220,38,38,0.15)",
                color: "#dc2626",
              }}
            >
              {erro}
            </div>
          )}

          {!isLoading && !erro && (
            <>
              {total === 0 && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ background: "var(--go-white)", border: "1px solid rgba(0,89,169,0.08)" }}
                >
                  <BadgeCheck
                    className="mx-auto mb-3 h-10 w-10 opacity-30"
                    style={{ color: "var(--go-blue)" }}
                  />
                  <p className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                    Nada esperando você
                  </p>
                  <p className="mt-1 text-sm" style={{ color: "#8b8b9a" }}>
                    {data?.lidera
                      ? "Quando alguém do seu time submeter um projeto, ele aparece aqui e você recebe um aviso no Chat."
                      : "Esta fila é de quem lidera um time na TeamGuide. Se você lidera e não vê seus liderados aqui, fale com a equipe RPA."}
                  </p>
                  <Link
                    to="/meus-projetos"
                    className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all"
                    style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
                  >
                    Ver meus projetos
                  </Link>
                </div>
              )}

              {atual && (
                <>
                  {/* Tudo respondido: a fila fica navegável para rever, mas o líder
                      precisa saber que acabou sem contar os selos um por um. */}
                  {pendentes === 0 && (
                    <div
                      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3"
                      style={{
                        background: "rgba(21,128,61,0.06)",
                        border: "1px solid rgba(21,128,61,0.2)",
                      }}
                    >
                      <BadgeCheck className="h-4 w-4 shrink-0" style={{ color: "#15803d" }} />
                      <p className="text-[13px] font-semibold" style={{ color: "#15803d" }}>
                        Você deu parecer nos {total} {total === 1 ? "projeto" : "projetos"} da fila.
                      </p>
                      <Link
                        to="/meus-projetos"
                        className="ml-auto text-[12px] font-bold underline"
                        style={{ color: "#15803d" }}
                      >
                        Ver meus projetos
                      </Link>
                    </div>
                  )}

                  <BarraFila
                    fila={fila}
                    indice={indice}
                    decididos={decididos}
                    pendentes={pendentes}
                    onIr={irPara}
                  />

                  {/* A troca de projeto entra pelo lado, como as etapas do formulário —
                      é o mesmo gesto de "avançar" do resto do produto. */}
                  <div
                    key={atual.projeto_id}
                    style={{
                      animation: `${voltando ? "go-step-in-back" : "go-step-in"} 0.28s ease-out`,
                    }}
                  >
                    {/* EDIÇÃO comparável → card do diff. Edição SEM versão anterior
                        gravada → card padrão com o aviso do porquê (nunca um "antes"
                        inventado). Submissão nova → card padrão. */}
                    {atual.edicao?.comparavel ? (
                      <CardEdicao
                        item={atual}
                        edicao={atual.edicao}
                        parecer={parecerDoAtual(atual)}
                        navegacao={navegacaoDoAtual()}
                      />
                    ) : (
                      <CardAprovacao
                        item={atual}
                        edicaoSemComparacao={atual.edicao ?? null}
                        parecer={parecerDoAtual(atual)}
                        navegacao={navegacaoDoAtual()}
                        memorialAberto={!!memorialAberto[atual.projeto_id]}
                        onToggleMemorial={() =>
                          setMemorialAberto((p) => ({
                            ...p,
                            [atual.projeto_id]: !p[atual.projeto_id],
                          }))
                        }
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Barra de posição na fila ────────────────────────────────────────────────

/**
 * Onde o líder está e o que já resolveu. Cada traço é um projeto, na ordem da fila, e
 * carrega o parecer já dado — dá pra ver o turno inteiro num relance e clicar para voltar
 * a um projeto específico. Com fila longa (> 20) os traços viram uma barra de progresso,
 * porque 40 traços de 3px não se clicam nem se leem.
 */
function BarraFila({
  fila,
  indice,
  decididos,
  pendentes,
  onIr,
}: {
  fila: ItemAprovacao[];
  indice: number;
  decididos: Record<string, Veredito>;
  pendentes: number;
  onIr: (destino: number) => void;
}) {
  const total = fila.length;
  const aprovados = fila.filter((i) => decididos[i.projeto_id] === "aprovado").length;
  const ajustes = fila.filter((i) => decididos[i.projeto_id] === "ajuste").length;
  const reprovados = fila.filter((i) => decididos[i.projeto_id] === "reprovado").length;
  const mostrarTracos = total <= 20;
  const resolvidos = total - pendentes;

  const corDoTraco = (item: ItemAprovacao, ehAtual: boolean) => {
    const v = decididos[item.projeto_id];
    if (v === "aprovado") return "var(--go-lime)";
    if (v === "ajuste") return "#b45309";
    if (v === "reprovado") return "#b91c1c";
    return ehAtual ? "var(--go-blue)" : "rgba(0,89,169,0.18)";
  };

  return (
    <div
      className="mb-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(0,89,169,0.08)",
        boxShadow: "var(--go-shadow-sm)",
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className="text-[9.5px] font-bold uppercase tracking-[0.14em]"
            style={{ color: "#8b8b9a" }}
          >
            Fila do seu time
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span
              className="font-extrabold leading-none"
              style={{ fontSize: 22, color: "var(--go-blue)" }}
            >
              {indice + 1}
            </span>
            <span className="text-[13px] font-semibold" style={{ color: "#6b6b7a" }}>
              de {total} {total === 1 ? "projeto" : "projetos"}
            </span>
            <span className="text-[12px]" style={{ color: "#a5a5b3" }}>
              · {pendentes === 0 ? "nenhum esperando você" : `${pendentes} esperando você`}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onIr(indice - 1)}
            disabled={indice === 0}
            aria-label="Projeto anterior"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onIr(indice + 1)}
            disabled={indice >= total - 1}
            aria-label="Próximo projeto"
            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
          >
            Próximo
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {mostrarTracos ? (
        <div className="mt-3 flex gap-1" role="tablist" aria-label="Projetos da fila">
          {fila.map((item, idx) => {
            const ehAtual = idx === indice;
            const v = decididos[item.projeto_id];
            const situacao =
              v === "aprovado"
                ? "pré-aprovado"
                : v === "ajuste"
                  ? "ajuste pedido"
                  : v === "reprovado"
                    ? "reprovado"
                    : "sem parecer";
            return (
              <button
                key={item.projeto_id}
                type="button"
                role="tab"
                aria-selected={ehAtual}
                aria-label={`Projeto ${idx + 1} de ${total}: ${item.projeto_nome ?? "sem nome"} — ${situacao}`}
                title={`${idx + 1}. ${item.projeto_nome ?? "sem nome"} — ${situacao}`}
                onClick={() => onIr(idx)}
                className="group flex-1 cursor-pointer py-1.5"
              >
                <span
                  className="block rounded-full transition-all motion-reduce:transition-none"
                  style={{
                    height: ehAtual ? 8 : 5,
                    background: corDoTraco(item, ehAtual),
                    boxShadow: ehAtual ? "0 0 0 2px rgba(0,89,169,0.18)" : undefined,
                  }}
                />
              </button>
            );
          })}
        </div>
      ) : (
        <div
          className="mt-3.5 h-1.5 overflow-hidden rounded-full"
          style={{ background: "rgba(0,89,169,0.12)" }}
          role="progressbar"
          aria-valuenow={resolvidos}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${resolvidos} de ${total} projetos com parecer`}
        >
          <span
            className="block h-full rounded-full transition-all motion-reduce:transition-none"
            style={{
              width: `${total > 0 ? (resolvidos / total) * 100 : 0}%`,
              background: "var(--go-blue)",
            }}
          />
        </div>
      )}

      {/* Contagem escrita: o traço colorido é atalho visual, não a informação. */}
      {(aprovados > 0 || ajustes > 0 || reprovados > 0) && (
        <p className="mt-2 flex flex-wrap gap-x-3 text-[11px]" style={{ color: "#8b8b9a" }}>
          {aprovados > 0 && (
            <span className="inline-flex items-center gap-1">
              <BadgeCheck className="h-3 w-3" style={{ color: "#15803d" }} />
              {aprovados} {aprovados === 1 ? "pré-aprovado" : "pré-aprovados"}
            </span>
          )}
          {ajustes > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquareWarning className="h-3 w-3" style={{ color: "#b45309" }} />
              {ajustes} {ajustes === 1 ? "ajuste pedido" : "ajustes pedidos"}
            </span>
          )}
          {reprovados > 0 && (
            <span className="inline-flex items-center gap-1">
              <CircleX className="h-3 w-3" style={{ color: "#b91c1c" }} />
              {reprovados} {reprovados === 1 ? "reprovado" : "reprovados"}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Card de uma SUBMISSÃO nova ──────────────────────────────────────────────
//
// Apresenta o projeto do zero: é a primeira vez que o líder o lê. Para o reenvio, ver
// `CardEdicao` mais abaixo.

function CardAprovacao({
  item: i,
  parecer,
  navegacao,
  edicaoSemComparacao,
  memorialAberto,
  onToggleMemorial,
}: {
  item: ItemAprovacao;
  parecer: ParecerProps;
  navegacao: NavegacaoProps;
  /**
   * Preenchido quando o item É uma edição mas o "antes" não existe no banco (snapshot da
   * versão anterior nunca gravado, ou legado importado da planilha). O card então é o
   * padrão — só com um aviso dizendo por que não há comparação.
   */
  edicaoSemComparacao: Edicao | null;
  memorialAberto: boolean;
  onToggleMemorial: () => void;
}) {
  const { podeVoltar, podeAvancar, onVoltar, onAvancar } = navegacao;
  const decidido = parecer.decidido;
  const horas = fmtHoras(i.saving_horas, i.tipo_saving);
  const reais = fmtReais(i.saving_reais);

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(0,89,169,0.08)",
        boxShadow: "var(--go-shadow-sm)",
      }}
    >
      {/* ── Zona 1: o que é o projeto ───────────────────────────────────────── */}
      <div className="p-5">
        {/* Edição sem "antes" gravado: dizer o que aconteceu, em vez de fingir uma
            comparação. O líder lê o projeto inteiro — é o que sobra de honesto. */}
        {edicaoSemComparacao && (
          <p
            className="mb-3 flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-[12px] leading-snug"
            style={{
              background: "rgba(180,83,9,0.07)",
              border: "1px solid rgba(180,83,9,0.22)",
              color: "#8a4708",
            }}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#b45309" }} />
            <span>
              <strong>Reenvio (versão {edicaoSemComparacao.versao}).</strong> Não há cópia da versão
              anterior guardada, então não é possível mostrar o que mudou — o projeto está completo
              abaixo.
            </span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-bold"
            style={{ color: "var(--go-text-heading)", fontSize: 16, lineHeight: 1.3 }}
          >
            {i.projeto_nome ?? "(sem nome)"}
          </span>
          {i.especial && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: "var(--go-lime)", color: "var(--go-blue)" }}
            >
              Especial
            </span>
          )}
          {i.tipos_projeto
            .filter((t) => t !== "especial")
            .map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
              >
                {TIPOS_PROJETO_LABEL[t] ?? t}
              </span>
            ))}
          <span
            className="ml-auto inline-flex items-center gap-1 text-[11px]"
            style={{ color: "#a5a5b3" }}
          >
            <Clock className="h-3.5 w-3.5" />
            Enviado em {fmtDate(i.submitted_at)}
          </span>
        </div>

        {i.descricao_breve && (
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "#6b6b7a" }}>
            {i.descricao_breve}
          </p>
        )}

        {/* Dono e participantes. Sem participantes, a coluna nem aparece — o projeto é
            só do dono e uma coluna vazia só rouba espaço. */}
        <div className={`mt-4 grid gap-3 ${i.participantes.length > 0 ? "sm:grid-cols-2" : ""}`}>
          <Bloco icone={<User className="h-3.5 w-3.5" />} titulo="Dono">
            <span className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
              {i.autor_nome || i.autor_email || "—"}
            </span>
            {i.area && (
              <span className="block text-[11px]" style={{ color: "#a5a5b3" }}>
                {i.area}
              </span>
            )}
          </Bloco>

          {i.participantes.length > 0 && (
            <Bloco icone={<Users className="h-3.5 w-3.5" />} titulo="Participantes">
              <ul className="space-y-0.5">
                {i.participantes.map((p) => (
                  <li key={p.email}>
                    <span className="font-semibold" style={{ color: "var(--go-text-heading)" }}>
                      {p.nome}
                    </span>
                    <span className="text-[11px]" style={{ color: "#a5a5b3" }}>
                      {" "}
                      · {p.papel}
                    </span>
                  </li>
                ))}
              </ul>
            </Bloco>
          )}
        </div>

        {/* Um card por número, todos no mesmo nível (o ganho total é o primeiro, com a
            barra lime). O resumo do projeto vem DEPOIS, ocupando o card inteiro, porque é
            texto corrido e não cabe numa coluna estreita. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CardNumero
            rotulo="Ganho total"
            valor={fmtReais(i.ganho_total) ?? fmtReais(i.saving_reais)}
            destaque
            vazio={i.especial ? "Projeto especial" : undefined}
          />
          <CardNumero rotulo="Horas economizadas" valor={horas} />
          <CardNumero rotulo="Recorrência" valor={TIPO_SAVING_LABEL[i.tipo_saving ?? ""] ?? null} />
          <CardNumero rotulo="Saving em R$" valor={reais} />
          <CardNumero rotulo="Custo evitado" valor={fmtReais(i.custo_evitado_reais)} />
          <CardNumero rotulo="Receita mensal" valor={fmtReais(i.receita_mensal)} />
          {/* Custo externo é o que a solução CONSOME para rodar — subtrai do ganho. */}
          <CardNumero rotulo="Custo externo" valor={fmtReais(i.custo_externo_mensal)} negativo />
        </div>

        {i.resumo && (
          <div
            className="mt-2 rounded-lg px-3.5 py-2.5"
            style={{ background: "rgba(0,89,169,0.05)", border: "1px solid rgba(0,89,169,0.12)" }}
          >
            <p
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ color: "#8b8b9a" }}
            >
              <Sparkles className="h-3 w-3" />
              Resumo do projeto
            </p>
            {/* Vem do memorial, então pode ter negrito/listas em markdown — renderiza
                como o memorial expansível em vez de mostrar os asteriscos crus. */}
            <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "#4b4b5a" }}>
              <SimpleMarkdown text={i.resumo} isSaving />
            </div>
          </div>
        )}

        {/* Memorial: fica fechado por padrão para o card não virar parede de texto */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i.memorial && (
            <button
              type="button"
              onClick={onToggleMemorial}
              aria-expanded={memorialAberto}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
              style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
            >
              <FileText className="h-3.5 w-3.5" />
              {memorialAberto ? "Fechar memorial" : "Ver memorial do cálculo"}
              <ChevronDown
                className="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
                style={{ transform: memorialAberto ? "rotate(180deg)" : "none" }}
              />
            </button>
          )}
          {/* Nova aba de propósito: o líder não perde o checklist já marcado no card. */}
          <a
            href={`/projeto/${i.projeto_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all"
            style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
          >
            <Eye className="h-3.5 w-3.5" />
            Ler a documentação completa
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {memorialAberto && i.memorial && (
          <div
            className="mt-3 max-h-96 overflow-y-auto rounded-lg px-4 py-3 text-[13px]"
            style={{ background: "var(--go-cream)", border: "1px solid rgba(0,89,169,0.1)" }}
          >
            <SimpleMarkdown text={i.memorial} isSaving />
          </div>
        )}
      </div>

      {/* ── Zona 2: o parecer do líder (mesma dos dois cards) ─────────────── */}
      <ZonaParecer {...parecer} />

      {/* ── Zona 3: sair deste projeto sem decidir ──────────────────────────── */}
      <PeNavegacao {...navegacao} decidido={decidido} />
    </div>
  );
}

// ─── Card de uma EDIÇÃO (reenvio) ────────────────────────────────────────────
//
// A pergunta do líder aqui é outra: não "o que é este projeto?", e sim "o que mudou desde
// que eu li?". Então a hierarquia inverte — o diff ocupa o corpo do card, o resto encolhe:
//
//   • o que mudou fica ABERTO, uma linha por campo, "antes → depois";
//   • texto longo (memorial, documentação) mostra só o rótulo e abre sob clique — memorial
//     tem 2.000 caracteres e dois deles lado a lado seriam uma parede;
//   • o que NÃO mudou vai para um bloco fechado com a contagem na etiqueta, porque o líder
//     precisa poder conferir, não reler;
//   • variação numérica ganha um chip com direção (▲/▼) e o valor da diferença: "o saving
//     dobrou entre versões" é justamente o que a 3ª pergunta do checklist cobra.
//
// Estado nunca só por cor: cada linha diz "Alterado"/"Adicionado"/"Removido" por escrito,
// com ícone, e o chip de variação diz "subiu"/"caiu" no `aria-label`.

function CardEdicao({
  item: i,
  edicao,
  parecer,
  navegacao,
}: {
  item: ItemAprovacao;
  edicao: Edicao;
  parecer: ParecerProps;
  navegacao: NavegacaoProps;
}) {
  const [verIguais, setVerIguais] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const curtas = edicao.mudancas.filter((m) => !m.longo);
  const longas = edicao.mudancas.filter((m) => m.longo);
  const nMudou = edicao.mudancas.length;

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--go-white)",
        border: "1px solid rgba(0,89,169,0.08)",
        boxShadow: "var(--go-shadow-sm)",
      }}
    >
      {/* ── Zona 1: que reenvio é este ─────────────────────────────────────── */}
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
          >
            <PencilLine className="h-3 w-3" />
            Edição · versão {edicao.versao}
          </span>
          <span className="text-[11px]" style={{ color: "#8b8b9a" }}>
            comparando com a versão {edicao.versao_anterior} de {fmtDate(edicao.anterior_em)}
          </span>
          <span
            className="ml-auto inline-flex items-center gap-1 text-[11px]"
            style={{ color: "#a5a5b3" }}
          >
            <Clock className="h-3.5 w-3.5" />
            Reenviado em {fmtDate(edicao.reenviado_em ?? i.submitted_at)}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span
            className="font-bold"
            style={{ color: "var(--go-text-heading)", fontSize: 16, lineHeight: 1.3 }}
          >
            {i.projeto_nome ?? "(sem nome)"}
          </span>
          {i.tipos_projeto
            .filter((t) => t !== "especial")
            .map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
              >
                {TIPOS_PROJETO_LABEL[t] ?? t}
              </span>
            ))}
        </div>

        {/* Identidade do projeto em uma linha: no reenvio ela é referência, não conteúdo
            para julgar — quem julga o quê está nas mudanças abaixo. */}
        <p
          className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px]"
          style={{ color: "#6b6b7a" }}
        >
          <span className="inline-flex items-center gap-1">
            <User className="h-3.5 w-3.5" style={{ color: "#a5a5b3" }} />
            {i.autor_nome || i.autor_email || "—"}
          </span>
          {i.area && <span style={{ color: "#a5a5b3" }}>· {i.area}</span>}
          {i.participantes.length > 0 && (
            <span style={{ color: "#a5a5b3" }}>
              · {i.participantes.length}{" "}
              {i.participantes.length === 1 ? "participante" : "participantes"}
            </span>
          )}
          <a
            href={`/projeto/${i.projeto_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline"
            style={{ color: "var(--go-blue)" }}
          >
            <Eye className="h-3.5 w-3.5" />
            Ler a documentação completa
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {/* ── Zona 2: o que mudou ────────────────────────────────────────────── */}
      <div
        className="px-5 pb-5"
        style={{ borderTop: "1px solid rgba(0,89,169,0.08)", paddingTop: 16 }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: "#8b8b9a" }}
          >
            O que mudou nesta versão
          </p>
          <p className="text-[11px]" style={{ color: "#8b8b9a" }}>
            {nMudou === 0
              ? "nenhum campo"
              : `${nMudou} ${nMudou === 1 ? "campo" : "campos"} · ${edicao.iguais.length} sem mudança`}
          </p>
        </div>

        {nMudou === 0 ? (
          <p
            className="mt-2 flex items-start gap-2 rounded-lg px-3.5 py-3 text-[12.5px] leading-snug"
            style={{
              background: "rgba(0,89,169,0.05)",
              border: "1px solid rgba(0,89,169,0.15)",
              color: "#4b4b5a",
            }}
          >
            <Equal className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--go-blue)" }} />
            <span>
              Nenhum dos dados comparados mudou entre a versão {edicao.versao_anterior} e esta. O
              reenvio pode ter sido só para corrigir a documentação ou refazer o envio — abra a
              documentação completa se quiser conferir.
            </span>
          </p>
        ) : (
          <>
            {curtas.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                {curtas.map((m) => (
                  <LinhaMudanca key={m.chave} campo={m} />
                ))}
              </div>
            )}

            {longas.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {longas.map((m) => (
                  <BlocoLongo
                    key={m.chave}
                    campo={m}
                    aberto={!!abertos[m.chave]}
                    onToggle={() => setAbertos((p) => ({ ...p, [m.chave]: !p[m.chave] }))}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* O que a comparação NÃO cobre. Dito aqui porque o silêncio pareceria garantia. */}
        <p className="mt-2.5 text-[10.5px] leading-snug" style={{ color: "#a5a5b3" }}>
          A comparação cobre os dados do formulário, o memorial e a documentação. Participantes e
          arquivos anexados não entram nela.
        </p>

        {/* ── O que não mudou: fechado, com a contagem na etiqueta ─────────── */}
        {edicao.iguais.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setVerIguais((v) => !v)}
              aria-expanded={verIguais}
              className="inline-flex w-full cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-[12px] font-semibold transition-all motion-reduce:transition-none"
              style={{
                background: "rgba(0,0,0,0.03)",
                border: "1px solid rgba(0,0,0,0.08)",
                color: "#6b6b7a",
              }}
            >
              <Equal className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b8b9a" }} />
              {verIguais ? "Fechar o que não mudou" : "Ver o que não mudou"}
              <span className="text-[11px] font-normal" style={{ color: "#a5a5b3" }}>
                ({edicao.iguais.length} {edicao.iguais.length === 1 ? "campo" : "campos"})
              </span>
              <ChevronDown
                className="ml-auto h-4 w-4 transition-transform motion-reduce:transition-none"
                style={{ transform: verIguais ? "rotate(180deg)" : "none" }}
              />
            </button>

            {verIguais && (
              <div className="mt-1.5 space-y-1.5">
                {edicao.iguais.map((m) =>
                  m.longo ? (
                    <BlocoLongo
                      key={m.chave}
                      campo={m}
                      aberto={!!abertos[m.chave]}
                      onToggle={() => setAbertos((p) => ({ ...p, [m.chave]: !p[m.chave] }))}
                    />
                  ) : (
                    <LinhaMudanca key={m.chave} campo={m} />
                  ),
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Zona 3: o parecer (a MESMA do card de submissão) ──────────────── */}
      <ZonaParecer {...parecer} />

      <PeNavegacao {...navegacao} decidido={parecer.decidido} />
    </div>
  );
}

/** Cor + ícone + rótulo escrito de cada estado de mudança (nunca só a cor). */
const ESTADO_MUDANCA: Record<
  CampoComparado["estado"],
  { rotulo: string; cor: string; Icone: typeof ArrowRight }
> = {
  alterado: { rotulo: "Alterado", cor: "var(--go-blue)", Icone: ArrowRight },
  adicionado: { rotulo: "Adicionado", cor: "#6b6d00", Icone: Plus },
  removido: { rotulo: "Removido", cor: "#b91c1c", Icone: Minus },
  igual: { rotulo: "Sem mudança", cor: "#8b8b9a", Icone: Equal },
};

/**
 * Uma mudança de valor curto: rótulo, antes → depois e, quando é número, o quanto variou.
 *
 * O "antes" fica em cinza e o "depois" em azul forte — mas a diferença entre eles NÃO é a
 * cor: são as etiquetas "antes"/"agora", que sobrevivem a daltonismo e a print em preto e
 * branco.
 */
function LinhaMudanca({ campo }: { campo: CampoComparado }) {
  const e = ESTADO_MUDANCA[campo.estado];
  return (
    <div
      className="rounded-lg px-3.5 py-2.5"
      style={{
        background: campo.estado === "igual" ? "rgba(0,0,0,0.02)" : "rgba(0,89,169,0.04)",
        border: `1px solid ${campo.estado === "igual" ? "rgba(0,0,0,0.06)" : "rgba(0,89,169,0.14)"}`,
        borderLeft: `3px solid ${e.cor}`,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#8b8b9a" }}>
          {campo.rotulo}
        </p>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: e.cor }}
        >
          <e.Icone className="h-3 w-3" />
          {e.rotulo}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* A etiqueta "antes" só faz sentido quando existe um "agora" diferente. No campo
            sem mudança ela mentiria: o valor não é o antigo, é o de sempre. */}
        {campo.estado !== "igual" && (
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
            antes
          </span>
        )}
        <span
          className="text-[13px] font-medium tabular-nums"
          style={{
            color: "#8b8b9a",
            textDecoration: campo.estado === "removido" ? "line-through" : undefined,
          }}
        >
          {campo.antes ?? "não informado"}
        </span>
        {campo.estado !== "igual" && (
          <>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color: "#a5a5b3" }} />
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "#a5a5b3" }}>
              agora
            </span>
            <span
              className="text-[13.5px] font-bold tabular-nums"
              style={{ color: "var(--go-text-heading)" }}
            >
              {campo.depois ?? "não informado"}
            </span>
          </>
        )}
        {campo.delta && <ChipVariacao delta={campo.delta} />}
      </div>
    </div>
  );
}

/**
 * "▲ + 42 h/mês" — o tamanho do salto, que é o que faz o líder desconfiar ou concordar.
 *
 * ⚠️ O chip é NEUTRO de propósito (azul nas duas direções, a direção sai do ícone e do
 * `aria-label`). Verde para "subiu" e âmbar para "caiu" pareceu óbvio na 1ª versão e estava
 * errado por dois motivos: **custo externo** subindo é PIOR, e sairia verde; e um saving que
 * dobra de uma versão para a outra é exatamente o que o líder tem de DUVIDAR — pintá-lo de
 * verde empurraria o carimbo. A comparação relata, não opina.
 */
function ChipVariacao({ delta }: { delta: NonNullable<CampoComparado["delta"]> }) {
  const subiu = delta.direcao === "subiu";
  const Icone = subiu ? TrendingUp : TrendingDown;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
      style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
      aria-label={`${subiu ? "subiu" : "caiu"} ${delta.texto}`}
    >
      <Icone className="h-3 w-3" />
      {delta.texto}
    </span>
  );
}

/**
 * Texto longo (memorial, documentação, itens de custo evitado): fechado por padrão, com o
 * rótulo e o estado à vista. Aberto, o "antes" vem em creme e o "agora" em branco com a
 * barra azul — empilhados, não em colunas: o memorial tem parágrafos, e duas colunas
 * estreitas de prosa se leem pior que duas caixas largas.
 */
function BlocoLongo({
  campo,
  aberto,
  onToggle,
}: {
  campo: CampoComparado;
  aberto: boolean;
  onToggle: () => void;
}) {
  const e = ESTADO_MUDANCA[campo.estado];
  const ehMemorial = campo.chave === "memorial_calculo";
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{
        background: campo.estado === "igual" ? "rgba(0,0,0,0.02)" : "rgba(0,89,169,0.04)",
        border: `1px solid ${campo.estado === "igual" ? "rgba(0,0,0,0.06)" : "rgba(0,89,169,0.14)"}`,
        borderLeft: `3px solid ${e.cor}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5 text-left"
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wide"
          style={{ color: "#8b8b9a" }}
        >
          {campo.rotulo}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: e.cor }}
        >
          <e.Icone className="h-3 w-3" />
          {e.rotulo}
        </span>
        <span className="text-[11px]" style={{ color: "#a5a5b3" }}>
          texto longo
        </span>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-bold"
          style={{ color: "var(--go-blue)" }}
        >
          {aberto ? "Fechar" : campo.estado === "igual" ? "Ver o texto" : "Ver antes e agora"}
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
            style={{ transform: aberto ? "rotate(180deg)" : "none" }}
          />
        </span>
      </button>

      {aberto && (
        <div className="space-y-2 px-3.5 pb-3.5">
          {/* Campo igual não repete o texto duas vezes — mostra uma vez só. */}
          {campo.estado !== "igual" && (
            <TextoVersao
              etiqueta={`Antes (versão anterior)`}
              texto={campo.antes}
              tom="antes"
              markdown={ehMemorial}
            />
          )}
          <TextoVersao
            etiqueta={campo.estado === "igual" ? "Texto (não mudou)" : "Agora (esta versão)"}
            texto={campo.depois}
            tom={campo.estado === "igual" ? "antes" : "agora"}
            markdown={ehMemorial}
          />
        </div>
      )}
    </div>
  );
}

function TextoVersao({
  etiqueta,
  texto,
  tom,
  markdown,
}: {
  etiqueta: string;
  texto: string | null;
  tom: "antes" | "agora";
  markdown: boolean;
}) {
  return (
    <div>
      <p
        className="mb-1 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: tom === "agora" ? "var(--go-blue)" : "#a5a5b3" }}
      >
        {etiqueta}
      </p>
      <div
        className="max-h-72 overflow-y-auto rounded-lg px-3.5 py-2.5 text-[12.5px] leading-relaxed"
        style={{
          background: tom === "agora" ? "var(--go-white)" : "var(--go-cream)",
          border: "1px solid rgba(0,89,169,0.1)",
          borderLeft: tom === "agora" ? "3px solid var(--go-blue)" : "3px solid rgba(0,0,0,0.08)",
          color: tom === "agora" ? "var(--go-text-heading)" : "#6b6b7a",
          whiteSpace: markdown ? undefined : "pre-wrap",
        }}
      >
        {texto === null ? (
          <span style={{ color: "#a5a5b3" }}>não informado nesta versão</span>
        ) : markdown ? (
          <SimpleMarkdown text={texto} isSaving />
        ) : (
          texto
        )}
      </div>
    </div>
  );
}

/**
 * Caixa de texto do parecer. Um componente para os 3 modos: o que muda é o título, a
 * cor, o exemplo (placeholder) e o rótulo do botão — a mecânica é a mesma.
 */
function CaixaParecer({
  projetoId,
  modo,
  chavesJustificar,
  comentario,
  onComentario,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  projetoId: string;
  modo: Exclude<CaixaTexto, null>;
  /** Perguntas que ficaram "não" e pedem explicação (só no modo "justificar"). */
  chavesJustificar: ChaveChecklist[];
  comentario: string;
  onComentario: (v: string) => void;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const justificando = modo === "justificar";
  const cor = modo === "reprovar" ? "#b91c1c" : modo === "ajuste" ? "#b45309" : "var(--go-blue)";
  const fundo =
    modo === "reprovar"
      ? "rgba(220,38,38,0.05)"
      : modo === "ajuste"
        ? "rgba(180,83,9,0.05)"
        : "rgba(0,89,169,0.05)";
  const primeira = chavesJustificar[0];
  const titulo = justificando
    ? chavesJustificar.length > 1
      ? 'Dois pontos ficaram como "Não". Explique cada um:'
      : primeira
        ? JUSTIFICATIVA_POR_CHAVE[primeira].pergunta
        : "Explique o seu parecer"
    : modo === "ajuste"
      ? "O que precisa ser ajustado?"
      : "Por que este projeto está sendo reprovado?";
  const rotuloBotao = justificando
    ? "Pré-aprovar com esta explicação"
    : modo === "ajuste"
      ? "Enviar pedido de ajuste"
      : "Confirmar reprovação";

  return (
    <div
      className="mt-3 rounded-lg p-4"
      style={{ background: fundo, border: `1px solid ${cor}33` }}
    >
      <label
        htmlFor={`comentario-${projetoId}`}
        className="mb-1.5 block text-[12px] font-semibold"
        style={{ color: cor }}
      >
        {titulo}
      </label>
      {/* 2+ "nãos": a pergunta de cada um vira bullet, para o líder não esquecer nenhum. */}
      {justificando && chavesJustificar.length > 1 && (
        <ul className="mb-2 space-y-1">
          {chavesJustificar.map((c) => (
            <li key={c} className="text-[11.5px] leading-snug" style={{ color: "#4b4b5a" }}>
              • <strong>{CHECKLIST_APROVACAO.find((p) => p.chave === c)?.rotulo}</strong> —{" "}
              {JUSTIFICATIVA_POR_CHAVE[c].pergunta}
            </li>
          ))}
        </ul>
      )}
      {justificando && chavesJustificar.length === 1 && (
        <p className="mb-2 text-[11px] leading-snug" style={{ color: "#6b6b7a" }}>
          Duas ou três linhas bastam. A equipe RPA lê isso na triagem, junto com as suas respostas.
        </p>
      )}
      <textarea
        id={`comentario-${projetoId}`}
        value={comentario}
        onChange={(e) => onComentario(e.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus
        className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
        style={{
          background: "var(--go-white)",
          border: `1.5px solid ${cor}40`,
          color: "var(--go-text-heading)",
        }}
      />
      <div className="mt-2.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancelar}
          className="cursor-pointer rounded-lg px-4 py-2 text-[12px] font-bold transition-colors"
          style={{
            background: "transparent",
            color: "#6b6b7a",
            border: "1.5px solid rgba(0,0,0,0.12)",
          }}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={ocupado || comentario.trim().length === 0}
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white transition-colors disabled:opacity-50"
          style={{
            background: justificando ? "#15803d" : cor,
            border: `1.5px solid ${justificando ? "#15803d" : cor}`,
          }}
        >
          {ocupado ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : justificando ? (
            <BadgeCheck className="h-3.5 w-3.5" />
          ) : modo === "ajuste" ? (
            <MessageSquareWarning className="h-3.5 w-3.5" />
          ) : (
            <CircleX className="h-3.5 w-3.5" />
          )}
          {rotuloBotao}
        </button>
      </div>
    </div>
  );
}

/**
 * Um card por número do ganho. Sem valor mostra "Não declarado" em vez de desaparecer:
 * o líder precisa saber que o campo não foi preenchido (era o pedido do Luis).
 */
function CardNumero({
  rotulo,
  valor,
  negativo,
  destaque,
  vazio,
}: {
  rotulo: string;
  valor: string | null;
  negativo?: boolean;
  /** O número que resume o projeto: fonte maior + barra lime da identidade. */
  destaque?: boolean;
  /** Texto quando não há valor (default "Não declarado"). */
  vazio?: string;
}) {
  return (
    <div
      className="rounded-lg px-2.5 py-2"
      style={{
        // Mesmo azul-acinzentado das outras boxes da tela (área, resumo): branco
        // sobre branco só com a borda de 10% ficava difícil de ler.
        background: "rgba(0,89,169,0.05)",
        border: "1px solid rgba(0,89,169,0.12)",
        borderLeft: destaque ? "3px solid var(--go-lime)" : undefined,
      }}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "#8b8b9a" }}>
        {rotulo}
      </p>
      <p
        className={destaque ? "mt-0.5 font-extrabold" : "mt-0.5 font-bold"}
        style={{
          fontSize: destaque ? 17 : 13.5,
          color: valor
            ? negativo
              ? "#b45309"
              : destaque
                ? "var(--go-blue)"
                : "var(--go-text-heading)"
            : "#a5a5b3",
        }}
      >
        {valor ? (negativo ? `− ${valor}` : valor) : (vazio ?? "Não declarado")}
      </p>
    </div>
  );
}

/** Bloco de informação do card (rótulo pequeno + conteúdo). */
function Bloco({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(0,89,169,0.04)" }}>
      <p
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide"
        style={{ color: "#8b8b9a" }}
      >
        {icone}
        {titulo}
      </p>
      <div className="mt-0.5 text-[13px]">{children}</div>
    </div>
  );
}

// ─── Zona do parecer (compartilhada pelos dois cards) ────────────────────────
//
// O checklist, o bloqueio do saving incoerente e a caixa de texto são REGRA, não
// layout: submissão e edição têm de cobrar exatamente as mesmas 3 respostas e os
// mesmos textos. Por isso a zona vive aqui, e não copiada em cada card.

function ZonaParecer({
  projetoId,
  decidido,
  respostas,
  onResponder,
  ocupado,
  caixa,
  onAbrirCaixa,
  onFecharCaixa,
  comentario,
  onComentario,
  onAprovar,
  onPedirAjuste,
  onReprovar,
  proximoPendente,
}: ParecerProps) {
  const completo = checklistCompleto(respostas);
  const faltam = CHECKLIST_APROVACAO.filter((p) => !respostas[p.chave]).length;
  // Saving incoerente é PRÉ-REQUISITO, não algo a justificar: some o "Pré-aprovar".
  const bloqueado = bloqueiaPreAprovacao(respostas);
  const chavesJustificar = chavesQueExigemJustificativa(respostas);

  return (
    <div
      className="px-5 py-4"
      style={{ background: "rgba(0,89,169,0.03)", borderTop: "1px solid rgba(0,89,169,0.08)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
          Seu parecer
        </p>
        {!decidido && (
          <p className="text-[11px]" style={{ color: completo ? "#15803d" : "#8b8b9a" }}>
            {completo ? "3 de 3 respondidas" : `Faltam ${faltam} de 3 perguntas`}
          </p>
        )}
      </div>

      {/* Já decidido: o card continua na fila para o líder rever o que registrou, sem
            poder mudar (a decisão foi gravada e o autor já foi avisado). */}
      {decidido && (
        <div
          className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg px-3.5 py-3"
          style={
            decidido === "aprovado"
              ? { background: "rgba(21,128,61,0.07)", border: "1.5px solid rgba(21,128,61,0.22)" }
              : decidido === "ajuste"
                ? { background: "rgba(180,83,9,0.07)", border: "1.5px solid rgba(180,83,9,0.22)" }
                : { background: "rgba(220,38,38,0.07)", border: "1.5px solid rgba(220,38,38,0.22)" }
          }
        >
          {decidido === "aprovado" ? (
            <BadgeCheck className="h-4 w-4 shrink-0" style={{ color: "#15803d" }} />
          ) : decidido === "ajuste" ? (
            <MessageSquareWarning className="h-4 w-4 shrink-0" style={{ color: "#b45309" }} />
          ) : (
            <CircleX className="h-4 w-4 shrink-0" style={{ color: "#b91c1c" }} />
          )}
          <p
            className="text-[12.5px] font-semibold"
            style={{
              color:
                decidido === "aprovado" ? "#15803d" : decidido === "ajuste" ? "#b45309" : "#b91c1c",
            }}
          >
            {decidido === "aprovado"
              ? "Você pré-aprovou este projeto. O autor e a equipe RPA já veem o parecer."
              : decidido === "ajuste"
                ? "Você pediu ajuste. O autor recebeu o seu comentário."
                : "Você reprovou este projeto. O autor recebeu o seu motivo."}
          </p>
          {proximoPendente && (
            <button
              type="button"
              onClick={proximoPendente}
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold transition-all"
              style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
            >
              Ir para o próximo sem parecer
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="mt-2.5 space-y-2">
        {CHECKLIST_APROVACAO.map((p) => {
          const marcada = respostas[p.chave];
          return (
            <div
              key={p.chave}
              className="flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              style={{
                background: "var(--go-white)",
                border: marcada
                  ? "1.5px solid rgba(0,89,169,0.25)"
                  : "1.5px solid rgba(0,0,0,0.07)",
              }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="flex items-start gap-1.5 text-[13px] font-semibold"
                  style={{ color: "var(--go-text-heading)" }}
                >
                  {/* Estado por ícone + borda, nunca só por cor */}
                  {marcada && (
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{ color: "var(--go-blue)" }}
                    />
                  )}
                  {p.pergunta}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: "#8b8b9a" }}>
                  {p.ajuda}
                </p>
              </div>
              <div
                className="flex shrink-0 gap-1 self-start rounded-full p-1 sm:self-auto"
                style={{ background: "rgba(0,0,0,0.04)" }}
                role="group"
                aria-label={p.pergunta}
              >
                {(["sim", "nao"] as RespostaChecklist[]).map((v) => {
                  const ativo = marcada === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => onResponder(p.chave, v)}
                      disabled={!!decidido}
                      aria-pressed={ativo}
                      className="cursor-pointer rounded-full px-4 py-1.5 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        background: ativo ? "var(--go-blue)" : "transparent",
                        color: ativo ? "var(--go-white)" : "#6b6b7a",
                      }}
                    >
                      {v === "sim" ? "Sim" : "Não"}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sem aviso antecipado sobre o "Não" (04/08/2026): quem clica em "Pré-aprovar"
            já cai na caixa de explicação, e o texto solto aqui só poluía a tela. */}
      {/* Saving incoerente = erro de submissão, não algo a justificar: o
            "Pré-aprovar" sai de cena e sobram ajuste/reprovação. */}
      {!decidido && bloqueado && (
        <p
          className="mt-2.5 flex items-start gap-1.5 rounded-lg px-3 py-2.5 text-[11.5px] leading-snug"
          style={{
            background: "rgba(220,38,38,0.06)",
            border: "1px solid rgba(220,38,38,0.18)",
            color: "#b91c1c",
          }}
        >
          <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{AVISO_SAVING_INCOERENTE}</span>
        </p>
      )}

      {!decidido && (
        <div className="mt-3.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onAbrirCaixa("reprovar")}
            disabled={ocupado || !completo}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "rgba(220,38,38,0.1)", color: "#b91c1c" }}
          >
            <CircleX className="h-3.5 w-3.5" />
            Reprovar
          </button>
          <button
            type="button"
            onClick={() => onAbrirCaixa("ajuste")}
            disabled={ocupado || !completo}
            className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "rgba(180,83,9,0.12)", color: "#b45309" }}
          >
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Pedir ajuste
          </button>
          {!bloqueado && (
            <button
              type="button"
              onClick={onAprovar}
              disabled={ocupado || !completo}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#15803d" }}
            >
              {ocupado ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BadgeCheck className="h-3.5 w-3.5" />
              )}
              Pré-aprovar
            </button>
          )}
        </div>
      )}
      {!decidido && !completo && (
        <p className="mt-2 text-right text-[11px]" style={{ color: "#8b8b9a" }}>
          Responda as 3 perguntas para liberar o parecer.
        </p>
      )}

      {/* Caixa de texto: obrigatória nos 3 caminhos, com título/exemplo próprios.
            - "ajuste"/"reprovar": o texto é lido pelo AUTOR;
            - "justificar": o texto é lido pela TRIAGEM, e a pergunta + o exemplo vêm da
              CHAVE que ficou "não" (`JUSTIFICATIVA_POR_CHAVE`) — exemplo genérico do
              saving em cima de um "não" de KPI foi o que o Lucas reprovou. Com 2 "nãos",
              um bullet por pergunta e um campo só (duas caixas empilhadas cansam). */}
      {!decidido && caixa && (
        <CaixaParecer
          projetoId={projetoId}
          modo={caixa}
          chavesJustificar={chavesJustificar}
          comentario={comentario}
          onComentario={onComentario}
          ocupado={ocupado}
          onCancelar={onFecharCaixa}
          onConfirmar={
            caixa === "ajuste" ? onPedirAjuste : caixa === "reprovar" ? onReprovar : onAprovar
          }
        />
      )}
    </div>
  );
}

/** Pé do card: pular para outro projeto sem decidir este. */
function PeNavegacao({
  podeVoltar,
  podeAvancar,
  onVoltar,
  onAvancar,
  decidido,
}: NavegacaoProps & { decidido: Veredito | null }) {
  return (
    <>
      {/* ── Zona 3: sair deste projeto sem decidir ──────────────────────────── */}
      {/* Card longo: quem chega ao fim e quer pular não deveria ter de rolar de volta
          até a barra do topo. */}
      {(podeVoltar || podeAvancar) && (
        <div
          className="flex items-center justify-between gap-2 px-5 py-3"
          style={{ borderTop: "1px solid rgba(0,89,169,0.08)" }}
        >
          <button
            type="button"
            onClick={onVoltar}
            disabled={!podeVoltar}
            className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: "var(--go-blue)" }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Projeto anterior
          </button>
          <button
            type="button"
            onClick={onAvancar}
            disabled={!podeAvancar}
            className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-bold transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: "var(--go-blue)" }}
          >
            {decidido ? "Próximo projeto" : "Decidir depois"}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
