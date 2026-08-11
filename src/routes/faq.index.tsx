// /faq — lista de categorias (título grande + descrição menor abaixo).

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useFaq } from "@/components/faq/faq-contexto";
import { BotaoNovoFaq, ControlesFaq } from "@/components/faq/faq-admin";
import { FaqCard, FaqShell, FaqVazio } from "@/components/faq/faq-ui";

export const Route = createFileRoute("/faq/")({
  head: () => ({
    meta: [
      { title: "Perguntas frequentes · GoGroup" },
      {
        name: "description",
        content:
          "O que conta como projeto, como o saving e a receita são medidos e o que cada status significa.",
      },
    ],
  }),
  component: FaqIndex,
});

function FaqIndex() {
  const { categorias, ehAdmin, carregando, erro, recarregar } = useFaq();

  const ativas = categorias.filter((c) => !c.arquivado);
  const arquivadas = categorias.filter((c) => c.arquivado);

  return (
    <FaqShell
      voltar={{ to: "/", label: "← Início" }}
      eyebrow="Ajuda"
      titulo="Perguntas frequentes"
      resumo="O que conta como projeto, como o ganho é medido e o que acontece depois que você submete."
      acoes={ehAdmin ? <BotaoNovoFaq tipo="categoria" onCriado={recarregar} /> : undefined}
    >
      {carregando && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
        </div>
      )}

      {!carregando && erro && <FaqVazio mensagem={erro} />}

      {!carregando && !erro && ativas.length === 0 && arquivadas.length === 0 && (
        <FaqVazio mensagem="Nenhuma categoria publicada ainda." />
      )}

      <div className="flex flex-col gap-4">
        {ativas.map((c) => (
          <FaqCard
            key={c.id}
            to="/faq/$categoria"
            params={{ categoria: c.slug }}
            titulo={c.titulo}
            resumo={c.resumo}
            rodape={`${c.itens.length} ${c.itens.length === 1 ? "tópico" : "tópicos"}`}
            controles={
              ehAdmin ? <ControlesFaq tipo="categoria" alvo={c} onMudou={recarregar} /> : undefined
            }
          />
        ))}
      </div>

      {ehAdmin && arquivadas.length > 0 && (
        <section className="mt-8">
          <h2
            className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "#8b8b9a" }}
          >
            Arquivadas — só admin vê
          </h2>
          <div className="flex flex-col gap-3">
            {arquivadas.map((c) => (
              <FaqCard
                key={c.id}
                to="/faq/$categoria"
                params={{ categoria: c.slug }}
                titulo={c.titulo}
                resumo={c.resumo}
                arquivado
                rodape="Abrir para restaurar"
                controles={<ControlesFaq tipo="categoria" alvo={c} onMudou={recarregar} />}
              />
            ))}
          </div>
        </section>
      )}
    </FaqShell>
  );
}
