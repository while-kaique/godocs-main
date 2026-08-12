// FAQ — o documento da categoria: títulos e explicações, um assunto por página.
//
// O ritmo de leitura é o que faz este texto ser escaneável: cada seção abre com um título
// marcado por um filete lima à esquerda, e a medida do texto fica travada em ~68ch (linha
// longa é o que tornava o FAQ antigo cansativo de ler).
//
// ⚠️ A marcação vem do parser PURO `parseFaqMarkdown` (allowlist fechada) e cada bloco é
// montado como ELEMENTO React. Nunca use `dangerouslySetInnerHTML` aqui: é o que mantém o
// texto do painel admin incapaz de virar HTML (SPEC_FAQ D13).

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

function Bloco({ bloco, primeiro }: { bloco: BlocoFaq; primeiro: boolean }) {
  switch (bloco.tipo) {
    case "titulo":
      return bloco.nivel === 2 ? (
        <h2
          className="text-[19px] font-extrabold leading-snug"
          style={{
            color: "var(--go-text-heading)",
            borderLeft: "3px solid var(--go-lime)",
            paddingLeft: 13,
            marginTop: primeiro ? 0 : 38,
            marginBottom: 12,
          }}
        >
          <Texto>{bloco.texto}</Texto>
        </h2>
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

export function FaqDocumento({ md }: { md: string | null }) {
  const blocos = parseFaqMarkdown(md);

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
        <Bloco key={i} bloco={bloco} primeiro={i === 0} />
      ))}
    </div>
  );
}
