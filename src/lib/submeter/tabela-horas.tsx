import * as React from "react";
import { Plus, X } from "lucide-react";
import { InfoTooltip } from "./form-components";
import { unidadeHoras } from "@/lib/projeto-rotulos";
import {
  FUNCAO_OUTRO,
  FUNCOES_HORAS,
  precisaDescricaoFuncao,
  totalHorasLiberadas,
  type LinhaHorasInput,
} from "./horas";
import type { Frequencia } from "@/lib/impacto";

/**
 * TABELA DE HORAS antes/depois por função — o braço "horas liberadas" do CUSTO EVITADO.
 *
 * Por que vive no custo evitado e não no saving (D1): hora liberada de quem continua na
 * folha **não é dinheiro no bolso**, é capacidade que se deixou de precisar comprar. Não
 * existe extrato de algo que não aconteceu, logo não pede evidência e pesa 50%.
 *
 * O que é NOVO em relação à v1 (não é extração, é funcionalidade):
 *  - a opção **"Outro"** com campo de descrição livre — a v1 só oferecia os 7 cargos
 *    canônicos, e quem não se reconhecia neles escolhia o mais próximo;
 *  - o **tooltip por função**, reusando o `InfoTooltip` (portal, hover E foco de
 *    teclado), para a pessoa saber que a função descreve QUEM fazia, não o cargo formal.
 *
 * ⚠️ INVARIANTE: nenhum R$ por hora aparece aqui. `FUNCOES_HORAS` traz só os rótulos, o
 * total mostrado é em HORAS, e o R$ é derivado no backend (`resolverValorHora`). Exibir
 * valor/hora ao submissor induz manipulação — é decisão declarada desde a v1.
 *
 * Componente BURRO: a régua (parse pt-BR, `depois > antes`, descrição do "Outro",
 * total) vive em `horas.ts`.
 */
const BORDA = "1.5px solid rgba(215,219,0,0.2)";
const BORDA_ERRO = "1.5px solid #e53e3e";

export function TabelaHoras({
  linhas,
  frequencia,
  errors,
  onAdicionar,
  onRemover,
  onAtualizar,
}: {
  linhas: LinhaHorasInput[];
  /** Só para rotular a unidade ("h/mês", "h/trimestre"…). Não entra em conta nenhuma. */
  frequencia: Frequencia | "";
  errors: Record<string, string>;
  onAdicionar: () => void;
  onRemover: (i: number) => void;
  onAtualizar: (i: number, patch: Partial<LinhaHorasInput>) => void;
}) {
  const unidade = unidadeHoras(frequencia || "mensal");
  const total = totalHorasLiberadas(linhas);
  const grade = "1fr 82px 82px 28px";

  return (
    <div className="mt-3">
      <div
        className="mb-1 hidden gap-2.5 px-1 text-[10px] font-semibold uppercase tracking-wide sm:grid"
        style={{ gridTemplateColumns: grade, color: "#9a9aa8" }}
      >
        <span className="flex items-center gap-1">
          Função
          <InfoTooltip
            largura={280}
            ariaLabel="O que preencher no campo de função"
          >
            Descreva <strong>quem fazia o trabalho</strong>, não o cargo formal da pessoa.
            Se nenhuma opção servir, escolha “{FUNCAO_OUTRO}” e escreva a função em uma
            linha.
          </InfoTooltip>
        </span>
        {/* ⚠️ "Horas antes" / "Horas depois", escrito assim (pedido do Luis, 02/09/2026).
            Era "Antes ({unidade})" / "Depois ({unidade})": a unidade entre parênteses
            roubava a palavra que importa e o cabeçalho lia como duas datas. A unidade do
            período segue no rótulo do campo (`aria-label`) e na pergunta acima da
            tabela. */}
        <span className="text-center">Horas antes</span>
        <span className="text-center">Horas depois</span>
        <span />
      </div>

      <div className="space-y-2.5">
        {linhas.map((linha, i) => {
          const erroFuncao = errors[`h${i}funcao`];
          const erroDescricao = errors[`h${i}descricao`];
          const erroAntes = errors[`h${i}antes`];
          const erroDepois = errors[`h${i}depois`];
          const linhaErro = erroFuncao || erroDescricao || erroAntes || erroDepois;
          const pedeDescricao = precisaDescricaoFuncao(linha.funcao);
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
              <div className="grid items-start gap-2.5" style={{ gridTemplateColumns: grade }}>
                <select
                  aria-label="Função de quem fazia o trabalho"
                  aria-invalid={erroFuncao ? true : undefined}
                  value={linha.funcao}
                  onChange={(e) => onAtualizar(i, { funcao: e.target.value })}
                  className="go-select w-full"
                  style={{
                    height: 38,
                    padding: "0 8px",
                    borderRadius: "var(--go-radius-md)",
                    border: erroFuncao ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                    color: linha.funcao ? "var(--go-text-primary)" : "#8b8b9a",
                  }}
                >
                  <option value="">Selecione a função...</option>
                  {FUNCOES_HORAS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="160"
                  aria-label={`Horas antes da automação (${unidade})`}
                  aria-invalid={erroAntes ? true : undefined}
                  value={linha.horasAntes}
                  onChange={(e) => onAtualizar(i, { horasAntes: e.target.value })}
                  className="go-input w-full"
                  style={{
                    height: 38,
                    padding: "0 6px",
                    borderRadius: "var(--go-radius-md)",
                    textAlign: "center",
                    border: erroAntes ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                  }}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`Horas depois da automação (${unidade})`}
                  aria-invalid={erroDepois ? true : undefined}
                  value={linha.horasDepois}
                  onChange={(e) => onAtualizar(i, { horasDepois: e.target.value })}
                  className="go-input w-full"
                  style={{
                    height: 38,
                    padding: "0 6px",
                    borderRadius: "var(--go-radius-md)",
                    textAlign: "center",
                    border: erroDepois ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                  }}
                />
                <button
                  type="button"
                  onClick={() => onRemover(i)}
                  aria-label="Remover esta função"
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

              {/* Só aparece em "Outro" — campo que não se aplica não fica na tela. */}
              {pedeDescricao ? (
                <input
                  type="text"
                  placeholder="Qual função? (ex: conferente do fiscal)"
                  aria-label="Descrição da função"
                  aria-invalid={erroDescricao ? true : undefined}
                  value={linha.funcaoDescricao}
                  onChange={(e) => onAtualizar(i, { funcaoDescricao: e.target.value })}
                  className="go-input mt-2 w-full"
                  style={{
                    padding: "9px 10px",
                    borderRadius: "var(--go-radius-md)",
                    border: erroDescricao ? BORDA_ERRO : BORDA,
                    background: "var(--go-white)",
                    fontSize: 13,
                  }}
                />
              ) : null}

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
        Adicionar outra função
      </button>

      {/* Total em HORAS — nunca em R$ (ver invariante no topo). Rótulo textual junto do
          número, porque estado/《quanto foi》 não se comunica só por posição. */}
      {total > 0 ? (
        <p className="mt-2 text-right text-[12px] font-semibold" style={{ color: "#6b6e00" }}>
          Total liberado: {total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}{" "}
          {unidade}
        </p>
      ) : null}
    </div>
  );
}
