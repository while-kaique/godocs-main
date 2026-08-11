// /faq/$categoria — a categoria com seus tópicos (título grande, descrição menor abaixo).
// Slug desconhecido não dá tela branca: explica e oferece a volta ao índice.

import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useFaq } from "@/components/faq/faq-contexto";
import { BotaoNovoFaq, ControlesFaq } from "@/components/faq/faq-admin";
import { FaqCard, FaqShell, FaqVazio } from "@/components/faq/faq-ui";
import { resolverCategoria } from "@/lib/faq/conteudo";

export const Route = createFileRoute("/faq/$categoria/")({
  head: () => ({
    meta: [{ title: "Perguntas frequentes · GoGroup" }],
  }),
  component: FaqCategoriaPage,
});

function FaqCategoriaPage() {
  const { categoria: slug } = Route.useParams();
  const { categorias, ehAdmin, carregando, erro, recarregar } = useFaq();
  const categoria = resolverCategoria(categorias, slug);

  if (carregando) {
    return (
      <FaqShell voltar={{ to: "/faq", label: "← Perguntas frequentes" }} eyebrow="Ajuda" titulo="Carregando…">
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

  const ativos = categoria.itens.filter((i) => !i.arquivado);
  const arquivados = categoria.itens.filter((i) => i.arquivado);

  return (
    <FaqShell
      voltar={{ to: "/faq", label: "← Perguntas frequentes" }}
      eyebrow={categoria.arquivado ? "Categoria arquivada" : "Ajuda"}
      titulo={categoria.titulo}
      resumo={categoria.resumo}
      acoes={
        ehAdmin ? <BotaoNovoFaq tipo="item" categoria={categoria} onCriado={recarregar} /> : undefined
      }
    >
      {ehAdmin && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <ControlesFaq tipo="categoria" alvo={categoria} onMudou={recarregar} />
        </div>
      )}

      {ativos.length === 0 && arquivados.length === 0 && (
        <FaqVazio mensagem="Nenhum tópico publicado nesta categoria ainda." />
      )}

      <div className="flex flex-col gap-4">
        {ativos.map((item) => (
          <FaqCard
            key={item.id}
            to="/faq/$categoria/$item"
            params={{ categoria: categoria.slug, item: item.slug }}
            titulo={item.titulo}
            resumo={item.resumo}
            rodape="Ler"
            controles={
              ehAdmin ? (
                <ControlesFaq tipo="item" alvo={item} onMudou={recarregar} />
              ) : undefined
            }
          />
        ))}
      </div>

      {ehAdmin && arquivados.length > 0 && (
        <section className="mt-8">
          <h2
            className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "#8b8b9a" }}
          >
            Arquivados — só admin vê
          </h2>
          <div className="flex flex-col gap-3">
            {arquivados.map((item) => (
              <FaqCard
                key={item.id}
                to="/faq/$categoria/$item"
                params={{ categoria: categoria.slug, item: item.slug }}
                titulo={item.titulo}
                resumo={item.resumo}
                arquivado
                rodape="Ler"
                controles={<ControlesFaq tipo="item" alvo={item} onMudou={recarregar} />}
              />
            ))}
          </div>
        </section>
      )}
    </FaqShell>
  );
}
