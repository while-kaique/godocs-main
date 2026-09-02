import * as React from "react";
import { Send } from "lucide-react";
import { AvisoBloqueio } from "@/components/aviso-bloqueio";
import type { BloqueioSubmissao } from "@/lib/mensagens-submissao";
import { SummaryRow } from "./form-components";
import { GANHO_ROTULOS, TIPOS_RECEITA } from "@/lib/ganhos-rotulos";
import { TIPO_SAVING_LABEL, unidadeHoras } from "@/lib/projeto-rotulos";
import { ordemBlocos } from "./acordeao-estado";
import { totalHorasLiberadas } from "./horas";
import { listaVazia } from "./itens-lista";
import { anexosUteis } from "./evidencia";
import type { FormData } from "./constants";
import type { GanhosFormData } from "./validacao-etapa3";

/**
 * REVISÃO antes do envio (última tela da Etapa 3).
 *
 * Existe porque o clique que dispara a submissão não pode ser o mesmo que descobre que
 * falta preencher algo: a Etapa 3 valida, esta tela mostra o que vai ser gravado, e o
 * envio é o clique seguinte.
 *
 * ⚠️ Mostra os valores que a PESSOA declarou (saving efetivado, não contratado, receita) e
 * as horas como HORAS. O R$ derivado das horas continua invisível aqui: quem converte hora
 * em dinheiro é o backend (`resolverValorHora`), e exibir valor/hora ao submissor induz
 * manipulação do número — decisão da v1 que a v2 mantém.
 *
 * ⚠️ Não recalcula nem exibe o IMPACTO. O impacto é derivado de `impacto.ts` no servidor,
 * a partir do que foi gravado; mostrar aqui uma segunda conta feita no cliente seria a
 * sexta réplica da fórmula — exatamente o que esta frente existe para acabar.
 */
export function RevisaoGanhos({
  form,
  ganhos,
  bloqueio,
  submitting,
  onEditar,
  onEnviar,
  ferramenta,
}: {
  form: FormData;
  ganhos: GanhosFormData;
  bloqueio: BloqueioSubmissao | null;
  submitting: boolean;
  onEditar: () => void;
  onEnviar: () => void;
  ferramenta: string;
}) {
  const categorias = ordemBlocos(form.ganhoCategorias ?? []);
  const freq = (f: string) => (f ? (TIPO_SAVING_LABEL[f] ?? f) : "—");
  const reais = (v: string) => (v.trim() === "" ? "—" : `R$ ${v}`);

  const custosDeclarados = listaVazia(ganhos.custoRodar) ? [] : ganhos.custoRodar;

  return (
    <div className="px-6 py-6 sm:px-8">
      <h2 className="text-[17px] font-bold" style={{ color: "var(--go-text-primary)" }}>
        Confira antes de enviar
      </h2>
      <p className="mt-1 mb-5 text-[12.5px]" style={{ color: "#7b7b8a" }}>
        É isto que vai para a triagem. Depois do envio, mudanças passam por reenvio.
      </p>

      <div className="rounded-xl p-3.5" style={{ background: "var(--go-cream)" }}>
        <SummaryRow label="Projeto" value={form.nomeProjeto.trim() || "—"} />
        <SummaryRow
          label={form.escopo === "externo" ? "Serviço externo" : "Ferramenta"}
          value={(form.escopo === "externo" ? form.servicoExterno : ferramenta) || "—"}
        />
        <SummaryRow
          label="Time"
          value={
            form.participantes.length > 0
              ? `${form.participantes.length} participante(s)`
              : "Só você"
          }
          last
        />
      </div>

      {categorias.map((categoria) => (
        <div
          key={categoria}
          className="mt-3 rounded-xl p-3.5"
          style={{ background: "var(--go-white)", border: "1.5px solid rgba(0,89,169,0.14)" }}
        >
          <h3
            className="mb-2 text-[13px] font-bold"
            style={{ color: "var(--go-blue)" }}
          >
            {GANHO_ROTULOS[categoria].titulo}
          </h3>

          {categoria === "saving_efetivado" ? (
            <>
              <SummaryRow label="Valor" value={reais(ganhos.savingValor)} />
              <SummaryRow label="Frequência" value={freq(ganhos.savingFrequencia)} />
              <SummaryRow label="Desde" value={ganhos.savingDesde || "—"} />
              <SummaryRow
                label="Comprovação"
                value={
                  anexosUteis(ganhos.savingAnexos).length > 0
                    ? `Texto + ${anexosUteis(ganhos.savingAnexos).length} anexo(s)`
                    : "Texto"
                }
                last
              />
            </>
          ) : null}

          {categoria === "custo_evitado" ? (
            <>
              {/* Horas em HORAS — o R$ delas é derivado no servidor. */}
              <SummaryRow
                label="Horas liberadas"
                value={
                  totalHorasLiberadas(ganhos.ceLinhas) > 0
                    ? `${totalHorasLiberadas(ganhos.ceLinhas).toLocaleString("pt-BR", {
                        maximumFractionDigits: 2,
                      })} ${unidadeHoras(ganhos.ceFrequencia || "mensal")}`
                    : "—"
                }
              />
              <SummaryRow label="Não contratado" value={reais(ganhos.ceNaoContratado)} />
              <SummaryRow label="Frequência" value={freq(ganhos.ceFrequencia)} last />
            </>
          ) : null}

          {categoria === "receita_incremental" ? (
            <>
              <SummaryRow label="Valor" value={reais(ganhos.receitaValor)} />
              <SummaryRow label="Frequência" value={freq(ganhos.receitaFrequencia)} />
              <SummaryRow
                label="De onde vem"
                value={
                  TIPOS_RECEITA.find((t) => t.value === ganhos.receitaTipo)?.label ?? "—"
                }
                last
              />
            </>
          ) : null}

          {categoria === "imensuravel" ? (
            <p className="text-[12.5px] leading-relaxed" style={{ color: "#5b5b6a" }}>
              {ganhos.imensuravelRacional.trim() || "—"}
            </p>
          ) : null}
        </div>
      ))}

      <div
        className="mt-3 rounded-xl p-3.5"
        style={{ background: "var(--go-white)", border: "1.5px solid rgba(0,0,0,0.08)" }}
      >
        <h3 className="mb-2 text-[13px] font-bold" style={{ color: "#5b5b6a" }}>
          Custo para rodar
        </h3>
        {custosDeclarados.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: "#8b8b9a" }}>
            Nenhum custo declarado.
          </p>
        ) : (
          custosDeclarados.map((item, i) => (
            <SummaryRow
              key={i}
              label={item.nome || "—"}
              value={`${reais(item.valor)} · ${freq(item.frequencia)}`}
              last={i === custosDeclarados.length - 1}
            />
          ))
        )}
      </div>

      {bloqueio ? (
        <div className="mt-4">
          <AvisoBloqueio bloqueio={bloqueio} />
        </div>
      ) : null}

      <div className="mt-7 flex items-center justify-between gap-3">
        {/* Mesmas pílulas do resto do wizard: `.go-btn-back` para voltar e, no envio, a
            LIME `.go-btn-submit` — a mesma que fechava a submissão na v1. */}
        <button type="button" onClick={onEditar} disabled={submitting} className="go-btn-back">
          &larr; Editar
        </button>
        <button
          type="button"
          onClick={onEnviar}
          disabled={submitting}
          className="go-btn-submit inline-flex items-center justify-center gap-2"
          style={{ width: "auto" }}
        >
          {submitting ? (
            <>
              <span>Enviando…</span>
              <div className="go-spinner" />
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden />
              <span>Enviar para Triagem</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
