/**
 * Calendário do GoDocs — uma grade, dois usos.
 *
 * Por que existe: o `<input type="date">` do navegador abre o calendário do sistema
 * operacional (cinza, em inglês em algumas máquinas, sem os atalhos de que a triagem
 * precisa) e **não sabe selecionar intervalo** — o padrão de duas caixas "de/para" custa
 * dois campos e um vai-e-vem para dizer uma coisa só. Aqui a janela inteira sai de UM mês
 * visível: 1º clique marca o início, 2º clique fecha o fim (em qualquer ordem — clicar
 * antes do início reancora), e os atalhos ("Hoje", "Últimos 7 dias"…) ficam ao lado da
 * grade, não escondidos num segundo menu.
 *
 * Onde é usado:
 * - `/dashboard` → `SeletorPeriodo` (intervalo, filtra "Data Submissão").
 * - Etapa 2 da submissão → `CampoData` (um dia só, substitui o `type="date"` nativo).
 *
 * A aritmética toda mora em `@/lib/calendario-datas` (pura, em UTC). Aqui só há
 * apresentação, posicionamento e teclado.
 *
 * Piso de acessibilidade: foco visível em tudo, `Esc` fecha e devolve o foco ao gatilho,
 * setas/PageUp/PageDown/Home/End andam pela grade (tabindex móvel — 42 paradas de Tab
 * seriam uma armadilha), estado do dia nunca é dito só por cor (há `aria-pressed` e
 * `aria-label` completo), e as transições respeitam `prefers-reduced-motion`.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  DIAS_SEMANA,
  PRESETS_PERIODO,
  contarDias,
  gradeDoMes,
  hojeIso,
  ordenarIntervalo,
  presetDoIntervalo,
  primeiroDiaDoMes,
  rotuloDiaBR,
  rotuloDiaCompleto,
  rotuloIntervalo,
  rotuloMes,
  somarDias,
  somarMeses,
  type DiaIso,
  type Intervalo,
} from '@/lib/calendario-datas';

const AZUL = 'var(--go-blue)';
/** Trilha do intervalo — o azul da marca a 9%: legível sem competir com as pontas. */
const TRILHA = 'rgba(0,89,169,0.10)';
const TRILHA_PREVIA = 'rgba(0,89,169,0.06)';

// ─── Grade ───────────────────────────────────────────────────────────────────

type GradeProps = {
  mes: DiaIso;
  /** Ponta(s) já escolhidas. No modo único, `inicio === fim`. */
  selecao: Intervalo | null;
  /** 1º clique pendente (modo intervalo): a grade pinta a prévia até o dia sob o cursor. */
  ancora: DiaIso | null;
  minimo?: DiaIso;
  maximo?: DiaIso;
  onEscolher: (iso: DiaIso) => void;
  onMudarMes: (mes: DiaIso) => void;
};

function Grade({ mes, selecao, ancora, minimo, maximo, onEscolher, onMudarMes }: GradeProps) {
  const hoje = hojeIso();
  const [sobreOCursor, setSobreOCursor] = useState<DiaIso | null>(null);
  const [focado, setFocado] = useState<DiaIso>(() => selecao?.inicio ?? primeiroDiaDoMes(mes));
  const celulas = useMemo(() => gradeDoMes(mes), [mes]);
  const botoes = useRef(new Map<DiaIso, HTMLButtonElement>());
  const precisaFocar = useRef(false);

  const bloqueado = useCallback(
    (iso: DiaIso) => (minimo && iso < minimo) || (maximo && iso > maximo),
    [minimo, maximo],
  );

  // Prévia do intervalo enquanto o 2º clique não veio: a faixa acompanha o cursor, então
  // dá para ver a janela antes de fechá-la.
  const faixa: Intervalo | null =
    ancora && sobreOCursor ? ordenarIntervalo(ancora, sobreOCursor) : (selecao ?? null);
  const previa = Boolean(ancora && sobreOCursor);

  /**
   * A ÚNICA parada de Tab da grade (tabindex móvel).
   *
   * ⚠️ Não pode ser `focado` cru: depois de trocar de mês pelas setas do cabeçalho, o dia
   * focado pertence a outro mês e NENHUM botão visível teria `tabIndex=0` — a grade ficaria
   * inalcançável pelo teclado. Mesma coisa quando o dia focado está fora do min/máx
   * (botão desabilitado não recebe foco). Nesses casos, a parada cai no primeiro dia
   * disponível do mês visível.
   */
  const paradaTab = useMemo(() => {
    const disponiveis = celulas.filter((c) => c.doMes && !bloqueado(c.iso));
    return disponiveis.find((c) => c.iso === focado)?.iso ?? disponiveis[0]?.iso ?? null;
  }, [celulas, focado, bloqueado]);

  useLayoutEffect(() => {
    if (!precisaFocar.current) return;
    precisaFocar.current = false;
    botoes.current.get(focado)?.focus();
  }, [focado, mes]);

  function andar(destino: DiaIso) {
    // Fora da janela permitida o botão está desabilitado e não aceita foco — mover para lá
    // deixaria o teclado preso num limbo. Fica onde está.
    if (bloqueado(destino)) return;
    precisaFocar.current = true;
    setFocado(destino);
    if (destino.slice(0, 7) !== mes.slice(0, 7)) onMudarMes(primeiroDiaDoMes(destino));
  }

  function aoTeclar(e: React.KeyboardEvent, iso: DiaIso) {
    const mapa: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (mapa[e.key] != null) {
      e.preventDefault();
      andar(somarDias(iso, mapa[e.key]));
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      andar(somarMeses(iso, e.key === 'PageUp' ? -1 : 1));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const diaSemana = new Date(`${iso}T00:00:00Z`).getUTCDay();
      andar(somarDias(iso, e.key === 'Home' ? -diaSemana : 6 - diaSemana));
    }
  }

  return (
    <div>
      <div
        className="grid px-1 pb-1"
        style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}
        aria-hidden
      >
        {DIAS_SEMANA.map((d, i) => (
          <div
            key={i}
            className="pb-1.5 text-center text-[10.5px] font-bold uppercase tracking-[0.08em]"
            style={{ color: '#9aa3ad' }}
          >
            {d}
          </div>
        ))}
      </div>
      <div
        role="grid"
        className="grid px-1"
        style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}
        onMouseLeave={() => setSobreOCursor(null)}
      >
        {celulas.map((c) => {
          if (!c.doMes) {
            // Dia de emenda: fica na grade para a semana não quebrar, mas não é alvo —
            // clicar num "31" que pertence a outro mês e ver a tela pular é desnorteante.
            return (
              <div
                key={c.iso}
                className="flex h-[38px] items-center justify-center text-[13px]"
                style={{ color: 'rgba(0,32,64,0.16)' }}
                aria-hidden
              >
                {c.dia}
              </div>
            );
          }
          const desabilitado = Boolean(bloqueado(c.iso));
          const naFaixa = faixa && c.iso >= faixa.inicio && c.iso <= faixa.fim;
          const ehInicio = faixa?.inicio === c.iso;
          const ehFim = faixa?.fim === c.iso;
          const ponta = ehInicio || ehFim;
          const ehHoje = c.iso === hoje;

          return (
            <div
              key={c.iso}
              role="gridcell"
              className="flex items-center justify-center"
              style={{
                background: naFaixa && !ponta ? (previa ? TRILHA_PREVIA : TRILHA) : undefined,
                // A trilha é contínua (sem gap entre células) e só as pontas arredondam —
                // é o que dá a leitura de "faixa", e não de 5 quadrados soltos.
                borderTopLeftRadius: ehInicio ? 10 : undefined,
                borderBottomLeftRadius: ehInicio ? 10 : undefined,
                borderTopRightRadius: ehFim ? 10 : undefined,
                borderBottomRightRadius: ehFim ? 10 : undefined,
              }}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) botoes.current.set(c.iso, el);
                  else botoes.current.delete(c.iso);
                }}
                disabled={desabilitado}
                tabIndex={c.iso === paradaTab ? 0 : -1}
                aria-pressed={Boolean(naFaixa)}
                aria-label={`${rotuloDiaCompleto(c.iso)}${ehHoje ? ' (hoje)' : ''}`}
                onClick={() => onEscolher(c.iso)}
                onMouseEnter={() => setSobreOCursor(c.iso)}
                onFocus={() => setFocado(c.iso)}
                onKeyDown={(e) => aoTeclar(e, c.iso)}
                className="relative flex h-[38px] w-full items-center justify-center text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed motion-reduce:transition-none"
                style={{
                  borderRadius: ponta ? 10 : naFaixa ? 0 : 9,
                  background: ponta ? AZUL : 'transparent',
                  color: ponta
                    ? '#fff'
                    : desabilitado
                      ? 'rgba(0,32,64,0.28)'
                      : 'var(--go-text-primary, #1b2733)',
                  fontWeight: ponta || ehHoje ? 700 : 500,
                  ['--tw-ring-color' as string]: AZUL,
                }}
              >
                {c.dia}
                {/* "Hoje" é marcado por um ponto, não só por peso da fonte: dentro da
                    faixa azul o negrito sozinho desaparece. */}
                {ehHoje && (
                  <span
                    aria-hidden
                    className="absolute bottom-[5px] h-[3px] w-[3px] rounded-full"
                    style={{ background: ponta ? 'var(--go-lime)' : AZUL }}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Painel (cabeçalho + grade + atalhos + rodapé) ───────────────────────────

function BotaoMes({
  children,
  rotulo,
  onClick,
}: {
  children: React.ReactNode;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[rgba(0,89,169,0.08)] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{ color: AZUL, ['--tw-ring-color' as string]: AZUL }}
    >
      {children}
    </button>
  );
}

type PainelProps = {
  modo: 'unico' | 'intervalo';
  selecao: Intervalo | null;
  minimo?: DiaIso;
  maximo?: DiaIso;
  onAplicar: (valor: Intervalo | null) => void;
  onFechar: () => void;
};

function Painel({ modo, selecao, minimo, maximo, onAplicar, onFechar }: PainelProps) {
  const hoje = hojeIso();
  const [mes, setMes] = useState<DiaIso>(() => primeiroDiaDoMes(selecao?.fim ?? hoje));
  const [ancora, setAncora] = useState<DiaIso | null>(null);
  const presetAtivo = presetDoIntervalo(selecao, hoje);

  function escolher(iso: DiaIso) {
    if (modo === 'unico') {
      onAplicar({ inicio: iso, fim: iso });
      onFechar();
      return;
    }
    if (!ancora) {
      // 1º clique: a janela vira um dia só e espera o fechamento.
      setAncora(iso);
      onAplicar({ inicio: iso, fim: iso });
      return;
    }
    onAplicar(ordenarIntervalo(ancora, iso));
    setAncora(null);
    onFechar();
  }

  const resumo = selecao
    ? modo === 'unico'
      ? rotuloDiaBR(selecao.inicio)
      : `${rotuloIntervalo(selecao)} · ${contarDias(selecao)} ${contarDias(selecao) === 1 ? 'dia' : 'dias'}`
    : null;

  return (
    <div className="flex flex-col sm:flex-row">
      {modo === 'intervalo' && (
        <div
          className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b p-2 sm:w-[152px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r"
          style={{ borderColor: 'rgba(0,89,169,0.12)' }}
        >
          {PRESETS_PERIODO.map((p) => {
            const ativo = presetAtivo === p.chave;
            return (
              <button
                key={p.chave}
                type="button"
                aria-pressed={ativo}
                onClick={() => {
                  const i = p.intervalo(hoje);
                  onAplicar(i);
                  setMes(primeiroDiaDoMes(i.fim));
                  setAncora(null);
                }}
                className="whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[rgba(0,89,169,0.07)] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                style={{
                  background: ativo ? 'rgba(0,89,169,0.10)' : 'transparent',
                  color: ativo ? AZUL : 'var(--go-text-primary, #1b2733)',
                  fontWeight: ativo ? 700 : 500,
                  ['--tw-ring-color' as string]: AZUL,
                }}
              >
                {p.rotulo}
              </button>
            );
          })}
        </div>
      )}

      <div className="p-2 sm:p-2.5">
        <div className="mb-1 flex items-center justify-between px-1">
          <BotaoMes rotulo="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </BotaoMes>
          <div
            aria-live="polite"
            className="text-[14px] font-bold tracking-tight"
            style={{ color: AZUL }}
          >
            {rotuloMes(mes)}
          </div>
          <BotaoMes rotulo="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>
            <ChevronRight className="h-4 w-4" />
          </BotaoMes>
        </div>

        <Grade
          mes={mes}
          selecao={selecao}
          ancora={ancora}
          minimo={minimo}
          maximo={maximo}
          onEscolher={escolher}
          onMudarMes={setMes}
        />

        <div
          className="mt-1.5 flex items-center justify-between gap-3 border-t px-1.5 pt-2"
          style={{ borderColor: 'rgba(0,89,169,0.12)' }}
        >
          <p className="text-[11.5px]" style={{ color: resumo ? '#5b6672' : '#9aa3ad' }}>
            {resumo ??
              (modo === 'intervalo'
                ? 'Clique no primeiro e no último dia.'
                : 'Escolha o dia.')}
          </p>
          <div className="flex items-center gap-1">
            {modo === 'unico' && (!maximo || maximo >= hoje) && (
              <button
                type="button"
                onClick={() => {
                  onAplicar({ inicio: hoje, fim: hoje });
                  onFechar();
                }}
                className="rounded-lg px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[rgba(0,89,169,0.08)] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                style={{ color: AZUL, ['--tw-ring-color' as string]: AZUL }}
              >
                Hoje
              </button>
            )}
            {selecao && (
              <button
                type="button"
                onClick={() => {
                  onAplicar(null);
                  setAncora(null);
                  onFechar();
                }}
                className="rounded-lg px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-[rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                style={{ color: '#5b6672' }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Popover ancorado ────────────────────────────────────────────────────────

/**
 * Caixa flutuante presa ao gatilho. Vai por PORTAL (como o `InfoTooltip` da submissão):
 * dentro do fluxo, qualquer ancestral com `overflow` cortaria o calendário — e o campo da
 * Etapa 2 vive dentro de um cartão com rolagem.
 *
 * ⚠️ Não é modal e não cobre a tela: a triagem precisa continuar vendo a lista que está
 * filtrando enquanto escolhe a janela.
 */
/**
 * Painel ancorado ao gatilho, em portal — não é modal (não cobre a lista que está sendo
 * filtrada), fecha no Esc e no clique fora, e vira para cima quando não cabe embaixo.
 *
 * ⚠️ **Exportado de propósito**: o filtro de estrelas do `/dashboard`
 * (`components/dashboard/filtro-estrelas.tsx`) usa ESTE painel. Um segundo popover na mesma
 * barra de filtros abriria diferente, fecharia diferente e posicionaria diferente — é uma
 * duplicação que se paga em bug, não em código.
 */
export function Popover({
  ancoraRef,
  onFechar,
  rotulo,
  children,
}: {
  ancoraRef: React.RefObject<HTMLElement | null>;
  onFechar: () => void;
  rotulo: string;
  children: React.ReactNode;
}) {
  const painelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function posicionar() {
      const alvo = ancoraRef.current?.getBoundingClientRect();
      const caixa = painelRef.current?.getBoundingClientRect();
      if (!alvo || !caixa) return;
      const margem = 10;
      let left = Math.min(alvo.left, window.innerWidth - caixa.width - margem);
      left = Math.max(margem, left);
      let top = alvo.bottom + 8;
      // Vira para cima quando não cabe embaixo — mas só se couber em cima.
      if (top + caixa.height > window.innerHeight - margem && alvo.top - caixa.height - 8 > margem) {
        top = alvo.top - caixa.height - 8;
      }
      setPos({ top, left });
    }
    posicionar();
    window.addEventListener('resize', posicionar);
    window.addEventListener('scroll', posicionar, true);
    return () => {
      window.removeEventListener('resize', posicionar);
      window.removeEventListener('scroll', posicionar, true);
    };
  }, [ancoraRef]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFechar();
      }
    }
    function aoClicar(e: MouseEvent) {
      const alvo = e.target as Node;
      if (painelRef.current?.contains(alvo) || ancoraRef.current?.contains(alvo)) return;
      onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    document.addEventListener('mousedown', aoClicar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('mousedown', aoClicar);
    };
  }, [onFechar, ancoraRef]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={painelRef}
      role="dialog"
      aria-label={rotulo}
      className="fixed z-[70] overflow-hidden border shadow-[0_16px_40px_rgba(0,32,64,0.16)]"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        // Enquanto a medida não chega, o painel existe (para ser medido) mas não pisca
        // no canto da tela.
        visibility: pos ? 'visible' : 'hidden',
        background: 'var(--go-white, #fff)',
        borderColor: 'rgba(0,89,169,0.16)',
        borderRadius: 14,
        animation: 'go-slide-down 0.14s ease',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ─── Uso 1: filtro de período (/dashboard) ───────────────────────────────────

export function SeletorPeriodo({
  valor,
  onChange,
  maximo,
}: {
  valor: Intervalo | null;
  onChange: (v: Intervalo | null) => void;
  maximo?: DiaIso;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);

  function fechar() {
    setAberto(false);
    gatilho.current?.focus();
  }

  const ativo = Boolean(valor);
  const rotulo = valor ? rotuloIntervalo(valor) : 'Período';

  return (
    <>
      <div className="relative inline-flex items-center">
        <button
          ref={gatilho}
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          aria-haspopup="dialog"
          className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
          style={{
            background: ativo ? AZUL : 'var(--card)',
            color: ativo ? '#fff' : 'var(--foreground)',
            borderColor: ativo ? AZUL : 'var(--border)',
            paddingRight: ativo ? 30 : undefined,
            ['--tw-ring-color' as string]: AZUL,
          }}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {rotulo}
        </button>
        {ativo && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Limpar período"
            className="absolute right-1.5 rounded-full p-1 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
            style={{ color: '#fff' }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {aberto && (
        <Popover ancoraRef={gatilho} onFechar={fechar} rotulo="Escolher período">
          <Painel
            modo="intervalo"
            selecao={valor}
            maximo={maximo}
            onAplicar={onChange}
            onFechar={fechar}
          />
        </Popover>
      )}
    </>
  );
}

// ─── Uso 2: campo de data única (Etapa 2 da submissão) ───────────────────────

export function CampoData({
  valor,
  onChange,
  minimo,
  maximo,
  erro,
  placeholder = 'Selecione a data',
  ariaLabel,
}: {
  /** `YYYY-MM-DD` — o mesmo formato do `type="date"` que este campo substitui. */
  valor: string;
  onChange: (iso: string) => void;
  minimo?: DiaIso;
  maximo?: DiaIso;
  erro?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);
  const selecao = valor ? { inicio: valor, fim: valor } : null;

  function fechar() {
    setAberto(false);
    gatilho.current?.focus();
  }

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={`go-input flex w-full items-center justify-between text-left ${erro ? 'go-input-invalid' : ''}`}
        style={{ cursor: 'pointer' }}
      >
        <span style={{ color: valor ? 'var(--go-text-heading)' : '#9aa3ad' }}>
          {valor ? rotuloDiaBR(valor) : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 shrink-0" style={{ color: AZUL }} aria-hidden />
      </button>
      {aberto && (
        <Popover ancoraRef={gatilho} onFechar={fechar} rotulo="Escolher data">
          <Painel
            modo="unico"
            selecao={selecao}
            minimo={minimo}
            maximo={maximo}
            onAplicar={(v) => onChange(v ? v.inicio : '')}
            onFechar={fechar}
          />
        </Popover>
      )}
    </>
  );
}
