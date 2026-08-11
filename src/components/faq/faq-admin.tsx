// FAQ — edição inline do admin (D5): mesma página que todos leem.
//
// O gate REAL é server-side (`requireAdmin` em `/api/admin/faq/*`); aqui só se decide o que
// pinta. Duas invariantes visíveis na UI, porque elas surpreendem quem edita:
//   • o ENDEREÇO (slug) não muda ao renomear — o link já circula em Chat/e-mail/formulário
//   • "Remover" é ARQUIVAR: sai da leitura, continua no banco, dá para restaurar

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Plus, PencilLine } from "lucide-react";
import type { FaqCategoria, FaqItem } from "@/lib/faq/conteudo";

/* ── Botõezinhos de controle ── */

function BotaoControle({
  onClick,
  children,
  titulo,
  tom = "neutro",
}: {
  onClick: () => void;
  children: React.ReactNode;
  titulo: string;
  tom?: "neutro" | "aviso";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: tom === "aviso" ? "rgba(71,85,105,0.08)" : "rgba(0,89,169,0.06)",
        color: tom === "aviso" ? "#475569" : "var(--go-blue)",
        border: "1px solid rgba(0,89,169,0.12)",
        outlineColor: "var(--go-blue)",
      }}
    >
      {children}
    </button>
  );
}

/* ── Barra de controles de uma categoria ou tópico ── */

export function ControlesFaq({
  tipo,
  alvo,
  onMudou,
}: {
  tipo: "categoria" | "item";
  alvo: { id: string; titulo: string; resumo: string | null; corpo?: string | null; arquivado: boolean };
  onMudou: () => void;
}) {
  const [editando, setEditando] = useState(false);

  async function chamar(rota: string, corpo: unknown) {
    try {
      await apiFetch(rota, corpo);
      onMudou();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
    }
  }

  const rotulo = tipo === "categoria" ? "categoria" : "tópico";

  return (
    <>
      <BotaoControle onClick={() => setEditando(true)} titulo={`Editar ${rotulo}`}>
        <PencilLine className="h-3.5 w-3.5" />
        Editar
      </BotaoControle>
      <BotaoControle
        onClick={() => chamar("/api/admin/faq/reordenar", { tipo, id: alvo.id, direcao: "cima" })}
        titulo={`Mover ${rotulo} para cima`}
      >
        <ChevronUp className="h-3.5 w-3.5" />
        Subir
      </BotaoControle>
      <BotaoControle
        onClick={() => chamar("/api/admin/faq/reordenar", { tipo, id: alvo.id, direcao: "baixo" })}
        titulo={`Mover ${rotulo} para baixo`}
      >
        <ChevronDown className="h-3.5 w-3.5" />
        Descer
      </BotaoControle>
      <BotaoControle
        tom="aviso"
        onClick={() =>
          chamar("/api/admin/faq/arquivar", { tipo, id: alvo.id, arquivar: !alvo.arquivado })
        }
        titulo={
          alvo.arquivado
            ? `Restaurar ${rotulo} (volta a aparecer para todos)`
            : `Arquivar ${rotulo} (sai da leitura, continua no banco)`
        }
      >
        {alvo.arquivado ? (
          <>
            <ArchiveRestore className="h-3.5 w-3.5" />
            Restaurar
          </>
        ) : (
          <>
            <Archive className="h-3.5 w-3.5" />
            Arquivar
          </>
        )}
      </BotaoControle>

      {editando && (
        <EditorFaq
          tipo={tipo}
          inicial={alvo}
          onFechar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            onMudou();
          }}
        />
      )}
    </>
  );
}

/* ── Botão de criar (categoria nova ou tópico dentro de uma categoria) ── */

export function BotaoNovoFaq({
  tipo,
  categoria,
  onCriado,
}: {
  tipo: "categoria" | "item";
  categoria?: FaqCategoria;
  onCriado: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbrindo(true)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: "var(--go-lime)",
          color: "var(--go-blue)",
          border: "1px solid rgba(0,89,169,0.15)",
          outlineColor: "var(--go-blue)",
        }}
      >
        <Plus className="h-4 w-4" />
        {tipo === "categoria" ? "Nova categoria" : "Novo tópico"}
      </button>

      {abrindo && (
        <EditorFaq
          tipo={tipo}
          categoriaId={categoria?.id}
          onFechar={() => setAbrindo(false)}
          onSalvo={() => {
            setAbrindo(false);
            onCriado();
          }}
        />
      )}
    </>
  );
}

/* ── Dialog de edição/criação ── */

function EditorFaq({
  tipo,
  inicial,
  categoriaId,
  onFechar,
  onSalvo,
}: {
  tipo: "categoria" | "item";
  inicial?: { id: string; titulo: string; resumo: string | null; corpo?: string | null };
  categoriaId?: string;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [resumo, setResumo] = useState(inicial?.resumo ?? "");
  const [corpo, setCorpo] = useState(inicial?.corpo ?? "");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);

  async function salvar() {
    if (!titulo.trim()) {
      toast.error("Escreva um título.");
      return;
    }
    setSalvando(true);
    try {
      const rota = tipo === "categoria" ? "/api/admin/faq/categoria" : "/api/admin/faq/item";
      const corpoRequisicao =
        tipo === "categoria"
          ? { id: inicial?.id ?? null, titulo, resumo }
          : { id: inicial?.id ?? null, categoria_id: categoriaId, titulo, resumo, corpo };
      await apiFetch(rota, corpoRequisicao);
      toast.success(inicial ? "Alterações salvas." : "Publicado.");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Não foi possível salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  if (typeof document === "undefined") return null;

  const ehItem = tipo === "item";

  return createPortal(
    <div
      onClick={onFechar}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="faq-editor-titulo"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full flex-col overflow-hidden"
        style={{
          maxWidth: ehItem ? 720 : 520,
          background: "var(--go-white)",
          borderRadius: "var(--go-radius-lg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          className="px-6 py-4"
          style={{ borderBottom: "1px solid rgba(0,89,169,0.10)" }}
        >
          <h2
            id="faq-editor-titulo"
            className="text-[15px] font-extrabold"
            style={{ color: "var(--go-text-heading)" }}
          >
            {inicial
              ? `Editar ${ehItem ? "tópico" : "categoria"}`
              : `${ehItem ? "Novo tópico" : "Nova categoria"}`}
          </h2>
          {inicial && (
            <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "#8b8b9a" }}>
              O endereço deste {ehItem ? "tópico" : "grupo"} não muda ao renomear — os links
              que já circulam continuam abrindo aqui.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Campo rotulo="Título" dica="Aparece grande na lista e no topo da página.">
            <input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.currentTarget.value)}
              maxLength={120}
              className="go-input w-full rounded-lg px-3 py-2.5 text-sm"
              style={{
                border: "1.5px solid rgba(0,89,169,0.18)",
                color: "var(--go-text-heading)",
                outline: "none",
              }}
            />
          </Campo>

          <Campo
            rotulo="Descrição curta"
            dica="A linha menor embaixo do título. Uma frase, no máximo 300 caracteres."
          >
            <textarea
              value={resumo}
              onChange={(e) => setResumo(e.currentTarget.value)}
              maxLength={300}
              className="go-input w-full resize-none rounded-lg px-3 py-2.5 text-sm leading-relaxed"
              style={{
                minHeight: 70,
                border: "1.5px solid rgba(0,89,169,0.18)",
                color: "var(--go-text-heading)",
                outline: "none",
              }}
            />
          </Campo>

          {ehItem && (
            <Campo
              rotulo="Texto da resposta"
              dica="Texto puro: uma linha em branco separa parágrafos. Negrito e links não são interpretados."
            >
              <textarea
                value={corpo}
                onChange={(e) => setCorpo(e.currentTarget.value)}
                maxLength={20000}
                className="go-input w-full rounded-lg px-3 py-2.5 text-[13.5px] leading-relaxed"
                style={{
                  minHeight: 260,
                  border: "1.5px solid rgba(0,89,169,0.18)",
                  color: "var(--go-text-heading)",
                  outline: "none",
                }}
              />
              <div className="mt-1 text-right text-[10px]" style={{ color: "#8b8b9a" }}>
                {corpo.length}/20000
              </div>
            </Campo>
          )}
        </div>

        <div
          className="flex flex-col-reverse gap-2.5 px-6 py-4 sm:flex-row sm:justify-end"
          style={{ borderTop: "1px solid rgba(0,89,169,0.10)" }}
        >
          <button
            type="button"
            onClick={onFechar}
            className="cursor-pointer rounded-lg px-4 py-2.5 text-[13px] font-bold"
            style={{
              background: "transparent",
              color: "#6b6b7a",
              border: "1.5px solid rgba(0,0,0,0.12)",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="cursor-pointer rounded-lg px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
            style={{ background: "var(--go-blue)", border: "1.5px solid var(--go-blue)" }}
          >
            {salvando ? "Salvando…" : inicial ? "Salvar alterações" : "Publicar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[12px] font-bold" style={{ color: "var(--go-text-heading)" }}>
        {rotulo}
      </label>
      <p className="mb-1.5 text-[11px] leading-relaxed" style={{ color: "#8b8b9a" }}>
        {dica}
      </p>
      {children}
    </div>
  );
}

/** Tipo reexportado para as rotas montarem os controles sem reimportar o módulo puro. */
export type { FaqItem };
