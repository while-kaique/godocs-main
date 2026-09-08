/**
 * Chip da coluna "Sombra" da triagem — a recomendação do time de agentes de avaliação
 * (fatia B) ao lado da decisão humana, para o TESTE SOMBRA.
 *
 * O que a triagem precisa ver de relance é o veredito E, com destaque, o quanto se pode
 * confiar nele. ⚠️ Até 08/09/2026 isso era o **percentual do float interno** — que é o placar
 * da votação, não uma medida (ver `pctConfianca`, removida). Agora o destaque é a **frequência
 * MEDIDA** daquela faixa contra a triagem, escrita como FRAÇÃO (`8`/`10`, denominador em peso
 * leve) para se ler como "bate 8 vezes em 10" e não como nota. Faixa sem amostra não exibe
 * número nenhum: exibe o grau em palavra, e o `title` diz que ainda não há medição.
 *
 * Estado NUNCA só por cor (regra 11): o grau vai em texto no `title`, o ponto reforça o grau, e
 * divergência/aplicar levam ícone com rótulo acessível. Mesma estrutura de pílula do
 * `ChipEstadoParecer`.
 */
import { AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import {
  rotuloVeredito,
  rotuloGrau,
  medicaoDaConfianca,
  grauConfianca,
  aparenciaConfianca,
} from "@/lib/avaliacao-sombra-rotulos";
import type { Calibragem } from "@/lib/avaliacao-calibragem";

export type SombraChipDados = {
  veredito: string;
  confianca: number | null;
  divergencia: boolean;
  aplicar: boolean;
};

export function ChipSombra({
  dados,
  voto,
  calibragem,
}: {
  dados: SombraChipDados | null;
  voto?: "like" | "dislike" | null;
  /** A calibragem por faixa (a mesma da ficha). Ausente → nenhum número é exibido. */
  calibragem?: Calibragem | null;
}) {
  // Sem recomendação do agente: "—" quieto (o agente ainda não avaliou este projeto).
  if (!dados) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>;
  }
  const a = aparenciaConfianca(dados.confianca);
  const grau = typeof dados.confianca === "number" ? grauConfianca(dados.confianca) : null;
  const { medicao, emDez } = medicaoDaConfianca(dados.confianca, calibragem);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
        title={`${rotuloVeredito(dados.veredito)} · ${rotuloGrau(grau)} · ${medicao}`}
      >
        <span>{rotuloVeredito(dados.veredito)}</span>
        {/* A MEDIÇÃO em destaque, com um ponto de reforço para não depender só da cor. */}
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: a.cor }}
          />
          {emDez == null ? (
            /* Sem amostra na faixa: o grau em PALAVRA. Nenhum número — "0 de 10" se leria como
               "erra sempre", e é justamente a mentira que esta mudança desfaz. */
            <span className="text-[11px] font-semibold">{rotuloGrau(grau).replace("confiança ", "")}</span>
          ) : (
            <span className="inline-flex items-baseline gap-[1px] tabular-nums">
              <span className="text-[12.5px] font-bold">{emDez}</span>
              <span className="text-[10px] font-medium opacity-70">/10</span>
            </span>
          )}
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
