/**
 * Painel de AGLUTINAÇÃO (item 5.3) — onde a sugestão "X é feature de Y" vira decisão.
 *
 * O agente PERCEBE e INDICA; aqui alguém confirma. Só o aceite escreve o vínculo
 * (`ID Pai`/`ID Feature`) na planilha — ver `src/lib/aglutinacao.functions.ts`.
 *
 * ⚠️ Design: a tela ADAPTA a linguagem das irmãs (`/especiais`, `/aprovacoes-pendentes`) —
 * mesmo cabeçalho, mesmas pílulas, mesma `ProjetoDetalheDialog`. O que ela acrescenta é a
 * forma do PAR: a sugestão é uma AFIRMAÇÃO, não dois cartões neutros lado a lado. A direção
 * ("quem é o pai") é a informação que se está validando, então ela é a frase — filho, o
 * verbo, pai — e não um detalhe dentro de dois blocos simétricos. Dois cards iguais fariam
 * o leitor procurar a seta; a frase entrega a alegação de uma vez.
 *
 * ⚠️ Estado nunca só por cor (piso de a11y do repo): cada chip leva ícone + rótulo textual.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X, Link2, Loader2, RefreshCw, Search, AlertTriangle, CornerDownRight, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HistoricoButton } from '@/components/historico/historico-button';
import { apiFetch } from '@/lib/api-client';
import { useTituloPagina } from '@/lib/use-titulo-pagina';
import { SECAO } from '@/lib/titulo-pagina';

type Sugestao = {
  filhoId: string;
  filhoNome: string;
  paiId: string;
  paiNome: string;
  similaridade: number;
  confianca: number | null;
  justificativa: string | null;
  porque: string;
  estado: string;
  decididoPor: string | null;
};

/**
 * Faixa de confiança → rótulo + tom. Três faixas, não um número solto: "0,74" não diz a
 * ninguém se deve olhar com atenção, e é isso que a triagem precisa saber ao escanear.
 */
function faixaConfianca(c: number | null): { rotulo: string; classe: string } {
  if (c == null) return { rotulo: 'sem confiança', classe: 'bg-muted text-muted-foreground' };
  if (c >= 0.9) return { rotulo: 'confiança alta', classe: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' };
  if (c >= 0.75) return { rotulo: 'confiança média', classe: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' };
  return { rotulo: 'confiança baixa', classe: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' };
}

function CartaoSugestao({
  s,
  gravando,
  onDecidir,
}: {
  s: Sugestao;
  gravando: boolean;
  onDecidir: (aceitar: boolean) => void;
}) {
  const faixa = faixaConfianca(s.confianca);
  const decidido = s.estado !== 'sugerido';
  return (
    <li
      className={`rounded-lg border bg-card p-4 transition-opacity ${decidido ? 'opacity-60' : ''}`}
      style={{ borderColor: decidido ? undefined : 'var(--go-blue)', borderLeftWidth: decidido ? 1 : 3 }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${faixa.classe}`}>{faixa.rotulo}</span>
        {s.porque ? (
          <span className="text-muted-foreground">
            casou por <span className="font-medium text-foreground">{s.porque}</span>
          </span>
        ) : null}
        {decidido ? (
          <span className="ml-auto inline-flex items-center gap-1 font-medium">
            {s.estado === 'aceito' ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden /> vínculo confirmado
              </>
            ) : (
              <>
                <X className="h-3.5 w-3.5" aria-hidden /> marcado como projeto próprio
              </>
            )}
          </span>
        ) : null}
      </div>

      {/* A alegação. O filho vem primeiro porque é ele que está sendo reclassificado. */}
      <div className="space-y-1">
        {/* Abre a ficha que JÁ existe — o deep-link `?projeto=` do /dashboard. Duplicar o
            overlay aqui seria uma segunda ficha para manter. */}
        <a
          href={`/dashboard?projeto=${encodeURIComponent(s.filhoId)}`}
          target="_blank"
          rel="noreferrer"
          className="block text-[15px] font-semibold leading-snug hover:underline"
        >
          {s.filhoNome}
        </a>
        <div className="flex items-start gap-1.5 pl-1 text-[13px] text-muted-foreground">
          <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            é uma feature de{' '}
            <a
              href={`/dashboard?projeto=${encodeURIComponent(s.paiId)}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-foreground hover:underline"
            >
              {s.paiNome}
            </a>
          </span>
        </div>
      </div>

      {s.justificativa ? (
        <p className="mt-3 border-l-2 pl-3 text-[12.5px] leading-relaxed text-muted-foreground" style={{ borderColor: 'var(--go-lime)' }}>
          {s.justificativa}
        </p>
      ) : null}

      {!decidido ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecidir(true)} disabled={gravando}>
            {gravando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Confirmar vínculo
          </Button>
          <Button size="sm" variant="outline" onClick={() => onDecidir(false)} disabled={gravando}>
            <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Não é feature
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Pares julgados por requisição. PEQUENO de propósito: cada lote é uma atualização de tela,
 * e um lote grande vira silêncio longo. 4 pares ≈ 10s — perto do limite do que se espera sem
 * notícia. (O teto de duração da requisição continua sendo o motivo de haver lotes; o
 * TAMANHO é escolhido pelo ritmo da informação.)
 */
const TAMANHO_LOTE = 4;
/** Teto de voltas — um freio contra laço infinito se o servidor parar de avançar o cursor. */
const MAX_LOTES = 120;

type LinhaLog = { filho: string; pai: string; desfecho: 'sugerido' | 'descartado' | 'falhou'; confianca?: number };

/** "2 min 10 s". Sem casas: aqui o número é para calibrar a espera, não para cronometrar. */
function duracao(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

function AglutinacaoPage() {
  useTituloPagina(SECAO.aglutinacao);
  const [itens, setItens] = useState<Sugestao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gravandoId, setGravandoId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [verDecididos, setVerDecididos] = useState(false);
  const [varrendo, setVarrendo] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [log, setLog] = useState<LinhaLog[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiFetch<{ itens: Sugestao[] }>('/api/admin/aglutinacao');
      setItens(r.itens ?? []);
    } catch (e) {
      setErro((e as Error)?.message ?? 'não deu para carregar as sugestões');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Dispara a varredura. Sem este botão o painel é uma tela morta: as sugestões nascem da
   * rota, e não havia caminho para chamá-la pela interface.
   *
   * ⚠️ Manda `dry: false` — nesta tela o propósito É gravar. O `dry` continua sendo o default
   * da ROTA, para quem a chama por fora (script, cron) não gravar sem querer.
   */
  const varrer = useCallback(async () => {
    setVarrendo(true);
    setErro(null);
    setResultado(null);
    setLog([]);
    const t0 = Date.now();
    try {
      // ── Fase 1: os pares candidatos, SEM LLM. ────────────────────────────────
      // É determinística e rápida, e é ela que dá o denominador: sem isto a pessoa
      // olha para "Procurando…" sem saber se são 3 pares ou 300, nem quanto vai durar.
      setProgresso('Comparando os projetos para achar os pares candidatos…');
      const fase1 = await apiFetch<{
        projetos: number;
        pares_unicos: number;
        com_candidatos: number;
        com_vetor: number;
        julgar_pares: Array<{ filhoId: string; paiIds: string[] }>;
      }>('/api/admin/aglutinacao/varredura', {
        method: 'POST',
        body: JSON.stringify({ somente_pares: true }),
      });
      const pares = fase1.julgar_pares ?? [];
      const total = pares.length || fase1.com_candidatos;
      setProgresso(
        `${fase1.pares_unicos} pares candidatos entre ${fase1.projetos} projetos` +
          (fase1.com_vetor ? ` · ${fase1.com_vetor} com vetor` : ' · sem vetores (só léxico)') +
          ` — pedindo o parecer do agente para ${total}…`,
      );
      if (total === 0) {
        setResultado(`Nenhum par candidato entre ${fase1.projetos} projetos.`);
        return;
      }

      // ── Fase 2: julgar em lotes, mostrando cada par assim que sai. ────────────
      let pular = 0;
      let julgados = 0;
      let sugestoes = 0;
      let falhas = 0;
      for (let volta = 0; volta < MAX_LOTES; volta++) {
        const r = await apiFetch<{
          julgados: number;
          falhas: number;
          restantes: number;
          proximo_pular: number;
          sugestoes: unknown[];
          detalhe: LinhaLog[];
        }>('/api/admin/aglutinacao/varredura', {
          method: 'POST',
          // ⚠️ Manda os pares JÁ escolhidos na fase 1: sem isso cada lote refaria a
          // recuperação e releria ~11 MB de vetores — 30 vezes.
          body: JSON.stringify({
            dry: false,
            julgar_pares: pares.slice(pular, pular + TAMANHO_LOTE),
          }),
        });
        julgados += r.julgados;
        sugestoes += r.sugestoes?.length ?? 0;
        falhas += r.falhas ?? 0;
        pular += r.julgados;
        const restantes = Math.max(0, total - pular);
        setLog((atual) => [...(r.detalhe ?? []).reverse(), ...atual]);
        // ETA medida no próprio ritmo desta corrida — não uma constante chutada.
        const porPar = (Date.now() - t0) / Math.max(1, julgados);
        setProgresso(
          `${julgados} de ${total} analisados · ${sugestoes} ${sugestoes === 1 ? 'sugestão' : 'sugestões'}` +
            (restantes ? ` · faltam ~${duracao(restantes * porPar)}` : ''),
        );
        if (r.sugestoes?.length) await carregar();
        if (restantes === 0 || r.julgados === 0) break;
      }
      await carregar();
      // ⚠️ As falhas aparecem SEMPRE que existem: uma rajada de erro do proxy não pode se
      // parecer com "não achei nada".
      setResultado(
        `${sugestoes} ${sugestoes === 1 ? 'sugestão' : 'sugestões'} em ${julgados} pares · ${duracao(Date.now() - t0)}` +
          (falhas ? ` · ⚠️ ${falhas} não foram analisados (falha na chamada)` : ''),
      );
    } catch (e) {
      setErro((e as Error)?.message ?? 'a varredura não completou');
    } finally {
      setVarrendo(false);
      setProgresso(null);
    }
  }, [carregar]);

  const decidir = useCallback(async (s: Sugestao, aceitar: boolean) => {
    const chave = `${s.filhoId}>${s.paiId}`;
    setGravandoId(chave);
    try {
      await apiFetch('/api/admin/aglutinacao/decidir', {
        method: 'POST',
        body: JSON.stringify({ filhoId: s.filhoId, paiId: s.paiId, aceitar }),
      });
      setItens((atual) =>
        atual.map((x) =>
          x.filhoId === s.filhoId && x.paiId === s.paiId
            ? { ...x, estado: aceitar ? 'aceito' : 'rejeitado' }
            : x,
        ),
      );
    } catch (e) {
      setErro((e as Error)?.message ?? 'não deu para gravar a decisão');
    } finally {
      setGravandoId(null);
    }
  }, []);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return itens
      .filter((s) => (verDecididos ? true : s.estado === 'sugerido'))
      .filter((s) => !t || `${s.filhoNome} ${s.paiNome}`.toLowerCase().includes(t));
  }, [itens, busca, verDecididos]);

  const pendentes = itens.filter((s) => s.estado === 'sugerido').length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[22px] font-semibold leading-tight">Aglutinação</h1>
          <p className="text-[12.5px] text-muted-foreground">
            {pendentes === 0
              ? 'Nada esperando decisão.'
              : `${pendentes} ${pendentes === 1 ? 'sugestão' : 'sugestões'} para revisar. Confirmar grava o vínculo na planilha.`}
          </p>
        </div>
        <HistoricoButton />
        <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={carregando || varrendo}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${carregando ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar
        </Button>
        <Button size="sm" onClick={() => void varrer()} disabled={varrendo}>
          {varrendo ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Radar className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {varrendo ? 'Procurando…' : 'Procurar features'}
        </Button>
      </header>

      {varrendo || log.length ? (
        <div className="mb-4 rounded-md border bg-muted/30 p-3">
          <p className="text-[12.5px] font-medium">
            {progresso ?? 'Comparando os projetos…'}
          </p>
          {log.length ? (
            <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto pr-1 font-mono text-[11.5px] leading-relaxed">
              {log.map((l, i) => (
                <li key={`${l.filho}-${i}`} className="flex gap-1.5">
                  <span
                    aria-hidden
                    className={
                      l.desfecho === 'sugerido'
                        ? 'text-emerald-700'
                        : l.desfecho === 'falhou'
                          ? 'text-amber-700'
                          : 'text-muted-foreground'
                    }
                  >
                    {l.desfecho === 'sugerido' ? '✓' : l.desfecho === 'falhou' ? '⚠' : '·'}
                  </span>
                  <span className="truncate">
                    <span className={l.desfecho === 'sugerido' ? 'font-medium' : 'text-muted-foreground'}>
                      {l.filho}
                    </span>
                    {/* Estado nunca só por cor: o desfecho vai por extenso, não só no ícone. */}
                    {l.desfecho === 'sugerido' ? (
                      <span className="text-emerald-700"> → é feature de {l.pai}</span>
                    ) : l.desfecho === 'falhou' ? (
                      <span className="text-amber-700"> → não foi analisado</span>
                    ) : (
                      <span className="text-muted-foreground"> → projeto próprio</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {resultado ? (
        <p className="mb-4 rounded-md border p-3 text-[12.5px]" style={{ borderColor: 'var(--go-lime)' }}>
          {resultado}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            className="go-input w-full pl-8 text-[13px]"
            placeholder="Buscar por nome de projeto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button size="sm" variant={verDecididos ? 'default' : 'outline'} onClick={() => setVerDecididos((v) => !v)}>
          {verDecididos ? 'Mostrando decididas' : 'Ver decididas'}
        </Button>
      </div>

      {erro ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12.5px]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span>{erro}</span>
        </div>
      ) : null}

      {carregando ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">Carregando as sugestões…</p>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-[14px] font-medium">Nenhuma sugestão para revisar</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Use <span className="font-medium">Procurar features</span> para varrer a base atrás de
            projetos registrados por engano como próprios.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visiveis.map((s) => (
            <CartaoSugestao
              key={`${s.filhoId}>${s.paiId}`}
              s={s}
              gravando={gravandoId === `${s.filhoId}>${s.paiId}`}
              onDecidir={(aceitar) => void decidir(s, aceitar)}
            />
          ))}
        </ul>
      )}

    </div>
  );
}

export const Route = createFileRoute('/_authenticated/aglutinacao')({
  component: AglutinacaoPage,
});
