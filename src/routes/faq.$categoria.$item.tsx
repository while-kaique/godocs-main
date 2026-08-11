// /faq/$categoria/$item — a resposta em si. É esta a página que os links de fora abrem
// (Google Chat, e-mail, Etapa 2.5 do formulário): por isso é PÁGINA, não âncora (D3).

import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useFaq } from "@/components/faq/faq-contexto";
import { ControlesFaq } from "@/components/faq/faq-admin";
import { CopiarLink, FaqCorpo, FaqShell, FaqVazio } from "@/components/faq/faq-ui";
import { resolverCategoria, resolverItem } from "@/lib/faq/conteudo";

export const Route = createFileRoute("/faq/$categoria/$item")({
  head: () => ({
    meta: [{ title: "Perguntas frequentes · GoGroup" }],
  }),
  component: FaqItemPage,
});

function FaqItemPage() {
  const { categoria: slugCategoria, item: slugItem } = Route.useParams();
  const { categorias, ehAdmin, carregando, erro, recarregar } = useFaq();

  const categoria = resolverCategoria(categorias, slugCategoria);
  const item = resolverItem(categoria, slugItem);

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

  if (!categoria || !item) {
    return (
      <FaqShell
        voltar={{ to: "/faq", label: "← Perguntas frequentes" }}
        eyebrow="Ajuda"
        titulo="Tópico não encontrado"
      >
        <FaqVazio
          mensagem={
            erro ??
            "Este endereço não existe mais ou o tópico foi arquivado. Veja o que está publicado no índice."
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

  const irmaos = categoria.itens.filter((i) => i.id !== item.id && !i.arquivado);
  const urlDoTopico =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/faq/${categoria.slug}/${item.slug}`;

  return (
    <FaqShell
      voltar={{
        to: "/faq/$categoria",
        params: { categoria: categoria.slug },
        label: `← ${categoria.titulo}`,
      }}
      eyebrow={item.arquivado ? "Tópico arquivado" : categoria.titulo}
      titulo={item.titulo}
      resumo={item.resumo}
      acoes={<CopiarLink url={urlDoTopico} />}
    >
      {ehAdmin && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <ControlesFaq tipo="item" alvo={item} onMudou={recarregar} />
        </div>
      )}

      <div className="flex flex-col gap-10 md:flex-row md:items-start">
        <article
          className="flex-1 px-6 py-6 md:px-8 md:py-7"
          style={{
            background: "var(--go-white)",
            border: "1px solid rgba(0,89,169,0.10)",
            borderRadius: "var(--go-radius-lg)",
            boxShadow: "var(--go-shadow-sm)",
          }}
        >
          <FaqCorpo texto={item.corpo} />
        </article>

        {irmaos.length > 0 && (
          <aside className="w-full shrink-0 md:w-60">
            <h2
              className="mb-3 text-[11px] font-bold uppercase tracking-[0.1em]"
              style={{ color: "#8b8b9a" }}
            >
              Nesta categoria
            </h2>
            <ul className="flex flex-col gap-1.5">
              {irmaos.map((i) => (
                <li key={i.id}>
                  <Link
                    to="/faq/$categoria/$item"
                    params={{ categoria: categoria.slug, item: i.slug }}
                    className="block rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: "var(--go-blue)", outlineColor: "var(--go-blue)" }}
                  >
                    {i.titulo}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </FaqShell>
  );
}
