/**
 * Cartão do quadro da triagem — a unidade que as três telas antigas desenhavam cada uma do
 * seu jeito, agora com um desenho só.
 *
 * O que ele carrega é o que a decisão exige de relance, na ordem em que a dúvida aparece:
 * **o que é** (nome, especial) → **de quem** (autor, área) → **em que pé** (status, espera,
 * parecer do líder) → **quanto vale** (impacto líquido, categorias) → **o que os agentes
 * acham** (nota e veredito) → **o que fazer** (as três decisões).
 *
 * ⚠️ Estado NUNCA só por cor (regra 11): todo chip leva ícone ou rótulo em texto. A espera
 * fica vermelha aos 60 dias, mas também diz "60 dias esperando".
 *
 * ⚠️ As decisões gravam pela MESMA rota da lista (`POST /api/admin/dashboard/status` →
 * `definirStatusProjeto`), com a mesma auditoria e a mesma regra de nunca tocar
 * "Atualizado Em". Aqui só mora a apresentação — a régua de quando o motivo é obrigatório
 * é do `especiais-acoes.ts`.
 */
import { useState } from "react";
import { Ban, Check, Loader2, RotateCcw, Sparkles, Star, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { ChipAjusteFeito } from "@/components/dashboard/chip-ajuste-feito";
import { ChipAgente, type AgenteChipDados } from "@/components/dashboard/chip-agente";
import {
  PERGUNTA_MOTIVO,
  acoesDisponiveis,
  precisaMotivo,
  rotuloAcao,
  type AcaoTriagem,
} from "@/lib/especiais-acoes";
import { aguardaDecisao, diasDeEspera, urgenciaDaEspera } from "@/lib/especiais-view";
import { fmtDataBR } from "@/lib/format-date";
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";

const AZUL = "var(--go-blue)";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/**
 * Tom de cada decisão. Verde/âmbar/vermelho acompanham SEMPRE um ícone e o verbo escrito —
 * ver a regra de a11y acima.
 */
const TOM_ACAO = {
  ok: { cor: "#17714f", fundo: "rgba(23,113,79,0.10)" },
  atencao: { cor: "#8a6a00", fundo: "rgba(224,168,0,0.14)" },
  critico: { cor: "#b3261e", fundo: "rgba(179,38,30,0.10)" },
} as const;

export function CartaoQuadro({
  projeto,
  agente,
  voto,
  ajusteFeito,
  agoraMs,
  salvando,
  selecionado,
  onSelecionar,
  onDecidir,
  onAbrirFicha,
  onAquecer,
}: {
  projeto: ProjetoDashboardResumo;
  agente: AgenteChipDados | null;
  voto: "like" | "dislike" | null;
  /** O autor já voltou de um "Ajuste pedido" neste projeto. */
  ajusteFeito: boolean;
  agoraMs: number;
  salvando: boolean;
  selecionado: boolean;
  onSelecionar: (marcado: boolean) => void;
  onDecidir: (acao: AcaoTriagem, motivo: string) => void;
  onAbrirFicha: () => void;
  /** Prefetch da ficha por intenção (hover/foco) — ver `dashboard-detalhe-cache`. */
  onAquecer: () => void;
}) {
  const [acaoAberta, setAcaoAberta] = useState<AcaoTriagem | null>(null);
  const dias = aguardaDecisao(projeto) ? diasDeEspera(projeto, agoraMs) : null;
  const urgencia = urgenciaDaEspera(dias);
  const disponiveis = acoesDisponiveis(projeto.statusChave);

  return (
    <article
      onMouseEnter={onAquecer}
      onFocus={onAquecer}
      className="rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md focus-within:shadow-md motion-reduce:transition-none"
      style={{
        borderColor: selecionado ? AZUL : "var(--border)",
        boxShadow: selecionado ? `0 0 0 1px ${AZUL}` : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label={`Selecionar ${projeto.nome ?? projeto.id}`}
          checked={selecionado}
          onChange={(e) => onSelecionar(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[#0059A9]"
        />
        <button
          type="button"
          onClick={onAbrirFicha}
          className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          style={{ ["--tw-ring-color" as string]: AZUL }}
          title="Abrir a ficha completa"
        >
          <span className="flex items-center gap-1.5">
            <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
              {projeto.nome ?? projeto.id}
            </span>
            {projeto.especial && (
              <Sparkles
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: "#8a7d00" }}
                aria-label="Projeto especial"
              />
            )}
          </span>
        </button>
        {salvando && (
          <Loader2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-label="Salvando"
          />
        )}
      </div>

      {(projeto.autor || projeto.area) && (
        <p className="mt-1 truncate pl-[22px] text-[11.5px] text-muted-foreground">
          {[projeto.autor, projeto.area].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
        <StatusBadge status={projeto.statusChave} />
        {/* ⚠️ O chip do PARECER do líder saiu daqui em 14/09/2026: `Pré-aprovado` virou um
            STATUS, então o badge acima já diz o que ele dizia. O que sobra de informação
            nova é a VOLTA de um ajuste, que o status sozinho não conta. */}
        {ajusteFeito && <ChipAjusteFeito />}
        {dias != null && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            title={
              projeto.dataSubmissao ? `Submetido em ${fmtDataBR(projeto.dataSubmissao)}` : undefined
            }
            style={
              urgencia === "critica"
                ? { background: "rgba(179,38,30,0.12)", color: "#b3261e" }
                : urgencia === "atencao"
                  ? { background: "rgba(154,98,6,0.12)", color: "#9a6206" }
                  : { background: "var(--muted)", color: "var(--muted-foreground)" }
            }
          >
            <Clock className="h-3 w-3" aria-hidden />
            {dias} {dias === 1 ? "dia esperando" : "dias esperando"}
          </span>
        )}
        {projeto.estrelas != null && projeto.estrelas > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ background: "rgba(224,168,0,0.14)", color: "#8a6a00" }}
            title={`Nota da triagem: ${projeto.estrelas}`}
          >
            <Star className="h-3 w-3" style={{ color: "#e0a800" }} fill="#f5c518" aria-hidden />
            {projeto.estrelas}
          </span>
        )}
        <ChipAgente
          dados={agente}
          voto={voto}
          estrela={projeto.estrelaAgente}
          confianca={projeto.confiancaAgente}
        />
      </div>

      {(projeto.ganhoTotal != null || projeto.tipos) && (
        <div className="mt-2 flex items-baseline justify-between gap-2 pl-[22px]">
          <span className="truncate text-[11px] text-muted-foreground" title={projeto.tipos ?? ""}>
            {projeto.tipos ?? ""}
          </span>
          {projeto.ganhoTotal != null && (
            <span
              className="shrink-0 text-[12.5px] font-semibold tabular-nums"
              title="Impacto líquido"
            >
              {moeda.format(projeto.ganhoTotal)}
            </span>
          )}
        </div>
      )}

      {acaoAberta && precisaMotivo(acaoAberta) ? (
        <form
          className="mt-2.5 space-y-2 border-t pt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const campo = e.currentTarget.elements.namedItem("motivo") as HTMLTextAreaElement;
            const texto = campo.value.trim();
            if (!texto) return;
            setAcaoAberta(null);
            onDecidir(acaoAberta, texto);
          }}
        >
          <label
            className="block text-[11px] font-medium text-muted-foreground"
            htmlFor={`motivo-${projeto.id}`}
          >
            {PERGUNTA_MOTIVO[acaoAberta as "reenviar" | "reprovar"]}
          </label>
          <textarea
            id={`motivo-${projeto.id}`}
            name="motivo"
            autoFocus
            rows={3}
            maxLength={4000}
            className="w-full rounded-lg border px-2 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2"
            style={{ ["--tw-ring-color" as string]: AZUL }}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAcaoAberta(null)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm">
              {rotuloAcao(acaoAberta)}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
          {disponiveis.includes("aprovar") && (
            <BotaoAcao tom="ok" onClick={() => onDecidir("aprovar", "")}>
              <Check className="h-3 w-3" aria-hidden /> Aprovar
            </BotaoAcao>
          )}
          {disponiveis.includes("reenviar") && (
            <BotaoAcao tom="atencao" onClick={() => setAcaoAberta("reenviar")}>
              <RotateCcw className="h-3 w-3" aria-hidden /> Pedir reenvio
            </BotaoAcao>
          )}
          {disponiveis.includes("reprovar") && (
            <BotaoAcao tom="critico" onClick={() => setAcaoAberta("reprovar")}>
              <Ban className="h-3 w-3" aria-hidden /> Reprovar
            </BotaoAcao>
          )}
          <button
            type="button"
            onClick={onAbrirFicha}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{ ["--tw-ring-color" as string]: AZUL }}
          >
            <ExternalLink className="h-3 w-3" aria-hidden /> Ficha
          </button>
        </div>
      )}
    </article>
  );
}

function BotaoAcao({
  onClick,
  tom,
  children,
}: {
  onClick: () => void;
  tom: keyof typeof TOM_ACAO;
  children: React.ReactNode;
}) {
  const { cor, fundo } = TOM_ACAO[tom];
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{ color: cor, background: fundo, ["--tw-ring-color" as string]: AZUL }}
    >
      {children}
    </button>
  );
}
