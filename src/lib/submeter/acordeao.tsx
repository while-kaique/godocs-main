import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

/**
 * ACORDEÃO genérico (disclosure de um-aberto-por-vez).
 *
 * Existe porque este repo tinha ~11 disclosures reescritos à mão (`aviso-pendencia.tsx`,
 * `aviso-bloqueio.tsx`, `quem-fez-o-que.tsx`, `projeto-detalhe-dialog.tsx`,
 * `CollapsiblePreviewCard`, 3 pontos de `aprovacoes.tsx`, 2 de `investigador.tsx`,
 * `email-legados.tsx`) e NENHUM genérico — não há `@radix-ui/react-accordion` nem
 * `ui/accordion.tsx` instalados. Então criar aqui é CONSOLIDAR, não duplicar.
 *
 * O idioma é o do `aviso-pendencia.tsx:171`, que é o mais cuidado do repo:
 *  - a **tira inteira** é o `<button aria-expanded>` — alvo generoso e UM único stop de
 *    teclado (cabeçalho com botão separado dá dois stops para uma ação);
 *  - `aria-controls` + `role="region"`/`aria-labelledby` amarram cabeçalho↔painel, então
 *    o leitor de tela anuncia "expandido/recolhido" e sabe o que expandiu;
 *  - estado **nunca só por cor**: "completo" leva ícone `Check` + a palavra, não só o
 *    verde.
 *
 * ⚠️ `prefers-reduced-motion` NÃO precisa de tratamento aqui: `styles.css:209` já
 * neutraliza animação e transição globalmente, inclusive as de `style` inline.
 *
 * ⚠️ Componente BURRO de propósito — quem decide "qual abre agora" é
 * `acordeao-estado.ts` (puro e testável). Aqui não há `useState` de abertura: o pai
 * manda `aberto` e recebe `onAlternar`. Neste repo o Vitest roda `environment: 'node'` e
 * só inclui `tests/**\/*.test.ts`, então lógica dentro do `.tsx` seria lógica sem teste.
 */
export type BlocoAcordeao = {
  id: string;
  titulo: string;
  /** Uma linha de estado quando fechado (ex.: "R$ 1.200/mês · mensal"). */
  resumo?: string;
  completo?: boolean;
  conteudo: React.ReactNode;
};

export function Acordeao({
  blocos,
  aberto,
  onAlternar,
  className,
}: {
  blocos: BlocoAcordeao[];
  aberto: string | null;
  onAlternar: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {blocos.map((bloco, i) => {
        const expandido = aberto === bloco.id;
        const idPainel = `acordeao-painel-${bloco.id}`;
        const idCabecalho = `acordeao-cabecalho-${bloco.id}`;
        return (
          <div
            key={bloco.id}
            className="overflow-hidden rounded-xl"
            style={{
              background: "var(--go-white)",
              border: expandido
                ? "1.5px solid rgba(0,89,169,0.28)"
                : "1.5px solid rgba(215,219,0,0.22)",
            }}
          >
            <button
              type="button"
              id={idCabecalho}
              aria-expanded={expandido}
              aria-controls={idPainel}
              onClick={() => onAlternar(bloco.id)}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors"
              style={{ background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0,89,169,0.035)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Ordinal: aqui a numeração carrega informação real — a Etapa 3 é uma
                  sequência (completou, fecha, abre o próximo), não decoração. */}
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={
                  bloco.completo
                    ? { background: "var(--go-lime)", color: "#4a4d00" }
                    : {
                        background: expandido ? "var(--go-blue)" : "rgba(0,89,169,0.1)",
                        color: expandido ? "#fff" : "var(--go-blue)",
                      }
                }
                aria-hidden
              >
                {bloco.completo ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className="block text-[13.5px] font-semibold"
                  style={{ color: "var(--go-text-primary)" }}
                >
                  {bloco.titulo}
                </span>
                {/* Fechado, a linha de resumo é o que diz se o bloco tem conteúdo. */}
                {!expandido && (bloco.resumo || bloco.completo) ? (
                  <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: "#7b7b8a" }}>
                    {bloco.completo ? "Completo" : null}
                    {bloco.completo && bloco.resumo ? " · " : null}
                    {bloco.resumo}
                  </span>
                ) : null}
              </span>

              <ChevronDown
                className="h-4 w-4 shrink-0 transition-transform"
                style={{
                  color: "#8b8b9a",
                  transform: expandido ? "rotate(180deg)" : "rotate(0deg)",
                }}
                aria-hidden
              />
            </button>

            <div
              id={idPainel}
              role="region"
              aria-labelledby={idCabecalho}
              hidden={!expandido}
              className="px-3.5 pb-3.5"
            >
              {bloco.conteudo}
            </div>
          </div>
        );
      })}
    </div>
  );
}
