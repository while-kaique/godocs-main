import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CalendarClock, ChevronDown, RotateCcw } from "lucide-react";

// Aviso de pendência/veredito exibido no card de "Meus Projetos" e na tela read-only
// do projeto. Três tons, MESMO desenho — antes cada tela redigia o seu (11px na lista,
// 12,5px no detalhe) e o motivo escrito pelo analisador/triagem saía como texto corrido
// no mesmo tamanho do texto institucional, sem medida travada.
//
// Leitura antes de decoração: o MOTIVO é o que o autor precisa ler, então ele ganha
// superfície própria (placa clara), corpo maior, entrelinha folgada e medida em `ch`.
// O texto institucional fica visivelmente subordinado, abaixo.
export type TomAviso = "legado" | "reenvio" | "reprovado";

type Tema = {
  // Barra de acento + tinta do painel.
  bar: string;
  bg: string;
  // Título do veredito.
  titulo: string;
  // Rótulo da placa do motivo (10px, caixa alta).
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
  },
};

// Linhas visíveis do motivo antes do "Ver motivo completo". A coluna do Sheets aceita
// 4000 caracteres — sem teto, um único projeto reprovado deixa o card 8x mais alto que
// os vizinhos e a lista para de ser escaneável.
const LINHAS_COLAPSADAS = 4;

// Placa do motivo: superfície própria, medida travada e disclosure quando o texto passa
// do teto. A medição é real (scrollHeight) para o botão não aparecer prometendo revelar
// nada — a heurística por nº de caracteres erra quando a triagem escreve com quebras.
function MotivoPlaca({ tema, texto }: { tema: Tema; texto: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [aberto, setAberto] = useState(false);
  const [transborda, setTransborda] = useState(false);

  const medir = useCallback(() => {
    const el = ref.current;
    // Só mede colapsado — aberto, scrollHeight === clientHeight sempre.
    if (!el || aberto) return;
    setTransborda(el.scrollHeight - el.clientHeight > 2);
  }, [aberto]);

  useEffect(() => {
    medir();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Poppins carregando depois do mount e resize da janela mudam a contagem de linhas.
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medir, texto]);

  return (
    <div
      className="mt-2 rounded-lg px-3 py-2.5"
      style={{ background: "var(--go-white)", border: `1px solid ${tema.placaBorda}` }}
    >
      <p
        className="text-[10px] font-bold uppercase"
        style={{ color: tema.rotulo, letterSpacing: "0.08em" }}
      >
        {tema.legenda}
      </p>
      <p
        ref={ref}
        className="mt-1 whitespace-pre-wrap text-[13px]"
        style={{
          color: tema.motivo,
          lineHeight: 1.6,
          ...(aberto
            ? {}
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: LINHAS_COLAPSADAS,
                overflow: "hidden",
              }),
        }}
      >
        {texto}
      </p>
      {(transborda || aberto) && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="mt-1.5 inline-flex items-center gap-1 rounded text-[11px] font-semibold underline decoration-dotted underline-offset-2"
          style={{ color: tema.rotulo }}
        >
          {aberto ? "Ver menos" : "Ver motivo completo"}
          <ChevronDown
            className="h-3 w-3 transition-transform motion-reduce:transition-none"
            style={{ transform: aberto ? "rotate(180deg)" : undefined }}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}

export function AvisoPendencia({
  tone,
  titulo,
  texto,
  motivo,
}: {
  tone: TomAviso;
  titulo: string;
  // Texto institucional (o que aconteceu / o que fazer). Com motivo presente ele é
  // subordinado; sozinho, assume o corpo legível.
  texto?: string;
  // Motivo escrito pelo analisador ou pela triagem — o autor precisa ver o PORQUÊ, não
  // só o selo. Ausente (legado/análise antiga) → o aviso aparece sem a placa.
  motivo?: string | null;
}) {
  const tema = TEMAS[tone];
  const temMotivo = Boolean(motivo && motivo.trim());
  return (
    <div
      className="mt-2.5 rounded-lg py-2.5 pl-3 pr-3.5"
      style={{
        background: tema.bg,
        borderLeft: `3px solid ${tema.bar}`,
        // Medida legível: o card ocupa a largura toda em desktop e o texto corrido
        // chegava a 120+ caracteres por linha. O teto vale para o bloco inteiro (painel,
        // placa e texto subordinado compartilham a mesma borda direita).
        maxWidth: "72ch",
      }}
    >
      {/* Estado nunca só por cor: ícone + rótulo escrito. */}
      <p className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: tema.titulo }}>
        <span className="shrink-0" aria-hidden>
          {tema.icone}
        </span>
        {titulo}
      </p>
      {temMotivo && <MotivoPlaca tema={tema} texto={motivo!.trim()} />}
      {texto && (
        <p
          className={temMotivo ? "mt-2 text-[11.5px]" : "mt-1 text-[13px]"}
          style={{
            color: temMotivo ? tema.secundario : tema.motivo,
            lineHeight: temMotivo ? 1.5 : 1.6,
          }}
        >
          {texto}
        </p>
      )}
    </div>
  );
}
