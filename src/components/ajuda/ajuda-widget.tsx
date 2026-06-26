// Widget de Ajuda & Suporte — botão flutuante (FAB) + painel ancorado no canto.
//
// Mão única (D1 da spec): a pessoa abre em qualquer página, escolhe DÚVIDA,
// PROBLEMA ou SUGESTÃO, escreve, opcionalmente anexa/cola/arrasta um print, e envia. O painel
// "cresce" a partir do botão (transform-origin no canto). NÃO é um chatbot — o
// cabeçalho deixa claro que a equipe responde direto pelo Google Chat. Visual derivado dos
// tokens GoGroup (--go-blue/--go-lime/--go-white, Poppins). Ver SPEC_WIDGET_AJUDA.md.

import { useEffect, useRef, useState } from "react";
import {
  HelpCircle,
  MessageCircleQuestion,
  Bug,
  Lightbulb,
  Paperclip,
  Send,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readFileAsBase64 } from "@/lib/submeter/constants";

type Tipo = "duvida" | "problema" | "sugestao";
type PrintAnexo = { base64: string; filename: string; previewUrl: string };

const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5 MB

const TIPOS: {
  id: Tipo;
  rotulo: string;
  descricao: string;
  placeholder: string;
  Icone: typeof HelpCircle;
  // Tom do chip do ícone — semântico (dúvida=info, problema=erro, sugestão=ideia),
  // nunca o ÚNICO sinal do estado: a seleção também é marcada por borda + rádio/check.
  chipBg: string;
  chipFg: string;
}[] = [
  {
    id: "duvida",
    rotulo: "Dúvida",
    descricao: "Não sei como fazer algo",
    placeholder: "Descreva sua dúvida com o máximo de detalhe…",
    Icone: MessageCircleQuestion,
    chipBg: "rgba(0,89,169,0.10)",
    chipFg: "var(--go-blue)",
  },
  {
    id: "problema",
    rotulo: "Problema",
    descricao: "Algo deu errado ou travou",
    placeholder: "O que aconteceu? Em que momento? O que você esperava?",
    Icone: Bug,
    chipBg: "rgba(220,38,38,0.10)",
    chipFg: "#dc2626",
  },
  {
    id: "sugestao",
    rotulo: "Sugestão",
    descricao: "Uma ideia pra melhorar",
    placeholder: "Qual a sua ideia? O que ela melhoraria no dia a dia?",
    Icone: Lightbulb,
    chipBg: "rgba(215,219,0,0.22)",
    chipFg: "#6b6d00",
  },
];

export function AjudaWidget() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("duvida");
  const [mensagem, setMensagem] = useState("");
  const [print, setPrint] = useState<PrintAnexo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const fabRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const printRef = useRef<PrintAnexo | null>(null);
  printRef.current = print;

  // Foca o textarea ao abrir.
  useEffect(() => {
    if (aberto) {
      const id = requestAnimationFrame(() => textareaRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [aberto]);

  // Fecha no Esc (só quando aberto).
  useEffect(() => {
    if (!aberto) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") fechar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Revoga a object URL do preview ao desmontar.
  useEffect(() => {
    return () => {
      if (printRef.current?.previewUrl) URL.revokeObjectURL(printRef.current.previewUrl);
    };
  }, []);

  function fechar() {
    setAberto(false);
    fabRef.current?.focus(); // devolve o foco ao botão
  }

  function limparPrint() {
    if (print?.previewUrl) URL.revokeObjectURL(print.previewUrl);
    setPrint(null);
  }

  async function adicionarArquivo(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Anexe uma imagem (print da tela).");
      return;
    }
    if (file.size > MAX_IMG_BYTES) {
      toast.error("Imagem muito grande (máximo 5 MB).");
      return;
    }
    try {
      const base64 = await readFileAsBase64(file);
      if (print?.previewUrl) URL.revokeObjectURL(print.previewUrl);
      setPrint({
        base64,
        filename: file.name || "print.png",
        previewUrl: URL.createObjectURL(file),
      });
    } catch {
      toast.error("Não consegui ler a imagem. Tente outro arquivo.");
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        void adicionarArquivo(file);
      }
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    void adicionarArquivo(file);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const texto = mensagem.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    try {
      await apiFetch("/api/ajuda", {
        tipo,
        mensagem: texto,
        pagina_url: window.location.pathname + window.location.search,
        user_agent: navigator.userAgent,
        print: print ? { base64: print.base64, filename: print.filename } : undefined,
      });
      toast.success("Enviado! A equipe vai dar uma olhada e responde direto pelo Google Chat.");
      // Reset completo só após sucesso.
      limparPrint();
      setMensagem("");
      setTipo("duvida");
      setAberto(false);
      fabRef.current?.focus();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não consegui enviar. Tente novamente.";
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  const podeEnviar = mensagem.trim().length > 0 && !enviando;

  return (
    <>
      {/* Captura cliques fora para fechar — transparente (a página continua visível). */}
      {aberto && (
        <div className="fixed inset-0 z-40" onClick={fechar} aria-hidden="true" />
      )}

      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
        {aberto && (
          <section
            role="dialog"
            aria-label="Ajuda e suporte"
            className="flex w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl"
            style={{
              maxHeight: "min(560px, 80vh)",
              background: "var(--go-white)",
              boxShadow: "0 24px 64px rgba(8,20,40,0.30)",
              animation: "go-pop-in 0.22s ease both",
              transformOrigin: "bottom right",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!arrastando) setArrastando(true);
            }}
            onDragLeave={(e) => {
              // só limpa quando sai de fato do painel
              if (e.currentTarget === e.target) setArrastando(false);
            }}
            onDrop={onDrop}
          >
            {/* Cabeçalho — faixa azul */}
            <header
              className="flex items-start justify-between gap-3 px-5 py-4"
              style={{ background: "var(--go-blue)", color: "var(--go-white)" }}
            >
              <div className="min-w-0">
                <h2 className="text-[16px] font-extrabold leading-tight">Precisa de ajuda?</h2>
                <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "rgba(255,255,255,0.85)" }}>
                  Tire uma dúvida, relate um problema ou mande uma sugestão. A equipe vê e responde direto pelo Google Chat.
                </p>
              </div>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar ajuda"
                className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{ color: "var(--go-white)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </header>

            {/* Corpo */}
            <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              {/* Seletor de tipo — lista vertical (3 opções). Cada tom de chip é
                  semântico; a seleção é marcada por borda + indicador rádio (forma),
                  nunca só por cor. */}
              <div role="group" aria-label="Tipo do chamado" className="flex flex-col gap-2">
                {TIPOS.map(({ id, rotulo, descricao, Icone, chipBg, chipFg }) => {
                  const sel = tipo === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={sel}
                      onClick={() => setTipo(id)}
                      className="flex items-center gap-3 rounded-xl p-2.5 text-left transition-all"
                      style={{
                        border: sel ? "1.5px solid var(--go-blue)" : "1.5px solid rgba(0,89,169,0.18)",
                        background: sel ? "rgba(0,89,169,0.05)" : "transparent",
                      }}
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                        style={{ background: chipBg, color: chipFg }}
                      >
                        <Icone style={{ width: 18, height: 18 }} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className="text-[13px] font-bold leading-tight"
                          style={{ color: sel ? "var(--go-blue)" : "var(--go-text-primary)" }}
                        >
                          {rotulo}
                        </span>
                        <span className="text-[11px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
                          {descricao}
                        </span>
                      </span>
                      <span
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full"
                        style={
                          sel
                            ? { background: "var(--go-blue)", color: "var(--go-white)" }
                            : { border: "1.5px solid rgba(0,89,169,0.30)" }
                        }
                      >
                        {sel && <Check style={{ width: 11, height: 11 }} strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Mensagem */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ajuda-mensagem" className="text-[12px] font-semibold" style={{ color: "var(--go-text-primary)" }}>
                  Sua mensagem
                </label>
                <textarea
                  id="ajuda-mensagem"
                  ref={textareaRef}
                  className="go-textarea"
                  style={{ minHeight: 96 }}
                  maxLength={4000}
                  placeholder={TIPOS.find((t) => t.id === tipo)?.placeholder ?? "Escreva aqui…"}
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  onPaste={onPaste}
                  onKeyDown={(e) => {
                    // Ctrl/Cmd+Enter envia.
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && podeEnviar) {
                      e.preventDefault();
                      void enviar(e as unknown as React.FormEvent);
                    }
                  }}
                />
              </div>

              {/* Anexo (print) */}
              <input
                id="ajuda-print-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void adicionarArquivo(e.target.files?.[0]);
                  e.target.value = ""; // permite reanexar o mesmo arquivo
                }}
              />
              {print ? (
                <div
                  className="flex items-center gap-3 rounded-xl p-2.5"
                  style={{ border: "1.5px solid rgba(0,89,169,0.18)", background: "rgba(0,89,169,0.03)" }}
                >
                  <img
                    src={print.previewUrl}
                    alt="Pré-visualização do print anexado"
                    className="h-11 w-11 shrink-0 rounded-lg object-cover"
                    style={{ border: "1px solid rgba(0,89,169,0.15)" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--go-text-primary)" }}>
                    {print.filename}
                  </span>
                  <button
                    type="button"
                    onClick={limparPrint}
                    aria-label="Remover print"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                    style={{ color: "var(--muted-foreground)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,89,169,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <X style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="ajuda-print-input"
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-semibold transition-all"
                  style={{
                    border: arrastando ? "1.5px dashed var(--go-blue)" : "1.5px dashed rgba(0,89,169,0.30)",
                    background: arrastando ? "rgba(0,89,169,0.06)" : "transparent",
                    color: "var(--go-blue)",
                  }}
                >
                  <Paperclip style={{ width: 15, height: 15 }} />
                  Anexar print — ou cole / arraste uma imagem
                </label>
              )}

              {/* Enviar */}
              <button
                type="submit"
                disabled={!podeEnviar}
                className="go-btn-submit"
                style={{ marginLeft: 0 }}
              >
                {enviando ? (
                  <>
                    <Loader2 className="animate-spin" style={{ width: 17, height: 17 }} />
                    Enviando…
                  </>
                ) : (
                  <>
                    <Send style={{ width: 16, height: 16 }} />
                    Enviar
                  </>
                )}
              </button>
            </form>
          </section>
        )}

        {/* Botão flutuante (FAB) */}
        <button
          ref={fabRef}
          type="button"
          onClick={() => (aberto ? fechar() : setAberto(true))}
          aria-haspopup="dialog"
          aria-expanded={aberto}
          aria-label={aberto ? "Fechar ajuda" : "Abrir ajuda e suporte"}
          className="flex h-14 w-14 items-center justify-center rounded-full transition-transform"
          style={{
            background: "var(--go-blue)",
            color: "var(--go-white)",
            boxShadow: "var(--go-shadow-lg)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "var(--go-shadow-lime-glow)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "var(--go-shadow-lg)";
          }}
        >
          {aberto ? <X style={{ width: 24, height: 24 }} /> : <HelpCircle style={{ width: 26, height: 26 }} />}
        </button>
      </div>
    </>
  );
}
