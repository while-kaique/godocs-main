import { useCallback, useEffect, useRef, useState } from 'react';
import {
  History,
  RefreshCw,
  Loader2,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Star,
  Users,
  Gavel,
  ClipboardCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** Espelha ListagemAtividades/AtividadeItem do backend (atividades.functions.ts). */
type Atividade = {
  id: string;
  ator_email: string;
  acao: string;
  projeto_id: string | null;
  projeto_nome: string | null;
  detalhe: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};
type Pagina = { itens: Atividade[]; proximoCursor: string | null };

// ── Helpers locais (puros — não importam nada de server, para o bundle não engordar) ──

/** local-part do e-mail → Title Case ("luis.albuquerque@x" → "Luis Albuquerque"). */
function nomeDeEmail(email: string): string {
  const local = (email.split('@')[0] ?? email).replace(/[._-]+/g, ' ').trim();
  if (!local) return email;
  return local
    .split(' ')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/** SQLite grava `datetime('now')` em UTC ("2026-08-19 14:23:01"): sem Z, com espaço. */
function parseCarimbo(v: string | null): Date | null {
  if (!v) return null;
  const s = v.trim();
  // Formato do SQLite → força UTC. ISO com Z/offset passa direto pelo Date.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TZ = 'America/Sao_Paulo';

function horaCurta(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
function dataHoraLonga(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TZ,
  });
}
/** Chave de dia (YYYY-MM-DD no fuso de Brasília) para agrupar. */
function chaveDia(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA → ISO-like
}
function rotuloDia(chave: string): string {
  const hojeK = chaveDia(new Date());
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const ontemK = chaveDia(ontem);
  if (chave === hojeK) return 'Hoje';
  if (chave === ontemK) return 'Ontem';
  const [y, m, dd] = chave.split('-');
  return new Date(Date.UTC(+y, +m - 1, +dd)).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ── Visual por ação (ícone + tom). Estado NUNCA só por cor: sempre ícone + rótulo. ──

type Tom = 'aprovado' | 'reprovado' | 'reenvio' | 'estrela' | 'area' | 'lider' | 'reabrir' | 'neutro';

const CLASSES_TOM: Record<Tom, { chip: string; texto: string }> = {
  aprovado: { chip: 'bg-emerald-100 text-emerald-700', texto: 'text-emerald-700' },
  reprovado: { chip: 'bg-rose-100 text-rose-700', texto: 'text-rose-700' },
  reenvio: { chip: 'bg-amber-100 text-amber-700', texto: 'text-amber-700' },
  estrela: { chip: 'bg-blue-100 text-blue-700', texto: 'text-blue-700' },
  area: { chip: 'bg-slate-100 text-slate-700', texto: 'text-slate-700' },
  lider: { chip: 'bg-indigo-100 text-indigo-700', texto: 'text-indigo-700' },
  reabrir: { chip: 'bg-cyan-100 text-cyan-700', texto: 'text-cyan-700' },
  neutro: { chip: 'bg-muted text-muted-foreground', texto: 'text-foreground' },
};

/** Tom de uma mudança de status a partir do texto ("Aprovado"/"Reprovado"/"Reenvio…"). */
function tomStatus(texto: string | null): Tom {
  const s = (texto ?? '').toLowerCase();
  if (s.includes('reprov')) return 'reprovado';
  if (s.includes('reenvio') || s.includes('ajuste')) return 'reenvio';
  if (s.includes('descontinuad')) return 'area';
  if (s.includes('aprov')) return 'aprovado';
  return 'neutro';
}

function visualDe(a: Atividade): { Icon: LucideIcon; tom: Tom; rotuloAcao: string } {
  switch (a.acao) {
    case 'status': {
      const tom = tomStatus(a.detalhe);
      const Icon = tom === 'reprovado' ? XCircle : tom === 'aprovado' ? CheckCircle2 : RotateCcw;
      return { Icon, tom, rotuloAcao: 'Status' };
    }
    case 'estrelas':
      return { Icon: Star, tom: 'estrela', rotuloAcao: 'Estrelas' };
    case 'dono_area':
      return { Icon: Users, tom: 'area', rotuloAcao: 'Dono de área' };
    case 'lider_decisao':
      return { Icon: Gavel, tom: 'lider', rotuloAcao: 'Pré-aprovação' };
    case 'reabrir_fila':
      return { Icon: RotateCcw, tom: 'reabrir', rotuloAcao: 'Fila reaberta' };
    default:
      return { Icon: ClipboardCheck, tom: 'neutro', rotuloAcao: a.acao };
  }
}

/** Linha secundária opcional (motivo/comentário) a partir do meta. */
function detalheSecundario(a: Atividade): string | null {
  const m = a.meta ?? {};
  const motivo = (m.motivo ?? m.comentario) as unknown;
  return typeof motivo === 'string' && motivo.trim() ? motivo.trim() : null;
}

function ItemAtividade({ a }: { a: Atividade }) {
  const { Icon, tom, rotuloAcao } = visualDe(a);
  const classes = CLASSES_TOM[tom];
  const d = parseCarimbo(a.created_at);
  const secundario = detalheSecundario(a);
  return (
    <li className="flex gap-3 py-3">
      <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', classes.chip)}>
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-sm font-semibold', classes.texto)}>
            {rotuloAcao}
            {a.detalhe ? <span className="font-normal text-foreground"> · {a.detalhe}</span> : null}
          </span>
          {d ? (
            <time
              dateTime={d.toISOString()}
              title={dataHoraLonga(d)}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {horaCurta(d)}
            </time>
          ) : null}
        </div>
        {a.projeto_nome || a.projeto_id ? (
          <p className="truncate text-sm text-foreground/80" title={a.projeto_nome ?? a.projeto_id ?? ''}>
            {a.projeto_nome ?? a.projeto_id}
          </p>
        ) : null}
        {secundario ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{secundario}”</p>
        ) : null}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {nomeDeEmail(a.ator_email)}{' '}
          <span className="text-muted-foreground/70">· {a.ator_email}</span>
        </p>
      </div>
    </li>
  );
}

function agruparPorDia(itens: Atividade[]): { chave: string; itens: Atividade[] }[] {
  const grupos: { chave: string; itens: Atividade[] }[] = [];
  for (const a of itens) {
    const d = parseCarimbo(a.created_at);
    const chave = d ? chaveDia(d) : 'sem-data';
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.chave === chave) ultimo.itens.push(a);
    else grupos.push({ chave, itens: [a] });
  }
  return grupos;
}

export function HistoricoDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [itens, setItens] = useState<Atividade[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const jaCarregou = useRef(false);

  const carregar = useCallback(async (append: boolean, cursorAtual: string | null) => {
    if (append) setCarregandoMais(true);
    else setCarregando(true);
    setErro(null);
    try {
      const qs = cursorAtual ? `?cursor=${encodeURIComponent(cursorAtual)}` : '';
      const pag = await apiFetch<Pagina>(`/api/admin/atividades${qs}`);
      setItens((prev) => (append ? [...prev, ...pag.itens] : pag.itens));
      setCursor(pag.proximoCursor);
    } catch {
      setErro('Não foi possível carregar o histórico. Tente de novo.');
    } finally {
      setCarregando(false);
      setCarregandoMais(false);
    }
  }, []);

  // Carrega ao abrir (uma vez). Reabrir não recarrega — o botão Atualizar faz isso.
  useEffect(() => {
    if (open && !jaCarregou.current) {
      jaCarregou.current = true;
      void carregar(false, null);
    }
  }, [open, carregar]);

  const atualizar = useCallback(() => {
    setItens([]);
    setCursor(null);
    void carregar(false, null);
  }, [carregar]);

  const grupos = agruparPorDia(itens);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md gap-0 p-0">
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <div className="flex items-center gap-2">
            <History className="size-4 text-[var(--go-blue,#0059A9)]" aria-hidden />
            <SheetTitle>Histórico de ações</SheetTitle>
            <button
              type="button"
              onClick={atualizar}
              disabled={carregando}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', carregando && 'animate-spin')} aria-hidden />
              Atualizar
            </button>
          </div>
          <SheetDescription>
            Tudo que os validadores fizeram no painel — quem aprovou, reprovou, pediu reenvio,
            deu estrelas — mais recente primeiro.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Carregando…
            </div>
          ) : erro ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertTriangle className="size-6 text-amber-600" aria-hidden />
              <p className="text-sm text-muted-foreground">{erro}</p>
              <button
                type="button"
                onClick={atualizar}
                className="rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Tentar de novo
              </button>
            </div>
          ) : itens.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Inbox className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Nenhuma ação registrada ainda. Assim que alguém aprovar, reprovar ou pontuar um
                projeto, aparece aqui.
              </p>
            </div>
          ) : (
            <>
              {grupos.map((g) => (
                <section key={g.chave}>
                  <h3 className="sticky top-0 z-10 -mx-5 bg-background/95 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {g.chave === 'sem-data' ? 'Sem data' : rotuloDia(g.chave)}
                  </h3>
                  <ul className="divide-y">
                    {g.itens.map((a) => (
                      <ItemAtividade key={a.id} a={a} />
                    ))}
                  </ul>
                </section>
              ))}
              {cursor ? (
                <div className="py-4">
                  <button
                    type="button"
                    onClick={() => void carregar(true, cursor)}
                    disabled={carregandoMais}
                    className="flex w-full items-center justify-center gap-2 rounded-md border py-2 text-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    {carregandoMais ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Carregar mais
                  </button>
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">Fim do histórico.</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
