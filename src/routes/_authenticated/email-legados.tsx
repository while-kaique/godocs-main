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
  Search,
  RotateCcw,
  Megaphone,
  Info,
} from "lucide-react";

// ── Segmentos (públicos) ──────────────────────────────────────────────────────
// A tela dispara e-mails para 3 públicos distintos, cada um com sua própria lista de
// destinatários (calculada ao vivo) e seu próprio template. O estado é distinto por
// ícone + rótulo + acento (nunca só cor).
type Audiencia = "legado" | "reenvio" | "todos";

const SEGMENTOS: {
  key: Audiencia;
  label: string;
  curto: string;
  icon: typeof CalendarClock;
  accent: string;
  descricao: string;
  projLabel: string;
}[] = [
  {
    key: "legado",
    label: "Atualização de legado",
    curto: "Legado",
    icon: CalendarClock,
    accent: "var(--go-blue)",
    descricao:
      'Donos de projetos legados ainda não regularizados (sem data em "Atualizado Em"). Pede para revisar e salvar.',
    projLabel: "projetos pendentes",
  },
  {
    key: "reenvio",
    label: "Reenvio pendente",
    curto: "Reenvio",
    icon: RotateCcw,
    accent: "#8a7d00",
    descricao:
      'Projetos marcados como "Reenvio Pendente" na planilha. O e-mail inclui o motivo apontado na revisão.',
    projLabel: "projetos a reenviar",
  },
  {
    key: "todos",
    label: "Todos os responsáveis",
    curto: "Todos",
    icon: Megaphone,
    accent: "#475569",
    descricao:
      "Qualquer dono de projeto na planilha — comunicado geral. Nada vem marcado por padrão; selecione quem vai receber.",
    projLabel: "projetos no total",
  },
];

function segMeta(a: Audiencia) {
  return SEGMENTOS.find((s) => s.key === a)!;
}

type ProjetoR = { id: string; nome: string | null; motivo?: string | null };

type Recipient = {
  email: string;
  nome: string | null;
  projetos: ProjetoR[];
  ultimoEnvio: { data: string | null; status: string } | null;
};

type Preview = {
  audiencia: Audiencia;
  recipients: Recipient[];
  totalPessoas: number;
  totalProjetos: number;
  template: { assunto: string; corpo: string };
};

// Variáveis disponíveis no template — adaptadas ao segmento ({{prazo}} só no legado; no
// reenvio o {{projetos}} inclui o motivo).
function variaveisDe(a: Audiencia) {
  const base = [
    { token: "{{nome}}", desc: "Nome do destinatário" },
    {
      token: "{{projetos}}",
      desc:
        a === "reenvio"
          ? "Lista dos projetos com o motivo da revisão"
          : "Lista dos projetos da pessoa",
    },
    { token: "{{link}}", desc: 'Botão "Acessar Meus Projetos"' },
  ];
  if (a === "legado") {
    base.splice(2, 0, { token: "{{prazo}}", desc: "Prazo de regularização (30/06/2026)" });
  }
  return base;
}

export const Route = createFileRoute("/_authenticated/email-legados")({
  head: () => ({ meta: [{ title: "Disparo de e-mails · Hub Admin" }] }),
  component: EmailLegadosPage,
});

function formatarData(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

type Prog = {
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  status: "enviando" | "cancelando" | "concluido" | "erro" | "cancelado";
};

// Seleção padrão por segmento: legado/reenvio = quem ainda não recebeu (ou falhou); todos =
// nenhum (broadcast não vem marcado por engano).
function selecaoPadrao(aud: Audiencia, recipients: Recipient[]): Set<string> {
  if (aud === "todos") return new Set();
  return new Set(
    recipients
      .filter((r) => !r.ultimoEnvio || r.ultimoEnvio.status === "falha")
      .map((r) => r.email),
  );
}

function EmailLegadosPage() {
  const [audiencia, setAudiencia] = useState<Audiencia>("legado");
  // Estado por segmento (preserva edições de template e seleção ao trocar de aba).
  const [previews, setPreviews] = useState<Partial<Record<Audiencia, Preview>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<Audiencia, { assunto: string; corpo: string }>>>({});
  const [selByAud, setSelByAud] = useState<Partial<Record<Audiencia, Set<string>>>>({});
  const [loadingAud, setLoadingAud] = useState<Audiencia | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Prog | null>(null);
  const [expandido, setExpandido] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  const corpoRef = useRef<HTMLTextAreaElement>(null);

  const meta = segMeta(audiencia);
  const data = previews[audiencia] ?? null;
  const draft = drafts[audiencia];
  const assunto = draft?.assunto ?? "";
  const corpo = draft?.corpo ?? "";
  const selecionados = selByAud[audiencia] ?? new Set<string>();

  function setAssunto(v: string) {
    setDrafts((d) => ({ ...d, [audiencia]: { assunto: v, corpo: d[audiencia]?.corpo ?? "" } }));
  }
  function setCorpo(v: string) {
    setDrafts((d) => ({ ...d, [audiencia]: { assunto: d[audiencia]?.assunto ?? "", corpo: v } }));
  }

  async function load(aud: Audiencia) {
    setLoadingAud(aud);
    try {
      const d = await apiFetch<Preview>(`/api/admin/email-legados/preview?audiencia=${aud}`);
      setPreviews((p) => ({ ...p, [aud]: d }));
      // Só semeia o draft na 1ª carga do segmento — não atropela edições não salvas.
      setDrafts((dr) =>
        dr[aud] ? dr : { ...dr, [aud]: { assunto: d.template.assunto, corpo: d.template.corpo } },
      );
      setSelByAud((s) => ({ ...s, [aud]: selecaoPadrao(aud, d.recipients) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar a lista.");
      setPreviews((p) => ({
        ...p,
        [aud]: { audiencia: aud, recipients: [], totalPessoas: 0, totalProjetos: 0, template: { assunto: "", corpo: "" } },
      }));
    } finally {
      setLoadingAud((cur) => (cur === aud ? null : cur));
    }
  }

  // Carrega o segmento ativo na 1ª vez que é aberto (lazy — evita ler o Sheets 3× no load).
  useEffect(() => {
    if (!previews[audiencia]) load(audiencia);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audiencia]);

  function toggleSelecionado(email: string) {
    setSelByAud((s) => {
      const cur = new Set(s[audiencia] ?? []);
      if (cur.has(email)) cur.delete(email);
      else cur.add(email);
      return { ...s, [audiencia]: cur };
    });
  }

  // Marca/desmarca todos os destinatários da LISTA VISÍVEL (respeita o filtro de busca).
  function toggleTodos(lista: Recipient[]) {
    setSelByAud((s) => {
      const cur = new Set(s[audiencia] ?? []);
      const todosMarcados = lista.length > 0 && lista.every((r) => cur.has(r.email));
      if (todosMarcados) lista.forEach((r) => cur.delete(r.email));
      else lista.forEach((r) => cur.add(r.email));
      return { ...s, [audiencia]: cur };
    });
  }

  async function sincronizar() {
    setSyncing(true);
    try {
      await apiFetch("/api/admin/sync-sheets-now", {});
      await load(audiencia);
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
      await apiFetch("/api/admin/email-legados/template", { audiencia, assunto, corpo });
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
      await apiFetch("/api/admin/email-legados/template", { audiencia, assunto, corpo });
      await apiFetch("/api/admin/email-legados/teste", { audiencia });
      toast.success("E-mail de teste enviado para você.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar o teste.");
    } finally {
      setTesting(false);
    }
  }

  // Driver de envio em lotes: chama .../chunk em sequência até terminar. Cada chamada é
  // curta (poucos e-mails) — não depende de tarefa em background, então não trava.
  async function rodarChunks(id: string) {
    let falhasSeguidas = 0;
    for (;;) {
      try {
        const p = await apiFetch<Prog>(`/api/admin/email-legados/chunk/${id}`, {});
        falhasSeguidas = 0;
        setProgresso(p);
        if (p.status !== "enviando" && p.status !== "cancelando") {
          await load(audiencia); // atualiza os selos "enviado em" na lista
          if (p.status === "concluido") {
            toast.success(
              `Envio concluído: ${p.enviados} enviado(s)${p.falhas ? `, ${p.falhas} falha(s)` : ""}.`,
            );
          } else if (p.status === "cancelado") {
            toast(`Envio cancelado: ${p.enviados} de ${p.total} enviado(s).`);
          } else {
            toast.error("O envio terminou com erro. Confira a lista.");
          }
          return;
        }
      } catch (e) {
        // Rede instável: tenta de novo (o cursor é server-side, então não reenvia).
        falhasSeguidas++;
        if (falhasSeguidas >= 5) {
          toast.error("Conexão instável — o envio foi pausado. Reabra para retomar.");
          setProgresso((p) => (p ? { ...p, status: "erro" } : p));
          return;
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
  }

  async function dispararLote() {
    setSending(true);
    try {
      const r = await apiFetch<{ loteId: string; total: number }>(
        "/api/admin/email-legados/enviar",
        { audiencia, assunto, corpo, emails: Array.from(selecionados) },
      );
      setConfirmOpen(false);
      setLoteId(r.loteId);
      setProgresso({ total: r.total, processados: 0, enviados: 0, falhas: 0, status: "enviando" });
      rodarChunks(r.loteId); // dispara o driver (não await — segue rodando)
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
    // Feedback imediato; o próximo chunk vê 'cancelando' e finaliza como 'cancelado'.
    setProgresso((p) => (p ? { ...p, status: "cancelando" } : p));
    try {
      await apiFetch(`/api/admin/email-legados/cancelar/${loteId}`, {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao cancelar o envio.");
    }
  }

  function inserirVariavel(token: string) {
    const el = corpoRef.current;
    if (!el) {
      setCorpo(corpo + token);
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

  // Navegação por seta no seletor de segmentos (a11y do role="tablist").
  function onTabsKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = SEGMENTOS.findIndex((s) => s.key === audiencia);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = SEGMENTOS[(i + delta + SEGMENTOS.length) % SEGMENTOS.length];
    setAudiencia(next.key);
  }

  const total = data?.totalPessoas ?? 0;
  const carregando = !previews[audiencia];
  const selCount = selecionados.size;
  const buscaLower = busca.trim().toLowerCase();
  const recipientesFiltrados = (data?.recipients ?? []).filter(
    (r) =>
      !buscaLower ||
      (r.nome ?? "").toLowerCase().includes(buscaLower) ||
      r.email.toLowerCase().includes(buscaLower),
  );
  const todosFiltradosSelecionados =
    recipientesFiltrados.length > 0 && recipientesFiltrados.every((r) => selecionados.has(r.email));
  const emProgresso = progresso?.status === "enviando" || progresso?.status === "cancelando";
  const variaveis = variaveisDe(audiencia);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Mail className="h-7 w-7" style={{ color: "var(--go-blue)" }} />
            Disparo de e-mails
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Escolha o público, ajuste a mensagem e dispare. Cada público tem sua própria lista e seu
            próprio texto. Um e-mail por pessoa, agrupando todos os projetos dela.
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

      {/* Seletor de público (segmented control acessível) */}
      <div
        role="tablist"
        aria-label="Público do disparo"
        onKeyDown={onTabsKeyDown}
        className="mt-6 grid gap-2 rounded-2xl border border-border bg-muted/40 p-1.5 sm:grid-cols-3"
      >
        {SEGMENTOS.map((s) => {
          const ativo = s.key === audiencia;
          const Icone = s.icon;
          const carregadoAud = previews[s.key];
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={ativo}
              onClick={() => setAudiencia(s.key)}
              tabIndex={ativo ? 0 : -1}
              className={`relative overflow-hidden rounded-xl px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                ativo ? "bg-card shadow-sm" : "hover:bg-card/60"
              }`}
            >
              {ativo && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
                  style={{ background: s.accent }}
                />
              )}
              <span className="flex items-center gap-2">
                <Icone
                  className="h-4 w-4 shrink-0"
                  style={{ color: ativo ? s.accent : undefined }}
                />
                <span className={`text-sm ${ativo ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                  {s.label}
                </span>
                {carregadoAud && (
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                    style={
                      ativo
                        ? { background: s.accent, color: "#fff" }
                        : { background: "rgba(0,0,0,0.06)", color: "#6b7280" }
                    }
                  >
                    {carregadoAud.totalPessoas}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-sm text-muted-foreground">{meta.descricao}</p>

      {/* Resumo — números do segmento ativo */}
      <div
        className="mt-4 flex flex-wrap items-center gap-6 rounded-2xl px-6 py-5 text-white"
        style={{ background: "var(--go-blue)" }}
      >
        <div>
          <div className="text-5xl font-bold leading-none tabular-nums">
            {carregando ? "—" : selCount}
          </div>
          <div className="mt-1 text-sm text-white/80">
            {selCount === 1 ? "pessoa selecionada" : "pessoas selecionadas"}
            {!carregando && ` de ${total}`}
          </div>
        </div>
        <div className="h-12 w-px bg-white/25" aria-hidden />
        <div>
          <div className="text-2xl font-semibold leading-none tabular-nums">
            {carregando ? "—" : data?.totalProjetos}
          </div>
          <div className="mt-1 text-sm text-white/80">{meta.projLabel}</div>
        </div>
        <div className="h-12 w-px bg-white/25" aria-hidden />
        {audiencia === "legado" ? (
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-white/80" />
            <div>
              <div className="text-base font-semibold leading-none">30/06/2026</div>
              <div className="mt-1 text-sm text-white/80">prazo de regularização</div>
            </div>
          </div>
        ) : audiencia === "reenvio" ? (
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-white/80" />
            <div>
              <div className="text-base font-semibold leading-none">Motivo incluído</div>
              <div className="mt-1 text-sm text-white/80">do parecer da revisão</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-white/80" />
            <div>
              <div className="text-base font-semibold leading-none">Comunicado geral</div>
              <div className="mt-1 text-sm text-white/80">a qualquer responsável</div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Editor */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Mensagem</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Edite o texto deste público. Use as variáveis abaixo — elas são preenchidas por
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
              {variaveis.map((v) => (
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
                  checked={todosFiltradosSelecionados}
                  onCheckedChange={() => toggleTodos(recipientesFiltrados)}
                  aria-label="Selecionar todos os destinatários exibidos"
                />
                {buscaLower ? "Selecionar exibidos" : "Selecionar todos"}
              </label>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {carregando
              ? "Carregando…"
              : total === 0
                ? audiencia === "legado"
                  ? "Nenhum legado pendente — todos foram regularizados."
                  : audiencia === "reenvio"
                    ? 'Ninguém com status "Reenvio Pendente" na planilha agora.'
                    : "Nenhum responsável encontrado na planilha."
                : `Marque quem vai receber. ${selCount} de ${total} selecionado(s)${buscaLower ? ` · ${recipientesFiltrados.length} exibido(s)` : ""}.`}
          </p>

          {!carregando && total > 0 && (
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="pl-9"
                aria-label="Buscar destinatário por nome ou e-mail"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          <ul className="mt-4 max-h-[28rem] divide-y divide-border overflow-auto rounded-lg border border-border">
            {carregando ? (
              <li className="p-4 text-center text-sm text-muted-foreground">Carregando…</li>
            ) : total === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">Nada a enviar.</li>
            ) : recipientesFiltrados.length === 0 ? (
              <li className="p-4 text-center text-sm text-muted-foreground">
                Nenhum resultado para "{busca}".
              </li>
            ) : (
              recipientesFiltrados.map((r) => {
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
                            className={`h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`}
                          />
                        </span>
                      </button>
                    </div>
                    {aberto && (
                      <ul className="mt-2 space-y-1.5 border-l-2 border-border pl-3 ml-7">
                        {r.projetos.map((p) => (
                          <li key={p.id} className="text-sm">
                            <span className="font-medium">{p.nome ?? "Projeto sem nome"}</span>{" "}
                            <span className="text-xs text-muted-foreground">({p.id})</span>
                            {audiencia === "reenvio" && p.motivo && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Motivo: {p.motivo}
                              </span>
                            )}
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
          <PreviewEmail assunto={assunto} corpo={corpo} audiencia={audiencia} />
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
              Público: <strong>{meta.label}</strong>. Você vai enviar este e-mail para{" "}
              <strong>{selCount} pessoa(s)</strong> selecionada(s)
              {selCount < total ? ` (de ${total})` : ""}. A ação é registrada. Deseja continuar?
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
                  {String(progresso.processados).padStart(String(progresso.total).length || 1, "0")}
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
                aria-valuenow={progresso.processados}
              >
                <div
                  className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
                  style={{
                    width:
                      progresso.total > 0
                        ? `${(progresso.processados / progresso.total) * 100}%`
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
function PreviewEmail({
  assunto,
  corpo,
  audiencia,
}: {
  assunto: string;
  corpo: string;
  audiencia: Audiencia;
}) {
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
                  <strong>Projeto de Exemplo</strong>
                  {audiencia === "reenvio" && (
                    <span className="block text-xs text-muted-foreground">
                      Motivo: faltou a composição das horas do cargo Analista.
                    </span>
                  )}
                </li>
                <li>
                  <strong>Outro Projeto Pendente</strong>
                  {audiencia === "reenvio" && (
                    <span className="block text-xs text-muted-foreground">
                      Motivo: revisar a base de cálculo do memorial.
                    </span>
                  )}
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
