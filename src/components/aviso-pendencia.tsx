import { useState } from "react";
import { Ban, CalendarClock, ChevronDown, RotateCcw } from "lucide-react";

// Aviso de pendência/veredito exibido no card de "Meus Projetos" e na tela read-only
// do projeto. Três tons, MESMO desenho — antes cada tela redigia o seu (11px na lista,
// 12,5px no detalhe) e o motivo escrito pelo analisador/triagem saía como texto corrido
// no mesmo tamanho do texto institucional, sem medida travada.
//
// ⚠️ Estado PADRÃO é uma TIRA DE UMA LINHA. O card de um projeto reprovado tem de ter a
// mesma altura dos vizinhos — a lista é para escanear, e a coluna "Motivo Reprovado"
// aceita 4000 caracteres. O parecer abre só quando a pessoa pede.
//
// Aberto, o MOTIVO é o conteúdo principal: superfície própria (placa clara), corpo maior,
// entrelinha folgada e medida travada em `ch`. O texto institucional fica subordinado.
export type TomAviso = "legado" | "reenvio" | "reprovado";

type Tema = {
  // Barra de acento + tinta do painel.
  bar: string;
  bg: string;
  // Título do veredito.
  titulo: string;
  // Rótulo da placa e do botão de abrir (10-11px).
  rotulo: string;
  // Corpo do motivo — o texto de maior contraste do bloco.
  motivo: string;
  // Texto institucional / "o que fazer" — subordinado.
  secundario: string;
  // Hairline da placa.
  placaBorda: string;
  icone: React.ReactNode;
  // Nomeia o conteúdo da placa pelo que a pessoa quer saber, não pelo campo do sistema.
  legenda: string;
  // Rótulo do botão que abre a tira. Diz o que a pessoa vai ler, não "expandir".
  acao: string;
};

const ICONE = "h-3.5 w-3.5";

const TEMAS: Record<TomAviso, Tema> = {
  legado: {
    bar: "#f59e0b",
    bg: "rgba(245,158,11,0.07)",
    titulo: "#78350f",
    rotulo: "#b45309",
    motivo: "#78350f",
    secundario: "#92400e",
    placaBorda: "rgba(180,83,9,0.16)",
    icone: <CalendarClock className={ICONE} />,
    legenda: "Observação",
    acao: "Ver observação",
  },
  reprovado: {
    bar: "#475569",
    bg: "rgba(71,85,105,0.05)",
    titulo: "#1e293b",
    rotulo: "#64748b",
    motivo: "#1e293b",
    secundario: "#64748b",
    placaBorda: "rgba(71,85,105,0.16)",
    icone: <Ban className={ICONE} />,
    // Não repete "reprovado" (o selo de status e o título do painel já dizem) — nomeia
    // QUEM escreveu o texto, que é a informação que falta ao autor.
    legenda: "Parecer da análise",
    acao: "Ver motivo",
  },
  reenvio: {
    bar: "#dc2626",
    bg: "rgba(220,38,38,0.05)",
    titulo: "#991b1b",
    rotulo: "#b91c1c",
    motivo: "#7f1d1d",
    secundario: "#b91c1c",
    placaBorda: "rgba(220,38,38,0.16)",
    icone: <RotateCcw className={ICONE} />,
    legenda: "O que precisa ser ajustado",
    acao: "Ver o que ajustar",
  },
};

// Medida legível do parecer aberto: o card ocupa a largura toda em desktop e o texto
// corrido chegava a 120+ caracteres por linha.
const MEDIDA = "72ch";

export function AvisoPendencia({
  tone,
  titulo,
  texto,
  motivo,
}: {
  tone: TomAviso;
  titulo: string;
  // Texto institucional (o que aconteceu / o que fazer). Com motivo presente ele é
  // subordinado e só aparece aberto; sozinho, assume o corpo legível na própria tira.
  texto?: string;
  // Motivo escrito pelo analisador ou pela triagem — o autor precisa ver o PORQUÊ, não
  // só o selo. Ausente (legado/análise antiga) → não há o que expandir.
  motivo?: string | null;
}) {
  const tema = TEMAS[tone];
  const textoMotivo = motivo?.trim();
  const [aberto, setAberto] = useState(false);

  // Sem motivo (legado): nada a expandir, então a tira já traz o texto institucional.
  if (!textoMotivo) {
    return (
      <div
        className="mt-2.5 rounded-lg py-2 pl-3 pr-3.5"
        style={{ background: tema.bg, borderLeft: `3px solid ${tema.bar}`, maxWidth: MEDIDA }}
      >
        {/* Estado nunca só por cor: ícone + rótulo escrito. */}
        <p
          className="flex items-center gap-1.5 text-[13px] font-bold"
          style={{ color: tema.titulo }}
        >
          <span className="shrink-0" aria-hidden>
            {tema.icone}
          </span>
          {titulo}
        </p>
        {texto && (
          <p className="mt-1 text-[12.5px]" style={{ color: tema.secundario, lineHeight: 1.5 }}>
            {texto}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-2.5 overflow-hidden rounded-lg"
      style={{ background: tema.bg, borderLeft: `3px solid ${tema.bar}` }}
    >
      {/* A tira inteira é o controle — alvo de clique generoso, e o teclado pega um
          botão só (não um link + um botão). */}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 py-2 pl-3 pr-3.5 text-left"
      >
        {/* Estado nunca só por cor: ícone + rótulo escrito. */}
        <span className="shrink-0" style={{ color: tema.titulo }} aria-hidden>
          {tema.icone}
        </span>
        <span className="text-[13px] font-bold" style={{ color: tema.titulo }}>
          {titulo}
        </span>
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold underline decoration-dotted underline-offset-2"
          style={{ color: tema.rotulo }}
        >
          {aberto ? "Ocultar" : tema.acao}
          <ChevronDown
            className="h-3 w-3 transition-transform motion-reduce:transition-none"
            style={{ transform: aberto ? "rotate(180deg)" : undefined }}
            aria-hidden
          />
        </span>
      </button>
      {aberto && (
        <div className="pb-2.5 pl-3 pr-3.5" style={{ maxWidth: MEDIDA }}>
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: "var(--go-white)", border: `1px solid ${tema.placaBorda}` }}
          >
            <p
              className="text-[10px] font-bold uppercase"
              style={{ color: tema.rotulo, letterSpacing: "0.08em" }}
            >
              {tema.legenda}
            </p>
            <p
              className="mt-1 whitespace-pre-wrap text-[13px]"
              style={{ color: tema.motivo, lineHeight: 1.6 }}
            >
              {textoMotivo}
            </p>
          </div>
          {texto && (
            <p className="mt-2 text-[11.5px]" style={{ color: tema.secundario, lineHeight: 1.5 }}>
              {texto}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
