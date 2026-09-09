/**
 * Chip da coluna "Agente" da triagem — o que o time de agentes concluiu, ao lado da
 * decisão humana.
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
import { AlertTriangle, ThumbsUp, ThumbsDown, Star } from "lucide-react";
import {
  rotuloVeredito,
  rotuloGrau,
  grauConfianca,
  aparenciaConfianca,
  aparenciaGrauTexto,
} from "@/lib/avaliacao-sombra-rotulos";

export type AgenteChipDados = {
  veredito: string;
  confianca: number | null;
  divergencia: boolean;
  aplicar: boolean;
};

export function ChipAgente({
  dados,
  voto,
  estrela,
  confianca,
}: {
  dados: AgenteChipDados | null;
  voto?: "like" | "dislike" | null;
  /** A nota que o agente sugere: `"0".."5"` ou `"6-10"`. */
  estrela?: string | null;
  /** O GRAU da confiança do classificador (alta/media/baixa). */
  confianca?: string | null;
}) {
  // Sem NADA do agente: "—" quieto (ninguém rodou neste projeto ainda). ⚠️ A nota sozinha já
  // conta como "o agente passou por aqui": a estrela e o veredito vêm de rodadas que podem ter
  // acontecido em momentos diferentes, e esconder a nota porque falta o veredito apagaria
  // justamente o que a triagem procura.
  if (!dados && !estrela) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>;
  }
  const a = aparenciaConfianca(dados?.confianca ?? null);
  const grau = typeof dados?.confianca === "number" ? grauConfianca(dados.confianca) : null;
  const titulo = [
    dados ? rotuloVeredito(dados.veredito) : null,
    estrela ? `nota sugerida ${estrela}` : null,
    dados ? rotuloGrau(grau) : confianca ? `confiança ${confianca}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
        title={titulo}
      >
        {/* O VEREDITO (há impacto?) e a NOTA (quanto vale) na MESMA pílula: o time conclui as
            duas coisas na mesma passada, e separá-las na tela sugeriria duas decisões. */}
        {dados && <span>{rotuloVeredito(dados.veredito)}</span>}
        {estrela && (
          <span className="inline-flex items-center gap-0.5 tabular-nums">
            <Star className="h-3 w-3" aria-hidden />
            {estrela}
          </span>
        )}
        {/* O GRAU em palavra, com um ponto de reforço para não depender só da cor. */}
        {(grau || confianca) && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: a.cor }}
            />
            <span className="text-[11px] font-semibold">
              {/* ⚠️ A cor segue o GRAU (alta verde · média amarelo · baixa cinza), e a palavra
                  fica: cor acompanha o rótulo, nunca o substitui. */}
              <span style={{ color: aparenciaGrauTexto(grau ?? confianca).cor, fontWeight: 700 }}>
                {grau ? rotuloGrau(grau).replace("confiança ", "") : confianca}
              </span>
            </span>
          </span>
        )}
      </span>
      {dados && (dados.divergencia || dados.aplicar) && (
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
