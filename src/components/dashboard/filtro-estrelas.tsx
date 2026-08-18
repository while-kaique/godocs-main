/**
 * Filtro pela NOTA da triagem (coluna "Estrelas") — pílula + painel ancorado.
 *
 * ## Por que não são dois campos numéricos na barra
 * A 1ª versão punha dois `<input type="number">` crus dentro de uma pílula: funcionava e lia
 * como formulário de configuração no meio de uma barra que, no resto, fala por **pílulas e
 * trilhos** (`Segmentado`, `SeletorPeriodo`). Dois campos de digitação também são o gesto
 * errado para o caso comum — "me mostre os de 3 ou mais" é um CLIQUE, não uma digitação.
 *
 * Aqui a fileira de estrelas É o controle: clicar na 3ª estrela pede "3 ou mais", clicar de
 * novo desfaz. A faixa exata (de/até) fica embaixo, para o caso raro de querer um teto — e é
 * ela que preserva a escala ABERTA (nota 8, 10) que a ficha permite dar.
 *
 * ## Padrão da página
 * Reusa o `Popover` do calendário (mesmo posicionamento, Esc, clique fora) e o mesmo gatilho
 * arredondado do `SeletorPeriodo`: ativo = preenchido em `--go-blue` com o "×" embutido.
 * Estado **nunca só por cor** — a pílula diz a faixa em texto ("3+", "2–4", "Sem nota") e o
 * painel repete em frase.
 */
import { useRef, useState } from 'react';
import { Star, X } from 'lucide-react';
import { Popover } from '@/components/calendario/calendario';
import { descreverFaixaEstrelas, rotuloFaixaEstrelas } from '@/lib/dashboard-filtros';

const AZUL = 'var(--go-blue)';
/** Ouro das estrelas — o mesmo par da ficha de triagem e da célula da tabela. */
const OURO = '#f5c518';
const OURO_BORDA = '#e0a800';

/** Quantas estrelas a fileira do painel oferece. Não é teto da escala (ver a ficha). */
const DEGRAUS = 5;

export function FiltroEstrelas({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);

  const ativo = min != null || max != null;
  const rotulo = rotuloFaixaEstrelas(min, max);

  function fechar() {
    setAberto(false);
    gatilho.current?.focus();
  }

  return (
    <>
      <div className="relative inline-flex items-center">
        <button
          ref={gatilho}
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          aria-haspopup="dialog"
          aria-label={ativo ? `Filtro de estrelas: ${descreverFaixaEstrelas(min, max)}` : 'Filtrar por estrelas'}
          className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
          style={{
            background: ativo ? AZUL : 'var(--card)',
            color: ativo ? '#fff' : 'var(--foreground)',
            borderColor: ativo ? AZUL : 'var(--border)',
            paddingRight: ativo ? 30 : undefined,
            ['--tw-ring-color' as string]: AZUL,
          }}
        >
          <Star
            className="h-3.5 w-3.5"
            style={{ color: ativo ? '#fff' : OURO_BORDA }}
            fill={ativo ? '#fff' : OURO}
            aria-hidden
          />
          {rotulo}
        </button>
        {ativo && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            aria-label="Limpar o filtro de estrelas"
            className="absolute right-1.5 rounded-full p-1 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
            style={{ color: '#fff' }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {aberto && (
        <Popover ancoraRef={gatilho} onFechar={fechar} rotulo="Filtrar por estrelas">
          <Painel min={min} max={max} onChange={onChange} />
        </Popover>
      )}
    </>
  );
}

function Painel({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const [previa, setPrevia] = useState<number | null>(null);
  // A fileira reflete o piso da faixa; com só um teto ("até 3"), nada acende — o teto é o
  // caso raro e quem o explica é a frase, não as estrelas.
  const base = min ?? 0;
  const aceso = previa ?? base;
  // "Sem nota" é a fila 0–0 e não pode acender estrela nenhuma.
  const semNota = min === 0 && max === 0;

  const ler = (v: string): number | null => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  return (
    <div className="w-[252px] p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: AZUL }}>
        Nota da triagem
      </p>

      {/* A fileira É o filtro: cada estrela pede "N ou mais". Clicar na mesma desfaz. */}
      <div
        role="group"
        aria-label="Nota mínima"
        className="mt-2 flex items-center gap-1"
        onMouseLeave={() => setPrevia(null)}
      >
        {Array.from({ length: DEGRAUS }, (_, i) => i + 1).map((n) => {
          const cheia = !semNota && n <= aceso;
          const escolhida = min === n && max == null;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={escolhida}
              aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'} ou mais`}
              onClick={() => onChange(escolhida ? null : n, null)}
              onMouseEnter={() => setPrevia(n)}
              onFocus={() => setPrevia(n)}
              onBlur={() => setPrevia(null)}
              className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{ ['--tw-ring-color' as string]: AZUL }}
            >
              <Star
                className="h-6 w-6"
                style={{ color: cheia ? OURO_BORDA : 'var(--muted-foreground)', opacity: cheia ? 1 : 0.4 }}
                fill={cheia ? OURO : 'none'}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[12px] leading-snug text-muted-foreground" aria-live="polite">
        {descreverFaixaEstrelas(previa != null ? previa : min, previa != null ? null : max)}
      </p>

      <div className="mt-3 flex gap-1.5">
        <Atalho ativo={min == null && max == null} onClick={() => onChange(null, null)}>
          Qualquer
        </Atalho>
        <Atalho ativo={semNota} onClick={() => onChange(0, 0)}>
          Sem nota
        </Atalho>
      </div>

      <div className="mt-3.5 border-t pt-3" style={{ borderColor: 'rgba(0,89,169,0.12)' }}>
        <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          Faixa exata
        </p>
        {/* Escala aberta: aqui é onde se pede "6 a 10". Campo vazio = ponta aberta. */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          de
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="—"
            aria-label="Nota mínima da faixa"
            value={min ?? ''}
            onChange={(e) => onChange(ler(e.target.value), max)}
            className="go-nota-campo"
          />
          até
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="—"
            aria-label="Nota máxima da faixa"
            value={max ?? ''}
            onChange={(e) => onChange(min, ler(e.target.value))}
            className="go-nota-campo"
          />
        </div>
      </div>
    </div>
  );
}

function Atalho({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className="inline-flex h-7 items-center rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{
        background: ativo ? 'rgba(0,89,169,0.09)' : 'transparent',
        borderColor: ativo ? AZUL : 'var(--border)',
        color: ativo ? AZUL : 'var(--muted-foreground)',
        ['--tw-ring-color' as string]: AZUL,
      }}
    >
      {children}
    </button>
  );
}
