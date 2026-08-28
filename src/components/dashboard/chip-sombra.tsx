/**
 * Chip da coluna "Sombra" da triagem — a recomendação do time de agentes de avaliação
 * (fatia B) ao lado da decisão humana, para o TESTE SOMBRA.
 *
 * O que a triagem precisa ver de relance é o veredito E, com destaque, a CONFIANÇA do
 * agente — por isso o percentual vem como número em negrito, colorido pelo grau. Estado
 * NUNCA só por cor (regra 11): sempre acompanha o % em texto e o rótulo do grau, e a
 * divergência/aplicar levam ícone com rótulo acessível. Mesma estrutura de pílula do
 * `ChipEstadoParecer`.
 */
import { AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import {
  rotuloVeredito,
  rotuloGrau,
  pctConfianca,
  grauConfianca,
  aparenciaConfianca,
} from "@/lib/avaliacao-sombra-rotulos";

export type SombraChipDados = {
  veredito: string;
  confianca: number | null;
  divergencia: boolean;
  aplicar: boolean;
};

export function ChipSombra({
  dados,
  voto,
}: {
  dados: SombraChipDados | null;
  voto?: "like" | "dislike" | null;
}) {
  // Sem recomendação do agente: "—" quieto (o agente ainda não avaliou este projeto).
  if (!dados) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>;
  }
  const a = aparenciaConfianca(dados.confianca);
  const grau = typeof dados.confianca === "number" ? grauConfianca(dados.confianca) : null;
  const pct = pctConfianca(dados.confianca);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
        title={`${rotuloVeredito(dados.veredito)} · ${rotuloGrau(grau)} (${pct})`}
      >
        <span>{rotuloVeredito(dados.veredito)}</span>
        {/* CONFIANÇA em destaque: número em negrito, cor pelo grau, com um ponto de reforço
            para não depender só da cor. */}
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: a.cor }}
          />
          <span className="text-[12.5px] font-bold tabular-nums">{pct}</span>
        </span>
      </span>
      {(dados.divergencia || dados.aplicar) && (
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: "#8a5a00" }}
          aria-label={dados.divergencia ? "Divergência entre os especialistas" : "Recomenda aplicar"}
        />
      )}
      {voto === "like" && (
        <ThumbsUp className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Você concordou" />
      )}
      {voto === "dislike" && (
        <ThumbsDown className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Você discordou" />
      )}
    </span>
  );
}
