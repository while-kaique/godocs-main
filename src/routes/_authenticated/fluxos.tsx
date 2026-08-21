import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { SubmeterPageContent } from "@/routes/submeter";
import type { FluxoDemo } from "@/lib/fluxos/demo-backend";

export const Route = createFileRoute("/_authenticated/fluxos")({
  head: () => ({
    meta: [{ title: "Fluxos de submissão (demonstração) | RPA & IA" }],
  }),
  component: FluxosPage,
});

const FLUXOS: { id: FluxoDemo; rotulo: string; descricao: string }[] = [
  {
    id: "normal",
    rotulo: "Projeto padrão",
    descricao:
      "Submissão comum: conversa com o agente para documentar, formulário de saving e revisão final.",
  },
  {
    id: "especial",
    rotulo: "Projeto especial",
    descricao:
      "Alto impacto e difícil mensuração: pula o agente e a análise financeira; validação humana.",
  },
  {
    id: "lideranca",
    rotulo: "Liderança (fluxo direto)",
    descricao:
      "Cargo isento: pula o agente conversacional. Doc por IA + formulário determinístico, sem gates.",
  },
];

function FluxosPage() {
  // `null` = tela de escolha; um fluxo = wizard real em modo demonstração.
  const [fluxo, setFluxo] = useState<FluxoDemo | null>(null);

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
            ↺ Reiniciar / trocar fluxo
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
        </div>
      ) : (
        // key força REMONTAGEM ao trocar de fluxo: estado do wizard e backend mockado
        // nascem limpos (o handler de demo é recriado, zerando o passo da conversa).
        <SubmeterPageContent key={fluxo} demoFluxo={fluxo} />
      )}
    </div>
  );
}
