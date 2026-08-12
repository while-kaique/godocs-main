// FAQ — peças visuais compartilhadas pelos 3 níveis de rota.
//
// Identidade GoGroup (regra 11): `--go-blue`, `--go-lime`, `--go-cream`, Poppins. Mesmo
// casco azul + onda das outras telas de leitura (`/projeto/$id`), para o FAQ não parecer
// um app diferente. Piso de a11y: foco de teclado visível, alvo generoso, e **estado
// nunca só por cor** — "Arquivado" leva rótulo e ícone, não só um cinza.

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, ArrowRight, Check, Link2 } from "lucide-react";

/* ── Casco da página (cabeçalho azul + onda + área de conteúdo) ── */

export function FaqShell({
  voltar,
  eyebrow,
  titulo,
  resumo,
  acoes,
  children,
}: {
  voltar: { to: string; label: string; params?: Record<string, string> };
  eyebrow: string;
  titulo: string;
  resumo?: string | null;
  acoes?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen px-2.5 pb-2.5"
      style={{ background: "var(--go-blue)", fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="min-h-[calc(100vh-20px)] overflow-hidden"
        style={{
          background: "var(--go-bg-page)",
          borderRadius: "0 0 var(--go-radius-xl) var(--go-radius-xl)",
        }}
      >
        <div className="relative" style={{ background: "var(--go-blue)", minHeight: 170 }}>
          <div className="absolute bottom-0 left-0 right-0">
            <svg
              viewBox="0 0 1440 60"
              preserveAspectRatio="none"
              className="block w-full"
              style={{ height: 40 }}
            >
              <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--go-cream)" />
            </svg>
          </div>
          <div className="relative z-10 mx-auto max-w-4xl px-8 py-9">
            <Link
              to={voltar.to}
              params={voltar.params}
              className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold opacity-80 transition-opacity hover:opacity-100"
              style={{ color: "var(--go-white)" }}
            >
              {voltar.label}
            </Link>
            <span
              className="block text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--go-lime)" }}
            >
              {eyebrow}
            </span>
            <h1
              className="mt-1 font-extrabold tracking-tight"
              style={{ fontSize: "clamp(1.5rem,3.6vw,2.2rem)", color: "var(--go-white)" }}
            >
              {titulo}
            </h1>
            {resumo && (
              <p
                className="mt-2 max-w-2xl text-[13.5px] leading-relaxed"
                style={{ color: "rgba(255,255,255,0.78)" }}
              >
                {resumo}
              </p>
            )}
            {acoes && <div className="mt-4 flex flex-wrap gap-2">{acoes}</div>}
          </div>
        </div>

        <main className="mx-auto max-w-4xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

/* ── Card de lista: título GRANDE, descrição menor abaixo ── */

export function FaqCard({
  to,
  params,
  titulo,
  resumo,
  secoes,
  rodape,
  arquivado,
  controles,
}: {
  to: string;
  params: Record<string, string>;
  titulo: string;
  resumo?: string | null;
  /** Títulos das seções do documento — diz o que tem lá dentro, em vez de uma contagem. */
  secoes?: string[];
  rodape?: string;
  arquivado?: boolean;
  controles?: React.ReactNode;
}) {
  return (
    <div
      className="group relative overflow-hidden transition-all duration-200"
      style={{
        background: "var(--go-white)",
        border: arquivado ? "1px dashed rgba(0,89,169,0.25)" : "1px solid rgba(0,89,169,0.10)",
        borderRadius: "var(--go-radius-lg)",
        boxShadow: "var(--go-shadow-sm)",
        opacity: arquivado ? 0.75 : 1,
      }}
    >
      <Link
        to={to}
        params={params}
        className="block px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ outlineColor: "var(--go-blue)" }}
      >
        {arquivado && (
          <span
            className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-wide"
            style={{ background: "rgba(71,85,105,0.10)", color: "#475569" }}
          >
            <Archive className="h-3 w-3" />
            Arquivado
          </span>
        )}
        <h2
          className="text-[19px] font-bold leading-snug"
          style={{ color: "var(--go-text-heading)" }}
        >
          {titulo}
        </h2>
        {resumo && (
          <p
            className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed"
            style={{ color: "var(--go-text-primary)", opacity: 0.82 }}
          >
            {resumo}
          </p>
        )}
        {secoes && secoes.length > 0 && (
          <p
            className="mt-2.5 text-[11.5px] font-semibold leading-relaxed"
            style={{ color: "var(--go-blue)", opacity: 0.75 }}
          >
            {secoes.slice(0, 4).join(" · ")}
            {secoes.length > 4 && ` · +${secoes.length - 4}`}
          </p>
        )}
        <span
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold"
          style={{ color: "var(--go-blue)" }}
        >
          {rodape ?? "Abrir"}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
      {controles && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-6 py-2.5"
          style={{ borderTop: "1px solid rgba(0,89,169,0.08)", background: "rgba(0,89,169,0.02)" }}
        >
          {controles}
        </div>
      )}
    </div>
  );
}

/* ── "Copiar link": a razão de o FAQ ter rota própria por assunto ── */

export function CopiarLink({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o endereço está na barra do navegador.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
      style={{
        background: "rgba(255,255,255,0.14)",
        color: "var(--go-white)",
        border: "1px solid rgba(255,255,255,0.35)",
      }}
    >
      {copiado ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {copiado ? "Link copiado" : "Copiar link"}
    </button>
  );
}

/* ── Estados de carga / ausência ── */

export function FaqVazio({ mensagem }: { mensagem: string }) {
  return (
    <div
      className="rounded-xl px-6 py-10 text-center text-[13.5px]"
      style={{
        background: "var(--go-white)",
        border: "1px dashed rgba(0,89,169,0.2)",
        color: "#8b8b9a",
      }}
    >
      {mensagem}
    </div>
  );
}
