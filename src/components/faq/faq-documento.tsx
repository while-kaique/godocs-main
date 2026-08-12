// FAQ — o documento da categoria: títulos e explicações, um assunto por página.
//
// O ritmo de leitura é o que faz este texto ser escaneável: cada seção abre com um título
// marcado por um filete lima à esquerda, e a medida do texto fica travada em ~68ch (linha
// longa é o que tornava o FAQ antigo cansativo de ler).
//
// ⚠️ A marcação vem do parser PURO `parseFaqMarkdown` (allowlist fechada) e cada bloco é
// montado como ELEMENTO React. Nunca use `dangerouslySetInnerHTML` aqui: é o que mantém o
// texto do painel admin incapaz de virar HTML (SPEC_FAQ D13).

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { chaveSlug } from "@/lib/faq/conteudo";
import { parseFaqMarkdown, partirNegrito, type BlocoFaq } from "@/lib/faq/markdown";

/** Negrito é a única ênfase inline aceita. */
function Texto({ children }: { children: string }) {
  return (
    <>
      {partirNegrito(children).map((pedaco, i) =>
        pedaco.forte ? (
          <strong key={i} style={{ fontWeight: 700, color: "var(--go-text-heading)" }}>
            {pedaco.texto}
          </strong>
        ) : (
          <span key={i}>{pedaco.texto}</span>
        ),
      )}
    </>
  );
}

/**
 * Ids das seções de 1º nível, na ordem do documento. Título repetido ganha sufixo — dois
 * `#pendente` na mesma página fariam o link levar sempre ao primeiro (SPEC_FAQ D16).
 */
function idsDasSecoes(blocos: BlocoFaq[]): Map<number, string> {
  const usados = new Map<string, number>();
  const ids = new Map<number, string>();
  blocos.forEach((bloco, indice) => {
    if (bloco.tipo !== "titulo" || bloco.nivel !== 2) return;
    const base = chaveSlug(bloco.texto.replace(/\*\*/g, "")) || "secao";
    const vezes = (usados.get(base) ?? 0) + 1;
    usados.set(base, vezes);
    ids.set(indice, vezes === 1 ? base : `${base}_${vezes}`);
  });
  return ids;
}

/**
 * Título de seção + "copiar link desta seção".
 *
 * ⚠️ O botão aparece no hover E no foco de teclado (`focus-visible`): escondido só por
 * `group-hover` ele existiria apenas para quem usa mouse.
 */
function TituloSecao({ id, texto }: { id: string; texto: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (typeof window === "undefined") return;
    const { origin, pathname } = window.location;
    try {
      await navigator.clipboard.writeText(`${origin}${pathname}#${id}`);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o endereço fica na barra do navegador.
    }
  }

  return (
    <h2
      id={id}
      className="group flex items-center gap-2 text-[19px] font-extrabold leading-snug"
      style={{
        color: "var(--go-text-heading)",
        borderLeft: "3px solid var(--go-lime)",
        paddingLeft: 13,
        scrollMarginTop: 24,
      }}
    >
      <Texto>{texto}</Texto>
      <button
        type="button"
        onClick={copiar}
        title={copiado ? "Link copiado" : "Copiar link desta seção"}
        aria-label={
          copiado ? "Link desta seção copiado" : `Copiar link da seção ${texto.replace(/\*\*/g, "")}`
        }
        className="shrink-0 cursor-pointer rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: copiado ? "var(--go-blue)" : "#8b8b9a", outlineColor: "var(--go-blue)" }}
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
    </h2>
  );
}

function Bloco({
  bloco,
  primeiro,
  id,
}: {
  bloco: BlocoFaq;
  primeiro: boolean;
  id?: string;
}) {
  switch (bloco.tipo) {
    case "titulo":
      return bloco.nivel === 2 ? (
        <div style={{ marginTop: primeiro ? 0 : 38, marginBottom: 12 }}>
          <TituloSecao id={id ?? chaveSlug(bloco.texto)} texto={bloco.texto} />
        </div>
      ) : (
        <h3
          className="text-[14.5px] font-bold"
          style={{
            color: "var(--go-text-heading)",
            marginTop: primeiro ? 0 : 22,
            marginBottom: 6,
          }}
        >
          <Texto>{bloco.texto}</Texto>
        </h3>
      );

    case "paragrafo":
      return (
        <p
          className="text-[15px] leading-[1.75]"
          style={{ color: "var(--go-text-primary)", marginBottom: 14 }}
        >
          <Texto>{bloco.texto}</Texto>
        </p>
      );

    case "lista":
      return bloco.ordenada ? (
        <ol className="mb-4 flex flex-col gap-2">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-[1.7]">
              <span
                aria-hidden
                className="shrink-0 text-[13px] font-bold tabular-nums"
                style={{ color: "var(--go-blue)", paddingTop: 2 }}
              >
                {i + 1}.
              </span>
              <span style={{ color: "var(--go-text-primary)" }}>
                <Texto>{item}</Texto>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {bloco.itens.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-[1.7]">
              <span
                aria-hidden
                className="shrink-0"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 1.5,
                  background: "var(--go-blue)",
                  marginTop: 10,
                }}
              />
              <span style={{ color: "var(--go-text-primary)" }}>
                <Texto>{item}</Texto>
              </span>
            </li>
          ))}
        </ul>
      );

    case "destaque":
      return (
        <div
          className="mb-4 text-[14.5px] leading-[1.7]"
          style={{
            background: "var(--go-cream)",
            borderLeft: "3px solid var(--go-blue)",
            borderRadius: "0 8px 8px 0",
            padding: "13px 16px",
            color: "var(--go-text-primary)",
          }}
        >
          <Texto>{bloco.texto}</Texto>
        </div>
      );
  }
}

export function FaqDocumento({ md, comAncoras = true }: { md: string | null; comAncoras?: boolean }) {
  const blocos = parseFaqMarkdown(md);
  const ids = comAncoras ? idsDasSecoes(blocos) : new Map<number, string>();

  // Link com `#secao` colado de fora abre a página no topo: o alvo só existe depois deste
  // render (o texto vem de `GET /api/faq`). Aqui, com o documento montado, levamos o leitor
  // até a seção — respeitando `prefers-reduced-motion`, que é o piso de a11y do projeto.
  //
  // ⚠️ São DUAS tentativas de propósito: a restauração de scroll do router roda depois da
  // montagem e devolve a página ao topo, engolindo um scroll único (foi o que aconteceu na
  // 1ª versão). O 2º passe, após o próximo tick, é o que fica valendo.
  useEffect(() => {
    if (!comAncoras || typeof window === "undefined") return;
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;

    const rolar = () => {
      const alvo = document.getElementById(decodeURIComponent(id));
      if (!alvo) return;
      const semAnimacao = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      alvo.scrollIntoView({ behavior: semAnimacao ? "auto" : "smooth", block: "start" });
    };

    const quadro = window.requestAnimationFrame(rolar);
    const atraso = window.setTimeout(rolar, 150);
    return () => {
      window.cancelAnimationFrame(quadro);
      window.clearTimeout(atraso);
    };
  }, [md, comAncoras]);

  if (blocos.length === 0) {
    return (
      <p className="text-[13.5px] italic" style={{ color: "#8b8b9a" }}>
        Este assunto ainda não tem texto.
      </p>
    );
  }

  return (
    <div style={{ maxWidth: "68ch" }}>
      {blocos.map((bloco, i) => (
        <Bloco key={i} bloco={bloco} primeiro={i === 0} id={ids.get(i)} />
      ))}
    </div>
  );
}
