/**
 * Filtro pela NOTA da triagem (coluna "Estrelas") — pílula + painel ancorado.
 *
 * ## Por que só estrelas, sem campo de digitar
 * O painel já teve dois `<input type="number">` ("de __ até __") embaixo da fileira, para o
 * caso raro de querer um teto. Saíram (decisão do Luis, 18/08/2026): com as **10 estrelas da
 * escala** todas na tela (duas linhas de 5), elas sozinhas respondem a pergunta que a triagem
 * faz de verdade — "me mostre os de 3 ou mais" é um CLIQUE, não uma digitação —, e dois campos
 * de formulário no meio de uma barra de pílulas liam como configuração.
 *
 * As estrelas SÃO o controle: clicar na 3ª pede "3 ou mais", clicar de novo desfaz. As
 * duas pílulas cobrem as pontas ("Qualquer", "Sem nota" = a fila 0–0).
 *
 * ## EXATO é o PADRÃO (09/09/2026)
 * Clicar na estrela N devolve **só os de nota N**. Queixa do Luis: *"O toast que abre para eu
 * selecionar estrelas so mostre 1+, 2+, 3+. Nao consigo ver so o que é 1"* — e, na volta seguinte,
 * *"ao inves de clicar em 1 e ficar 1+ ficar so o que é projeto 1 e isso para todos"*. Então o
 * comportamento primário do clique mudou: era faixa aberta, agora é a nota exata.
 * O estado do filtro já sabia expressar isso desde sempre (`min === max`, que
 * `rotuloFaixaEstrelas` desenha como "1" e `descreverFaixaEstrelas` como "Exatamente 1 estrela").
 * ⚠️ **"ou mais" continua alcançável** pelo interruptor no topo do painel, porque "3 estrelas ou
 * mais" é pergunta real de triagem — só deixou de ser o que o clique faz por default.
 *
 * ⚠️ No modo exato a fileira acende **só a estrela escolhida**, não de 1 até ela: preencher 1..N
 * é o desenho universal de "N ou mais" e usá-lo para "exatamente N" faria a tela dizer o oposto do
 * recorte. O modo também aparece em TEXTO (o interruptor e a frase embaixo) — estado nunca só por
 * forma, nunca só por cor.
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

/** A escala da triagem: 10 estrelas, todas visíveis (o mesmo teto da ficha). */
const DEGRAUS = 10;

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

type Modo = 'ou_mais' | 'exato';

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
  // "Sem nota" é a fila 0–0 e não pode acender estrela nenhuma.
  const semNota = min === 0 && max === 0;
  // O modo nasce do que o filtro JÁ diz (uma faixa `min === max` só pode ter vindo do exato), então
  // reabrir o painel não perde a intenção de quem filtrou. O 0–0 fica de fora: ele é a pílula.
  // ⚠️ Nasce EXATO. Só cai em "ou mais" quando o filtro que chegou É uma faixa aberta
  // (`min` com `max` nulo) — reabrir o painel não pode trocar a intenção de quem já filtrou.
  const [modo, setModo] = useState<Modo>(min != null && max == null && min > 0 ? 'ou_mais' : 'exato');
  // A fileira reflete o piso da faixa; com só um teto ("até 3") vindo da URL, nada acende —
  // quem explica esse caso é a frase, não as estrelas.
  const base = min ?? 0;
  const aceso = previa ?? base;

  /** No exato, só a escolhida acende; no "ou mais", de 1 até ela (o desenho universal). */
  const acendeu = (n: number): boolean => {
    if (semNota) return false;
    if (modo === 'exato') return n === (previa ?? (min === max ? min : null));
    return n <= aceso;
  };
  const escolhidaAgora = (n: number): boolean =>
    modo === 'exato' ? min === n && max === n : min === n && max == null;

  return (
    <div className="w-[252px] p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: AZUL }}>
        Nota da triagem
      </p>

      {/* O interruptor do modo, em TEXTO. Trocar de modo re-aplica o recorte na hora quando já há
          uma estrela escolhida — senão a pessoa troca, não vê nada mudar e acha que não funcionou. */}
      <div role="group" aria-label="Como comparar a nota" className="mt-2 flex gap-1.5">
        {(['ou_mais', 'exato'] as Modo[]).map((m) => (
          <Atalho
            key={m}
            ativo={modo === m && !semNota}
            onClick={() => {
              setModo(m);
              const n = min;
              if (n != null && n > 0) onChange(n, m === 'exato' ? n : null);
            }}
          >
            {m === 'ou_mais' ? 'ou mais' : 'exatamente'}
          </Atalho>
        ))}
      </div>

      {/* As estrelas SÃO o filtro: cada uma pede "N ou mais". Clicar na mesma desfaz.
          Duas linhas de 5 (não 10 corridas): a quebra é o que faz a 8ª ser lida como 8. */}
      <div
        role="group"
        aria-label={modo === 'exato' ? 'Nota exata' : 'Nota mínima'}
        className="mt-2 grid w-max grid-cols-5 gap-1"
        onMouseLeave={() => setPrevia(null)}
      >
        {Array.from({ length: DEGRAUS }, (_, i) => i + 1).map((n) => {
          const cheia = acendeu(n);
          const escolhida = escolhidaAgora(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={escolhida}
              aria-label={
                modo === 'exato'
                  ? `Exatamente ${n} ${n === 1 ? 'estrela' : 'estrelas'}`
                  : `${n} ${n === 1 ? 'estrela' : 'estrelas'} ou mais`
              }
              onClick={() =>
                escolhida ? onChange(null, null) : onChange(n, modo === 'exato' ? n : null)
              }
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
        {previa != null
          ? descreverFaixaEstrelas(previa, modo === 'exato' ? previa : null)
          : descreverFaixaEstrelas(min, max)}
      </p>

      <div className="mt-3 flex gap-1.5">
        <Atalho ativo={min == null && max == null} onClick={() => onChange(null, null)}>
          Qualquer
        </Atalho>
        <Atalho ativo={semNota} onClick={() => onChange(0, 0)}>
          Sem nota (0)
        </Atalho>
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
