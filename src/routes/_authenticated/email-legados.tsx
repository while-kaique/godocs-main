import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  Send,
  Eye,
  Save,
  Mail,
  CheckCircle2,
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  X,
} from "lucide-react";

type Recipient = {
  email: string;
  nome: string | null;
  projetos: { id: string; nome: string | null }[];
  ultimoEnvio: { data: string | null; status: string } | null;
};

type Preview = {
  recipients: Recipient[];
  totalPessoas: number;
  totalProjetos: number;
  template: { assunto: string; corpo: string };
};

const VARIAVEIS = [
  { token: "{{nome}}", desc: "Nome do destinatário" },
  { token: "{{projetos}}", desc: "Lista dos projetos pendentes da pessoa" },
  { token: "{{prazo}}", desc: "Prazo de regularização (30/06/2026)" },
  { token: "{{link}}", desc: 'Botão "Acessar Meus Projetos"' },
] as const;

export const Route = createFileRoute("/_authenticated/email-legados")({
  head: () => ({ meta: [{ title: "Cobrança de legados · Hub Admin" }] }),
  component: EmailLegadosPage,
});

function formatarData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function EmailLegadosPage() {
  const [data, setData] = useState<Preview | null>(null);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{
    total: number;
    enviados: number;
    falhas: number;
    status: "enviando" | "concluido" | "erro";
  } | null>(null);
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  // E-mails escolhidos para o disparo (default: todos). Set para toggle barato.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  async function load() {
    try {
      const d = await apiFetch<Preview>("/api/admin/email-legados/preview");
      setData(d);
      setAssunto(d.template.assunto);
      setCorpo(d.template.corpo);
      // Seleciona todos por padrão (envio para todos os pendentes).
      setSelecionados(new Set(d.recipients.map((r) => r.email)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar a lista.");
      setData({ recipients: [], totalPessoas: 0, totalProjetos: 0, template: { assunto: "", corpo: "" } });
    }
  }

  function toggleSelecionado(email: string) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });
  }

  function toggleTodos() {
    if (!data) return;
    setSelecionados((s) =>
      s.size === data.recipients.length ? new Set() : new Set(data.recipients.map((r) => r.email)),
    );
  }

  useEffect(() => {
    load();
  }, []);

  async function sincronizar() {
    setSyncing(true);
    try {
      await apiFetch("/api/admin/sync-sheets-now", {});
      await load();
      toast.success("Lista atualizada a partir da planilha.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar da planilha.");
    } finally {
      setSyncing(false);
    }
  }

  async function salvar() {
    setSaving(true);
    try {
      await apiFetch("/api/admin/email-legados/template", { assunto, corpo });
      toast.success("Mensagem salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar a mensagem.");
    } finally {
      setSaving(false);
    }
  }

  async function enviarTeste() {
    setTesting(true);
    try {
      await apiFetch("/api/admin/email-legados/template", { assunto, corpo });
      await apiFetch("/api/admin/email-legados/teste", {});
      toast.success("E-mail de teste enviado para você.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar o teste.");
    } finally {
      setTesting(false);
    }
  }

  async function dispararLote() {
    setSending(true);
    try {
      const r = await apiFetch<{ loteId: string; total: number }>(
        "/api/admin/email-legados/enviar",
        { assunto, corpo, emails: Array.from(selecionados) },
      );
      setConfirmOpen(false);
      // Abre o modal de progresso e começa a acompanhar.
      setLoteId(r.loteId);
      setProgresso({ total: r.total, enviados: 0, falhas: 0, status: "enviando" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao disparar os e-mails.");
    } finally {
      setSending(false);
    }
  }

  function fecharProgresso() {
    setProgresso(null);
    setLoteId(null);
  }

  async function cancelarEnvio() {
    if (!loteId) return;
    // Feedback imediato; o backend confirma no próximo poll.
    setProgresso((p) => (p ? { ...p, status: "cancelando" } : p));
    try {
      await apiFetch(`/api/admin/email-legados/cancelar/${loteId}`, {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cancelar o envio.");
    }
  }

  // Polling do progresso do lote enquanto está "enviando" ou "cancelando".
  useEffect(() => {
    const emProgresso = progresso?.status === "enviando" || progresso?.status === "cancelando";
    if (!loteId || !emProgresso) return;
    let cancel = false;
    const timer = setInterval(async () => {
      try {
        const p = await apiFetch<{
          total: number;
          enviados: number;
          falhas: number;
          status: "enviando" | "cancelando" | "concluido" | "erro" | "cancelado";
        }>(`/api/admin/email-legados/progresso/${loteId}`);
        if (cancel) return;
        setProgresso(p);
        const terminou = p.status === "concluido" || p.status === "erro" || p.status === "cancelado";
        if (terminou) {
          clearInterval(timer);
          load(); // atualiza os selos "enviado em" na lista
          if (p.status === "concluido") {
            toast.success(
              `Envio concluído: ${p.enviados} enviado(s)${p.falhas ? `, ${p.falhas} falha(s)` : ""}.`,
            );
          } else if (p.status === "cancelado") {
            toast(`Envio cancelado: ${p.enviados} de ${p.total} enviado(s).`);
          } else {
            toast.error("O envio terminou com erro. Confira a lista.");
          }
        }
      } catch {
        /* falha de rede no poll — tenta de novo no próximo tick */
      }
    }, 1000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId, progresso?.status]);

  function inserirVariavel(token: string) {
    const el = corpoRef.current;
    if (!el) {
      setCorpo((c) => c + token);
      return;
    }
    const start = el.selectionStart ?? corpo.length;
    const end = el.selectionEnd ?? corpo.length;
    const novo = corpo.slice(0, start) + token + corpo.slice(end);
    setCorpo(novo);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const total = data?.totalPessoas ?? 0;
  const carregando = data === null;
  const selCount = selecionados.size;
  const todosSelecionados = !!data && data.recipients.length > 0 && selCount === data.recipients.length;
  const emProgresso = progresso?.status === "enviando" || progresso?.status === "cancelando";

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Mail className="h-7 w-7" style={{ color: "var(--go-blue)" }} />
            Cobrança de legados
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Envia um e-mail para os <strong>donos de projetos legados</strong> que ainda não foram
            regularizados (sem data em "Atualizado Em"). Os que já foram atualizados ficam de fora. Um
            e-mail por pessoa, listando todos os projetos pendentes dela.
          </p>
        </div>
        <Button variant="outline" onClick={sincronizar} disabled={syncing} className="shrink-0">
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Atualizar da planilha
        </Button>
      </header>

      {/* Contagem — foco da tela */}
      <div
        className="mt-6 flex flex-wrap items-center gap-6 rounded-2xl px-6 py-5 text-white"
        style={{ background: "var(--go-blue)" }}
      >
        <div>
          <div className="text-5xl font-bold leading-none tabular-nums">
            {carregando ? "—" : selCount}
          </div>
          <div className="mt-1 text-sm text-white/80">
            {selCount === 1 ? "pessoa selecionada" : "pessoas selecionadas"}
            {!carregando && ` de ${total} pendente${total === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="h-12 w-px bg-white/25" aria-hidden />
        <div>
          <div className="text-2xl font-semibold leading-none tabular-nums">
            {carregando ? "—" : data?.totalProjetos}
          </div>
          <div className="mt-1 text-sm text-white/80">projetos pendentes</div>
        </div>
        <div className="h-12 w-px bg-white/25" aria-hidden />
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-white/80" />
          <div>
            <div className="text-base font-semibold leading-none">30/06/2026</div>
            <div className="mt-1 text-sm text-white/80">prazo de regularização</div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Editor */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Mensagem</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Edite o texto enviado a todos. Use as variáveis abaixo — elas são preenchidas por
            destinatário.
          </p>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="assunto">Assunto</Label>
            <Input
              id="assunto"
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Assunto do e-mail"
            />
          </div>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="corpo">Mensagem</Label>
            <textarea
              id="corpo"
              ref={corpoRef}
              value={corpo}
              onChange={(e) => setCorpo(e.target.value)}
              rows={12}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Texto do e-mail"
            />
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-muted-foreground">Variáveis (clique para inserir)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {VARIAVEIS.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => inserirVariavel(v.token)}
                  title={v.desc}
                  className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:border-[var(--go-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {v.token}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={salvar} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar mensagem
            </Button>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />
              Pré-visualizar
            </Button>
          </div>
        </section>

        {/* Destinatários */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Destinatários</h2>
            {!carregando && total > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={todosSelecionados}
                  onCheckedChange={toggleTodos}
                  aria-label="Selecionar todos os destinatários"
                />
                Selecionar todos
              </label>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {carregando
              ? "Carregando…"
              : total === 0
                ? "Nenhum legado pendente — todos foram regularizados."
                : `Marque quem vai receber. ${selCount} de ${total} selecionado(s).`}
          </p>

          <ul className="mt-4 max-h-[28rem] divide-y divide-border overflow-auto rounded-lg border border-border">
            {carregando ? (
              <li className="p-4 text-center text-sm text-muted-foreground">Carregando…</li>
            ) : total === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">Nada a enviar.</li>
            ) : (
              data!.recipients.map((r) => {
                const aberto = expandido[r.email] ?? false;
                return (
                  <li key={r.email} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selecionados.has(r.email)}
                        onCheckedChange={() => toggleSelecionado(r.email)}
                        aria-label={`Selecionar ${r.nome ?? r.email}`}
                      />
                      <button
                        type="button"
                        onClick={() => setExpandido((s) => ({ ...s, [r.email]: !aberto }))}
                        className="flex flex-1 items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        aria-expanded={aberto}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.nome ?? r.email}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.email} · {r.projetos.length} projeto(s)
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {r.ultimoEnvio &&
                            (r.ultimoEnvio.status === "falha" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                                <AlertTriangle className="h-3 w-3" />
                                Falhou
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Enviado {formatarData(r.ultimoEnvio.data)}
                              </span>
                            ))}
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`}
                          />
                        </span>
                      </button>
                    </div>
                    {aberto && (
                      <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 ml-7">
                        {r.projetos.map((p) => (
                          <li key={p.id} className="text-sm">
                            <span className="font-medium">{p.nome ?? "Projeto sem nome"}</span>{" "}
                            <span className="text-xs text-muted-foreground">({p.id})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>

      {/* Barra de ação */}
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card/95 p-4 backdrop-blur">
        <Button variant="outline" onClick={enviarTeste} disabled={testing}>
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Enviar teste para mim
        </Button>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={carregando || selCount === 0}
          style={{ background: "var(--go-blue)" }}
          className="text-white hover:opacity-90"
        >
          <Mail className="mr-2 h-4 w-4" />
          Enviar para {selCount} pessoa(s)
        </Button>
      </div>

      {/* Modal de pré-visualização */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pré-visualização</DialogTitle>
            <DialogDescription>
              Exemplo com dados fictícios. As variáveis são preenchidas por destinatário no envio.
            </DialogDescription>
          </DialogHeader>
          <PreviewEmail assunto={assunto} corpo={corpo} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de disparo */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar disparo</DialogTitle>
            <DialogDescription>
              Você vai enviar este e-mail para <strong>{selCount} pessoa(s)</strong> selecionada(s)
              {selCount < total ? ` (de ${total} pendentes)` : ""}. A ação é registrada e o envio
              roda em segundo plano. Deseja continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Cancelar
            </Button>
            <Button
              onClick={dispararLote}
              disabled={sending}
              style={{ background: "var(--go-blue)" }}
              className="text-white hover:opacity-90"
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Confirmar e enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de progresso do disparo (sobreposto, não fecha enquanto envia) */}
      <Dialog
        open={!!progresso}
        onOpenChange={(o) => {
          if (!o && !emProgresso) fecharProgresso();
        }}
      >
        <DialogContent
          className={emProgresso ? "[&>button]:hidden" : undefined}
          onEscapeKeyDown={(e) => emProgresso && e.preventDefault()}
          onInteractOutside={(e) => emProgresso && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {emProgresso && <Loader2 className="h-5 w-5 animate-spin" />}
              {progresso?.status === "concluido"
                ? "Envio concluído"
                : progresso?.status === "erro"
                  ? "Envio interrompido"
                  : progresso?.status === "cancelado"
                    ? "Envio cancelado"
                    : progresso?.status === "cancelando"
                      ? "Cancelando…"
                      : "Enviando e-mails…"}
            </DialogTitle>
            <DialogDescription>
              {emProgresso
                ? "Não feche esta janela até o envio terminar."
                : "Você já pode fechar esta janela."}
            </DialogDescription>
          </DialogHeader>

          {progresso && (
            <div className="space-y-3 py-2">
              <div className="flex items-baseline justify-between">
                <span className="text-4xl font-bold tabular-nums" style={{ color: "var(--go-blue)" }}>
                  {String(progresso.enviados + progresso.falhas).padStart(
                    String(progresso.total).length || 1,
                    "0",
                  )}
                  <span className="text-2xl text-muted-foreground">/{progresso.total}</span>
                </span>
                {progresso.falhas > 0 && (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
                    <AlertTriangle className="h-4 w-4" />
                    {progresso.falhas} falha(s)
                  </span>
                )}
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progresso.total}
                aria-valuenow={progresso.enviados + progresso.falhas}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width:
                      progresso.total > 0
                        ? `${((progresso.enviados + progresso.falhas) / progresso.total) * 100}%`
                        : "100%",
                    background: "var(--go-blue)",
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {progresso.status === "enviando"
                  ? "Enviando… os e-mails saem de rpa_ia@gocase.com."
                  : progresso.status === "cancelando"
                    ? "Interrompendo após o e-mail atual…"
                    : progresso.status === "concluido"
                      ? `${progresso.enviados} e-mail(s) enviado(s) com sucesso.`
                      : progresso.status === "cancelado"
                        ? `Cancelado: ${progresso.enviados} de ${progresso.total} enviado(s). Os demais não receberam.`
                        : "O envio terminou com erro antes de concluir."}
              </p>
            </div>
          )}

          <DialogFooter>
            {progresso?.status === "enviando" && (
              <Button variant="outline" onClick={cancelarEnvio} className="text-red-600 hover:text-red-700">
                <X className="mr-2 h-4 w-4" />
                Cancelar envio
              </Button>
            )}
            {progresso?.status === "cancelando" && (
              <Button variant="outline" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancelando…
              </Button>
            )}
            {!emProgresso && <Button onClick={fecharProgresso}>Fechar</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Pré-visualização leve (texto resolvido). O e-mail HTML real é o que chega no "teste para mim".
function PreviewEmail({ assunto, corpo }: { assunto: string; corpo: string }) {
  const NOME = "Maria (exemplo)";
  const PRAZO = "30/06/2026";
  const assuntoR = assunto.replace(/\{\{\s*nome\s*\}\}/g, NOME).replace(/\{\{\s*prazo\s*\}\}/g, PRAZO);

  const partes = corpo
    .replace(/\{\{\s*nome\s*\}\}/g, NOME)
    .replace(/\{\{\s*prazo\s*\}\}/g, PRAZO)
    .split(/(\{\{\s*projetos\s*\}\}|\{\{\s*link\s*\}\})/g);

  return (
    <div className="rounded-lg border border-border bg-[var(--go-cream)] p-4">
      <div className="rounded-md bg-[var(--go-blue)] px-4 py-2 text-sm font-semibold text-white">
        GoDocs
      </div>
      <div className="mt-3 rounded-md bg-white p-4 text-sm leading-relaxed text-foreground">
        <div className="mb-2 border-b border-border pb-2 text-xs text-muted-foreground">
          Assunto: <span className="font-medium text-foreground">{assuntoR}</span>
        </div>
        {partes.map((parte, i) => {
          if (/\{\{\s*projetos\s*\}\}/.test(parte)) {
            return (
              <ul key={i} className="my-2 list-disc pl-5">
                <li>
                  <strong>Projeto de Exemplo</strong>{" "}
                  <span className="text-muted-foreground">(legado-000)</span>
                </li>
                <li>
                  <strong>Outro Projeto Pendente</strong>{" "}
                  <span className="text-muted-foreground">(legado-001)</span>
                </li>
              </ul>
            );
          }
          if (/\{\{\s*link\s*\}\}/.test(parte)) {
            return (
              <span
                key={i}
                className="my-2 inline-block rounded-md bg-[var(--go-blue)] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Acessar Meus Projetos
              </span>
            );
          }
          return (
            <span key={i} className="whitespace-pre-wrap">
              {parte}
            </span>
          );
        })}
      </div>
    </div>
  );
}
