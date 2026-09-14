/**
 * O quadro da triagem: colunas de cartões, roladas na horizontal.
 *
 * Ele não sabe qual eixo está desenhando — recebe colunas prontas de `agruparKanban`
 * (módulo puro) e cuida só do que é de tela: a altura, o teto de cartões por coluna e o
 * "Ver mais".
 *
 * ⚠️ **O teto por coluna não é enfeite.** Com a base inteira, a coluna "Aprovado" passa de
 * 500 projetos; desenhar tudo trava a aba antes de a pessoa ler o primeiro cartão. Cada
 * coluna guarda o próprio teto (um `Map` por chave), então abrir uma não afeta as outras e
 * trocar de eixo recomeça do início.
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CartaoQuadro } from "@/components/dashboard/cartao-quadro";
import type { AgenteChipDados } from "@/components/dashboard/chip-agente";
import { CARTOES_INICIAIS, CARTOES_INCREMENTO, type ColunaKanban } from "@/lib/dashboard-kanban";
import type { AcaoTriagem } from "@/lib/especiais-acoes";
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";

const AZUL = "var(--go-blue)";

export function QuadroTriagem({
  colunas,
  eixo,
  avaliacoes,
  feedbacks,
  ajustesFeitos,
  selecionados,
  salvandoId,
  agoraMs,
  onSelecionar,
  onDecidir,
  onAbrirFicha,
  onAquecer,
}: {
  colunas: ColunaKanban[];
  /** Só para reiniciar os tetos ao trocar de eixo. */
  eixo: string;
  avaliacoes: Record<string, AgenteChipDados>;
  feedbacks: Record<string, "like" | "dislike">;
  /** Ids que já voltaram de um "Ajuste pedido". */
  ajustesFeitos: Set<string>;
  selecionados: Set<string>;
  salvandoId: string | null;
  agoraMs: number;
  onSelecionar: (id: string, marcado: boolean) => void;
  onDecidir: (projeto: ProjetoDashboardResumo, acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: (projeto: ProjetoDashboardResumo) => void;
  onAquecer: (id: string) => void;
}) {
  const [tetos, setTetos] = useState<Record<string, number>>({});
  // Trocar de eixo recomeça a leitura: o teto da coluna "3 estrelas" não diz nada sobre a
  // coluna "Maria Silva".
  useEffect(() => setTetos({}), [eixo]);

  if (colunas.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nenhum projeto casa com esse recorte. Limpe a busca ou escolha outra fila.
      </div>
    );
  }

  return (
    /**
     * ⚠️ **As colunas CRESCEM para preencher o espaço livre** (pedido do Luis, 14/09/2026).
     * Com largura fixa, o eixo "Status" desenhava 3 colunas de 286 px e deixava metade da
     * tela vazia. O `flex: 1 1 <base>` com `minWidth` faz as duas coisas com uma regra só:
     * poucas colunas esticam até o teto; muitas (eixo "Autor", dezenas) param no mínimo e o
     * quadro passa a rolar na horizontal, que é o comportamento de quadro mesmo.
     * ⚠️ O teto existe para 2 colunas não virarem dois painéis de meia tela cada.
     */
    <div className="mt-4 flex gap-3 overflow-x-auto pb-3">
      {colunas.map((coluna) => {
        const teto = tetos[coluna.chave] ?? CARTOES_INICIAIS;
        const visiveis = coluna.projetos.slice(0, teto);
        const faltam = coluna.total - visiveis.length;
        return (
          <section
            key={coluna.chave}
            aria-label={`${coluna.rotulo}: ${coluna.total} ${coluna.total === 1 ? "projeto" : "projetos"}`}
            className="flex flex-col rounded-xl bg-muted/40"
            style={{ flex: "1 1 286px", minWidth: 286, maxWidth: 420 }}
          >
            <header
              className="sticky top-0 z-10 rounded-t-xl border-b bg-card/95 px-3 py-2.5 backdrop-blur"
              style={{ borderTop: `3px solid ${coluna.cor ?? "var(--border)"}` }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="truncate text-[12.5px] font-semibold" title={coluna.rotulo}>
                  {coluna.rotulo}
                </h2>
                <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
                  {coluna.total}
                </span>
              </div>
              {coluna.apoio && (
                <p
                  className="mt-0.5 truncate text-[10.5px] text-muted-foreground"
                  title={coluna.apoio}
                >
                  {coluna.apoio}
                </p>
              )}
            </header>

            <div className="flex max-h-[calc(100vh-300px)] min-h-[220px] flex-col gap-2 overflow-y-auto p-2">
              {coluna.total === 0 ? (
                <p className="px-1 py-6 text-center text-[11.5px] text-muted-foreground">
                  Nada nesta coluna
                </p>
              ) : (
                visiveis.map((p) => (
                  <CartaoQuadro
                    key={p.id}
                    projeto={p}
                    agente={avaliacoes[p.id] ?? avaliacoes[p.id.toLowerCase()] ?? null}
                    voto={feedbacks[p.id] ?? feedbacks[p.id.toLowerCase()] ?? null}
                    ajusteFeito={ajustesFeitos.has(p.id)}
                    agoraMs={agoraMs}
                    salvando={salvandoId === p.id}
                    selecionado={selecionados.has(p.id)}
                    onSelecionar={(marcado) => onSelecionar(p.id, marcado)}
                    onDecidir={(acao, motivo) => onDecidir(p, acao, motivo)}
                    onAbrirFicha={() => onAbrirFicha(p)}
                    onAquecer={() => onAquecer(p.id)}
                  />
                ))
              )}
              {faltam > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setTetos((t) => ({
                      ...t,
                      [coluna.chave]: teto + CARTOES_INCREMENTO,
                    }))
                  }
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                  style={{ ["--tw-ring-color" as string]: AZUL }}
                >
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  Ver mais {Math.min(faltam, CARTOES_INCREMENTO)} de {faltam}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Silhueta do quadro enquanto a listagem não chega. Decorativa: o texto do estado é do vivo. */
export function QuadroEsqueleto() {
  return (
    <div className="mt-4 flex gap-3 overflow-hidden pb-3" aria-hidden>
      {[0, 1, 2, 3].map((c) => (
        <div
          key={c}
          className="flex flex-col rounded-xl bg-muted/40"
          style={{ flex: "1 1 286px", minWidth: 286, maxWidth: 420 }}
        >
          <div className="rounded-t-xl border-b bg-card px-3 py-2.5">
            <div className="h-3 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
          <div className="flex flex-col gap-2 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border bg-card p-3">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="mt-3 h-5 w-2/3 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
