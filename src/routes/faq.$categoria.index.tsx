// /faq/$categoria — o assunto inteiro em UM documento (título → explicação → título →
// explicação). É esta a página que os links de fora abrem: Google Chat, e-mail e a Etapa 2.5
// do formulário. Ver spec-docs/SPEC_FAQ.md (D3, D13).
//
// Slug desconhecido não dá tela branca: explica e oferece a volta ao índice.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useFaq } from "@/components/faq/faq-contexto";
import {
  AvisoVerComoUsuario,
  BotaoVerComoUsuario,
  ControlesFaq,
} from "@/components/faq/faq-admin";
import { FaqDocumento } from "@/components/faq/faq-documento";
import { CopiarLink, FaqShell, FaqVazio } from "@/components/faq/faq-ui";
import { resolverCategoria } from "@/lib/faq/conteudo";
import { linhaAtualizacaoFaq } from "@/lib/faq/formato";
import { useTituloPagina } from "@/lib/use-titulo-pagina";
import { SECAO } from "@/lib/titulo-pagina";

// Título da aba: o ASSUNTO aberto (`useTituloPagina`) — este é o link que circula em
// Google Chat e e-mail, e a aba dizer só "Ajuda" não ajudaria ninguém a achar de volta.
export const Route = createFileRoute("/faq/$categoria/")({
  component: FaqCategoriaPage,
});

function FaqCategoriaPage() {
  const { categoria: slug } = Route.useParams();
  const { categorias, ehAdmin, podeEditar, verComoUsuario, carregando, erro, recarregar } =
    useFaq();
  const categoria = resolverCategoria(categorias, slug);
  useTituloPagina(SECAO.faq, categoria?.titulo ?? null);

  if (carregando) {
    return (
      <FaqShell
        voltar={{ to: "/faq", label: "← Perguntas frequentes" }}
        eyebrow="Ajuda"
        titulo="Carregando…"
      >
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
        </div>
      </FaqShell>
    );
  }

  if (!categoria) {
    return (
      <FaqShell
        voltar={{ to: "/faq", label: "← Perguntas frequentes" }}
        eyebrow="Ajuda"
        titulo="Assunto não encontrado"
      >
        <FaqVazio
          mensagem={
            erro ??
            "Este endereço não existe mais ou o assunto foi arquivado. Volte ao índice para ver o que está publicado."
          }
        />
        <div className="mt-4 text-center">
          <Link
            to="/faq"
            className="text-[13px] font-semibold underline decoration-1 underline-offset-2"
            style={{ color: "var(--go-blue)" }}
          >
            Ver todas as perguntas
          </Link>
        </div>
      </FaqShell>
    );
  }

  const url =
    typeof window === "undefined" ? "" : `${window.location.origin}/faq/${categoria.slug}`;
  const atualizacao = linhaAtualizacaoFaq(categoria.atualizado_em, categoria.atualizado_por);

  return (
    <FaqShell
      voltar={{ to: "/faq", label: "← Perguntas frequentes" }}
      eyebrow={categoria.arquivado ? "Assunto arquivado" : "Ajuda"}
      titulo={categoria.titulo}
      resumo={categoria.resumo}
      acoes={
        <>
          <CopiarLink url={url} />
          {podeEditar && <BotaoVerComoUsuario />}
        </>
      }
    >
      {ehAdmin && verComoUsuario && <AvisoVerComoUsuario />}

      {podeEditar && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <ControlesFaq alvo={categoria} onMudou={recarregar} />
        </div>
      )}

      <article
        className="px-6 py-7 md:px-9 md:py-8"
        style={{
          background: "var(--go-white)",
          border: "1px solid rgba(0,89,169,0.10)",
          borderRadius: "var(--go-radius-lg)",
          boxShadow: "var(--go-shadow-sm)",
        }}
      >
        <FaqDocumento md={categoria.corpo} />

        {/* Sinal de frescor: FAQ interno envelhece, e quem lê precisa saber se o texto
            ainda vale. Sem carimbo, a linha simplesmente não aparece. */}
        {atualizacao && (
          <p
            className="mt-9 pt-4 text-[11.5px]"
            style={{ borderTop: "1px solid rgba(0,89,169,0.10)", color: "#8b8b9a" }}
          >
            {atualizacao}
          </p>
        )}
      </article>
    </FaqShell>
  );
}
