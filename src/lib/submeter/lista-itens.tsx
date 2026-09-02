import * as React from "react";
import { Plus, X } from "lucide-react";
import { formatMoedaBR } from "./constants";
import { TIPO_SAVING_LABEL } from "@/lib/projeto-rotulos";
import type { Frequencia } from "@/lib/impacto";
import type { ItemLista } from "./itens-lista";

/**
 * LISTA INCREMENTAL de itens (nome · valor · frequência · o que é).
 *
 * Absorve as DUAS cópias da v1 — `custoEvitadoItensUI` (`step3-chat.tsx:1253`) e o bloco
 * inline do custo do projeto (`:1845`) —, que eram idênticas salvo **12 detalhes de
 * texto/prefixo**. Esses 12 viraram as props de `RotulosLista`: era a única coisa que
 * variava, e mantê-los como props é o que impede a "unificação" de apagar o vocabulário
 * de cada lugar (o placeholder "multa por atraso · licença do Zapier" é EXEMPLO
 * deliberado, do caso SmartOnline/DIFAL — não enfeite).
 *
 * ⚠️ A grade e as medidas são as da v1 de propósito (mesma `gridTemplateColumns`, mesma
 * altura 38, mesmas bordas): o plano manda reaproveitar a linguagem visual atual, e esta
 * lista já tinha passado por validação visual.
 *
 * ⚠️ Na v2 as opções de frequência são **4** (`impacto.ts`), não as 2 da v1, e os rótulos
 * saem de `TIPO_SAVING_LABEL` (`projeto-rotulos.ts`) — fonte única com as outras telas.
 * Não redigitar "A cada trimestre" aqui.
 *
 * Componente BURRO: nenhum `useState`. Adicionar/remover/atualizar/validar vive em
 * `itens-lista.ts` (puro e testável — o Vitest deste repo não renderiza componente).
 */
export type RotulosLista = {
  colunaNome: string;
  placeholderNome: string;
  ariaNome: string;
  placeholderValor: string;
  ariaValor: string;
  ariaFrequencia: string;
  placeholderDescricao: string;
  ariaDescricao: string;
  ariaRemover: string;
  botaoAdicionar: string;
};

const GRADE = "1fr 96px 118px 28px";
const BORDA = "1.5px solid rgba(215,219,0,0.2)";
const BORDA_ERRO = "1.5px solid #e53e3e";

const FREQUENCIAS: readonly Frequencia[] = ["mensal", "pontual", "trimestral", "semestral"];

export function ListaItens({
  itens,
  errors,
  prefixoErro,
  rotulos,
  onAdicionar,
  onRemover,
  onAtualizar,
}: {
  itens: ItemLista[];
  errors: Record<string, string>;
  prefixoErro: string;
  rotulos: RotulosLista;
  onAdicionar: () => void;
  onRemover: (i: number) => void;
  onAtualizar: (i: number, patch: Partial<ItemLista>) => void;
}) {
  return (
    <div className="mt-3">
      {/* Cabeçalho (telas largas) — no mobile os campos se explicam pelo placeholder. */}
      <div
        className="mb-1 hidden gap-2.5 px-1 text-[10px] font-semibold uppercase tracking-wide sm:grid"
        style={{ gridTemplateColumns: GRADE, color: "#9a9aa8" }}
      >
        <span>{rotulos.colunaNome}</span>
        <span className="text-center">Valor (R$)</span>
        <span className="text-center">Frequência</span>
        <span />
      </div>

      <div className="space-y-2.5">
        {itens.map((item, i) => {
          const erroNome = errors[`${prefixoErro}${i}nome`];
          const erroValor = errors[`${prefixoErro}${i}valor`];
          const erroFreq = errors[`${prefixoErro}${i}frequencia`];
          const erroDesc = errors[`${prefixoErro}${i}descricao`];
          const linhaErro = erroNome || erroValor || erroFreq || erroDesc;
          return (
            <div
              key={i}
              className="rounded-xl p-2.5"
              style={{
                background: "var(--go-white)",
                border: "1.5px solid rgba(215,219,0,0.18)",
                animation: "go-step-in 0.3s ease",
              }}
            >
              <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: GRADE }}>
                <input
                  type="text"
                  placeholder={rotulos.placeholderNome}
                  aria-label={rotulos.ariaNome}
                  aria-invalid={erroNome ? true : undefined}
                  value={item.nome}
                  onChange={(e) => onAtualizar(i, { nome: e.target.value })}
                  className="go-input w-full"
                  style={{
                    height: 38,
                    padding: "0 10px",
                    borderRadius: "var(--go-radius-md)",
                    border: erroNome ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                  }}
                />
                {/* Máscara de moeda BR (só dígitos → 1.234,56), a régua do repo. */}
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={rotulos.placeholderValor}
                  aria-label={rotulos.ariaValor}
                  aria-invalid={erroValor ? true : undefined}
                  value={item.valor}
                  onChange={(e) => onAtualizar(i, { valor: formatMoedaBR(e.target.value) })}
                  className="go-input w-full"
                  style={{
                    height: 38,
                    padding: "0 6px",
                    borderRadius: "var(--go-radius-md)",
                    textAlign: "center",
                    border: erroValor ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                  }}
                />
                <select
                  aria-label={rotulos.ariaFrequencia}
                  aria-invalid={erroFreq ? true : undefined}
                  value={item.frequencia}
                  onChange={(e) =>
                    onAtualizar(i, { frequencia: e.target.value as Frequencia | "" })
                  }
                  className="go-select w-full"
                  style={{
                    height: 38,
                    padding: "0 6px",
                    borderRadius: "var(--go-radius-md)",
                    border: erroFreq ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 12.5,
                    color: item.frequencia ? "var(--go-text-primary)" : "#8b8b9a",
                  }}
                >
                  <option value="">Selecione...</option>
                  {FREQUENCIAS.map((f) => (
                    <option key={f} value={f}>
                      {TIPO_SAVING_LABEL[f]}
                    </option>
                  ))}
                </select>
                {/* Sempre presente: `removerItem` devolve uma linha em branco no lugar da
                    última, então remover nunca deixa a tela sem linha. */}
                <button
                  type="button"
                  onClick={() => onRemover(i)}
                  aria-label={rotulos.ariaRemover}
                  className="flex h-[38px] w-7 items-center justify-center rounded-lg transition-colors"
                  style={{ color: "#b4313b", background: "transparent" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(180,49,59,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>

              <input
                type="text"
                placeholder={rotulos.placeholderDescricao}
                aria-label={rotulos.ariaDescricao}
                aria-invalid={erroDesc ? true : undefined}
                value={item.descricao}
                onChange={(e) => onAtualizar(i, { descricao: e.target.value })}
                className="go-input mt-2 w-full"
                style={{
                  padding: "9px 10px",
                  borderRadius: "var(--go-radius-md)",
                  border: erroDesc ? BORDA_ERRO : BORDA,
                  background: "var(--go-white)",
                  fontSize: 13,
                }}
              />

              {linhaErro ? (
                <div
                  className="mt-1.5 text-[11px] font-medium"
                  style={{ color: "#e53e3e", animation: "go-slide-down 0.2s ease" }}
                >
                  {linhaErro}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAdicionar}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-semibold transition-colors"
        style={{
          color: "#6b6e00",
          background: "transparent",
          border: "1.5px dashed rgba(215,219,0,0.45)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(215,219,0,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {rotulos.botaoAdicionar}
      </button>
    </div>
  );
}
