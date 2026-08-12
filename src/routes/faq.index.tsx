// /faq — o índice: um card por assunto (título grande, descrição menor, seções do documento).
// É o ÚNICO nível com lista de cards; a parte interna é um documento só (SPEC_FAQ D13).

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Search, X } from "lucide-react";
import { useFaq } from "@/components/faq/faq-contexto";
import {
  AvisoVerComoUsuario,
  BotaoNovoFaq,
  BotaoVerComoUsuario,
  ControlesFaq,
} from "@/components/faq/faq-admin";
import { FaqCard, FaqShell, FaqVazio } from "@/components/faq/faq-ui";
import { titulosDoDocumento } from "@/lib/faq/markdown";
import { filtrarAssuntosFaq } from "@/lib/faq/formato";

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
  const { categorias, ehAdmin, podeEditar, verComoUsuario, carregando, erro, recarregar } = useFaq();
  const [busca, setBusca] = useState("");

  const publicadas = categorias.filter((c) => !c.arquivado);
  const arquivadas = categorias.filter((c) => c.arquivado);
  const ativas = useMemo(() => filtrarAssuntosFaq(publicadas, busca), [publicadas, busca]);
  const buscando = busca.trim().length > 0;

  return (
    <FaqShell
      voltar={{ to: "/", label: "← Início" }}
      eyebrow="Ajuda"
      titulo="Perguntas frequentes"
      resumo="O que conta como projeto, como o ganho é medido e o que acontece depois que você submete."
      acoes={
        podeEditar ? (
          <>
            <BotaoNovoFaq onCriado={recarregar} />
            <BotaoVerComoUsuario />
          </>
        ) : undefined
      }
    >
      {ehAdmin && verComoUsuario && <AvisoVerComoUsuario />}

      {/* Busca: quem chega no FAQ chega com um termo, não com o nome do assunto. Só pinta
          quando há mais de um assunto — com um único card, um campo de busca é ruído. */}
      {!carregando && !erro && publicadas.length > 1 && (
        <div className="mb-5">
          <div
            className="flex items-center gap-2.5 px-3.5 py-2.5"
            style={{
              background: "var(--go-white)",
              border: "1px solid rgba(0,89,169,0.14)",
              borderRadius: "var(--go-radius-lg)",
              boxShadow: "var(--go-shadow-sm)",
            }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: "var(--go-blue)" }} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.currentTarget.value)}
              placeholder="Buscar no FAQ (ex.: 220h, custo evitado, reenvio)"
              aria-label="Buscar no FAQ"
              className="w-full bg-transparent text-[13.5px]"
              style={{ color: "var(--go-text-heading)", outline: "none" }}
            />
            {buscando && (
              <button
                type="button"
                onClick={() => setBusca("")}
                aria-label="Limpar a busca"
                className="shrink-0 cursor-pointer rounded-md p-1 focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ color: "#8b8b9a", outlineColor: "var(--go-blue)" }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {buscando && (
            <p className="mt-2 text-[11.5px]" style={{ color: "#8b8b9a" }} aria-live="polite">
              {ativas.length === 0
                ? "Nenhum assunto com esse termo."
                : `${ativas.length} de ${publicadas.length} ${
                    publicadas.length === 1 ? "assunto" : "assuntos"
                  }`}
            </p>
          )}
        </div>
      )}

      {carregando && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-blue)" }} />
        </div>
      )}

      {!carregando && erro && <FaqVazio mensagem={erro} />}

      {!carregando && !erro && publicadas.length === 0 && arquivadas.length === 0 && (
        <FaqVazio mensagem="Nenhum assunto publicado ainda." />
      )}

      {!carregando && !erro && buscando && ativas.length === 0 && publicadas.length > 0 && (
        <FaqVazio mensagem="Nenhum assunto com esse termo. Tente uma palavra do texto, como “horas”, “contrato” ou “reenvio”." />
      )}

      <div className="flex flex-col gap-4">
        {ativas.map((c) => (
          <FaqCard
            key={c.id}
            to="/faq/$categoria"
            params={{ categoria: c.slug }}
            titulo={c.titulo}
            resumo={c.resumo}
            secoes={titulosDoDocumento(c.corpo)}
            rodape="Ler"
            controles={
              podeEditar ? <ControlesFaq alvo={c} onMudou={recarregar} /> : undefined
            }
          />
        ))}
      </div>

      {podeEditar && arquivadas.length > 0 && (
        <section className="mt-8">
          <h2
            className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "#8b8b9a" }}
          >
            Arquivados — só admin vê
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
                controles={<ControlesFaq alvo={c} onMudou={recarregar} />}
              />
            ))}
          </div>
        </section>
      )}
    </FaqShell>
  );
}
