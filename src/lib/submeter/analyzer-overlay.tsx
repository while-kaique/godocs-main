import { useEffect, useState } from "react";
import type { AnaliseResult } from "./constants";

// ─── Frases de loading (estilo log de terminal) ────────────────────────────

const LOADING_PHRASES = [
  "Carregando contexto completo do projeto...",
  "Analisando documentação técnica...",
  "Verificando coerência entre ferramenta e descrição...",
  "Cruzando dados de saving com complexidade do fluxo...",
  "Avaliando completude das dependências...",
  "Validando memorial de cálculo...",
  "Conferindo riscos e limitações...",
  "Consolidando parecer da análise...",
  "Revisando justificativa final...",
  "Finalizando análise...",
];

// ─── Card inline de análise (usado na tela de sucesso) ─────────────────────

export function AnalyzerCard({
  loading,
  result,
  error,
}: {
  loading: boolean;
  result: AnaliseResult | null;
  error?: string | null;
}) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setPhraseIndex(0);
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [loading]);

  // O parecer da análise (pontos de atenção) NÃO é mais exibido ao usuário — é uma
  // mensagem de staff que ia para a coluna "Observações" e só gerava ansiedade no
  // front. Aqui mostramos apenas uma confirmação neutra quando a análise conclui.
  const accentColor = "#16a34a";

  return (
    <div
      style={{
        background: "var(--go-white)",
        borderRadius: "var(--go-radius-lg)",
        overflow: "hidden",
        animation: "go-step-in 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
        boxShadow: loading || error
          ? "var(--go-shadow-sm)"
          : "0 2px 12px rgba(22,163,74,0.08), 0 0 0 1px rgba(22,163,74,0.10)",
      }}
    >
      {loading ? (
        <LoadingState phrase={LOADING_PHRASES[phraseIndex]} />
      ) : error ? (
        <ErrorState message={error} />
      ) : result ? (
        <div style={{ display: "flex", minHeight: 0 }}>
          {/* ── Barra lateral de acento ── */}
          <div
            style={{
              width: 4,
              flexShrink: 0,
              background: accentColor,
              borderRadius: "var(--go-radius-lg) 0 0 var(--go-radius-lg)",
            }}
          />

          {/* ── Confirmação neutra (sem parecer/pontos de atenção) ── */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(22,163,74,0.08)",
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: accentColor,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.2,
                }}
              >
                Análise concluída
              </div>
              <div style={{ fontSize: 10, color: "#8b8b9a", marginTop: 2, lineHeight: 1.3 }}>
                Sua submissão foi registrada e encaminhada à equipe de RPA &amp; IA.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Manter export legado para não quebrar imports existentes ───────────────

/** @deprecated Use AnalyzerCard. Mantido para compatibilidade. */
export function AnalyzerOverlay({
  visible,
  loading,
  result,
}: {
  visible: boolean;
  loading: boolean;
  result: AnaliseResult | null;
  onSubmit?: () => void;
  submitting?: boolean;
}) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        background: "rgba(0,0,0,0.4)",
        animation: "go-fade-in-up 0.3s ease both",
      }}
    >
      <div style={{ width: "100%", maxWidth: 500, margin: "0 16px" }}>
        <AnalyzerCard loading={loading} result={result} />
      </div>
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function LoadingState({ phrase }: { phrase: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "28px 16px 32px",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "3px solid rgba(0,89,169,0.1)",
          borderTopColor: "var(--go-blue)",
          animation: "go-spin 0.8s linear infinite",
          marginBottom: 16,
        }}
      />
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: "var(--go-text-heading)",
          marginBottom: 12,
          letterSpacing: "-0.01em",
        }}
      >
        Analisando sua submissão...
      </div>
      <div
        style={{
          width: "100%",
          maxWidth: 340,
          background: "rgba(0,0,0,0.03)",
          borderRadius: "var(--go-radius-md)",
          padding: "10px 14px",
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--go-blue)",
            opacity: 0.5,
            fontFamily: "monospace",
            flexShrink: 0,
          }}
        >
          &gt;
        </span>
        <span
          key={phrase}
          style={{
            fontSize: 11,
            color: "var(--go-text-primary)",
            opacity: 0.7,
            animation: "go-fade-in-up 0.4s ease both",
          }}
        >
          {phrase}
        </span>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.04)",
          marginBottom: 12,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b8b9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--go-text-heading)", marginBottom: 4 }}>
        Análise indisponível
      </div>
      <div style={{ fontSize: 11, color: "#8b8b9a", lineHeight: 1.5 }}>
        {message}
      </div>
    </div>
  );
}
