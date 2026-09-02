import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FlaskConical, UserCog } from "lucide-react";
import { SubmeterPageContent } from "@/routes/submeter";
import { CHAVE_TESTE_LIDERANCA } from "@/lib/fluxos/demo-backend";
import type { FluxoDemo } from "@/lib/fluxos/demo-backend";
import { useTituloPagina } from "@/lib/use-titulo-pagina";
import { SECAO } from "@/lib/titulo-pagina";

export const Route = createFileRoute("/_authenticated/fluxos")({
  component: FluxosPage,
});

// ⚠️ Eram TRÊS fluxos e sobrou UM. Na v1 havia "Projeto padrão" (conversa com o agente),
// "Liderança" (cargo isento, que pulava o agente) e o especial embutido na Etapa 2.5. Na v2
// não existe agente no caminho de ninguém (D4), a Etapa 2.5 saiu (D5) e o atalho da
// liderança perdeu a razão de ser — ele existia justamente para escapar da conversa.
// Sobrou o caminho único, que é o que este sandbox inspeciona.
const FLUXOS: { id: FluxoDemo; rotulo: string; descricao: string }[] = [
  {
    id: "padrao",
    rotulo: "Submissão",
    descricao:
      "As três etapas, do jeito que a pessoa vê: identidade e time, dados do projeto com " +
      "os tipos de ganho, e os blocos de ganho no acordeão até a revisão. Nada é " +
      "persistido e nenhuma chamada sai daqui.",
  },
];

function FluxosPage() {
  // `null` = tela de escolha; um fluxo = wizard real em modo demonstração.
  const [fluxo, setFluxo] = useState<FluxoDemo | null>(null);
  const navigate = useNavigate();

  // Título só na tela de ESCOLHA: com um fluxo rodando, quem manda no título é o
  // `SubmeterPageContent` embutido (ele sabe a etapa e o nome do projeto de mentira).
  useTituloPagina(SECAO.fluxos, "Escolher fluxo", fluxo === null);

  // Abre o formulário REAL (/submeter) rodando como liderança — cria projeto de teste
  // de verdade na staging. Usa flag em sessionStorage (o `?lideranca=1` some no OAuth do
  // edge) + navegação client-side (não passa pelo edge, então o flag persiste).
  function abrirComoLiderReal() {
    try {
      sessionStorage.setItem(CHAVE_TESTE_LIDERANCA, "1");
    } catch {
      /* sessionStorage indisponível — segue mesmo assim */
    }
    navigate({ to: "/submeter" });
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--go-cream, #FBF4EE)" }}>
      {/* Barra de demonstração — fixa, para deixar claro que nada é persistido. */}
      <div
        role="region"
        aria-label="Modo demonstração de fluxos"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "var(--go-blue, #0059A9)",
          color: "#fff",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          boxShadow: "0 2px 10px rgba(8,20,40,0.18)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
          <FlaskConical aria-hidden="true" style={{ width: 18, height: 18 }} />
          Modo demonstração — nada é salvo
        </span>

        <div role="tablist" aria-label="Escolha o fluxo" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FLUXOS.map((f) => {
            const ativo = fluxo === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setFluxo(f.id)}
                className="go-focusable"
                style={{
                  border: "1px solid rgba(255,255,255,0.55)",
                  background: ativo ? "#fff" : "transparent",
                  color: ativo ? "var(--go-blue, #0059A9)" : "#fff",
                  fontWeight: ativo ? 700 : 500,
                  borderRadius: 999,
                  padding: "5px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {ativo ? "● " : ""}
                {f.rotulo}
              </button>
            );
          })}
        </div>

        {fluxo && (
          <button
            type="button"
            onClick={() => setFluxo(null)}
            style={{
              marginLeft: "auto",
              border: "1px solid rgba(255,255,255,0.55)",
              background: "transparent",
              color: "#fff",
              borderRadius: 999,
              padding: "5px 14px",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ↺ Reiniciar
          </button>
        )}
      </div>

      {fluxo === null ? (
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--go-text-heading, #12233b)" }}>
            Fluxos de submissão
          </h1>
          <p style={{ marginTop: 8, color: "#5b5b6a", fontSize: 14, lineHeight: 1.6 }}>
            Percorra o formulário <strong>real</strong> de submissão de cada tipo de projeto para
            revisar telas, textos e estados de carregamento — com o backend simulado, sem criar
            nada no banco ou na planilha. Escolha um fluxo:
          </p>
          <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
            {FLUXOS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFluxo(f.id)}
                className="go-focusable"
                style={{
                  textAlign: "left",
                  border: "1px solid rgba(8,20,40,0.12)",
                  background: "#fff",
                  borderRadius: 14,
                  padding: "16px 18px",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(8,20,40,0.06)",
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    color: "var(--go-blue, #0059A9)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {f.rotulo}
                  <span aria-hidden="true">→</span>
                </div>
                <div style={{ marginTop: 4, color: "#5b5b6a", fontSize: 13, lineHeight: 1.55 }}>
                  {f.descricao}
                </div>
              </button>
            ))}
          </div>

          {/* Teste no formulário REAL (cria projeto de teste na staging), como líder. */}
          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: "1px solid rgba(8,20,40,0.1)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--go-text-heading, #12233b)" }}>
              Testar no formulário real (líder)
            </div>
            <p style={{ marginTop: 4, color: "#5b5b6a", fontSize: 13, lineHeight: 1.55 }}>
              Abre o <strong>/submeter</strong> de verdade rodando como liderança — cria um projeto
              de teste na staging (isolada, Chat mudo). Diferente das demonstrações acima, este
              exercita o backend real (doc por IA + memorial).
            </p>
            <button
              type="button"
              onClick={abrirComoLiderReal}
              className="go-focusable"
              style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "var(--go-blue, #0059A9)",
                color: "#fff",
                fontWeight: 700,
                borderRadius: 999,
                padding: "10px 18px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <UserCog aria-hidden="true" style={{ width: 16, height: 16 }} />
              Abrir formulário real como líder →
            </button>
          </div>
        </div>
      ) : (
        // key força REMONTAGEM ao trocar de fluxo: estado do wizard e backend mockado
        // nascem limpos (o handler de demo é recriado, zerando o passo da conversa).
        <SubmeterPageContent key={fluxo} demoFluxo={fluxo} />
      )}
    </div>
  );
}
