/**
 * Filtro pelas CATEGORIAS DE GANHO da v2 — pílula + painel ancorado, MULTI-seleção.
 *
 * ## Por que existe
 * Pedido do Luis (09/09/2026): *"quero ver custo evitado, saving efetivado, ganho imensuravel,
 * receita. E tem que ser diamico tb, e somar, posso selecionar 2 ao msm tempo e filtrar
 * devidamente."* O filtro de ganho que existia (`FiltroGanho`) é de ESCOLHA ÚNICA e fala da v1
 * ("com saving" × "com receita", pelo VALOR gravado); este fala das 4 categorias que o formulário
 * da v2 pede ao autor.
 *
 * ## O que ele é, e o que não é
 * ⚠️ **Checkbox, não radio.** Dentro da dimensão é OU (marcar duas devolve quem tem qualquer uma
 * das duas), e entre dimensões continua E, como todo filtro desta barra.
 * ⚠️ **Dinâmico de verdade**: a lista sai de `categoriasDisponiveis`, que conta sobre o RECORTE
 * atual ignorando a própria dimensão — a mesma régua das pílulas de status e do campo de
 * pré-status. Categoria com 0 no recorte não aparece; categoria MARCADA nunca desaparece (quem
 * marcou precisa poder desmarcar).
 * ⚠️ **O legado aparece com nome próprio.** 717 de 750 linhas de prod trazem vocabulário da v1
 * (`saving`, `especial`), e "saving" da v1 era um balde único que não separava saving efetivado de
 * custo evitado. Ele é listado como "Saving (v1, sem distinção)" em vez de ser empurrado para uma
 * categoria da v2 — a fila real fica visível, e é o número que diz quanto da base ainda precisa ser
 * reclassificada.
 *
 * ## Padrão da página
 * Reusa o `Popover` do calendário (posicionamento, Esc, clique fora) e o gatilho arredondado do
 * `SeletorPeriodo`: ativo = preenchido em `--go-blue` com o "×" embutido. Estado **nunca só por
 * cor** — cada linha tem caixa de check visível, rótulo e contagem.
 */
import { useRef, useState } from 'react';
import { Coins, X } from 'lucide-react';
import { Popover } from '@/components/calendario/calendario';
import {
  ROTULO_CATEGORIA_GANHO,
  rotuloCategorias,
  type CategoriaFiltroGanho,
} from '@/lib/dashboard-filtros';

const AZUL = 'var(--go-blue)';

export function FiltroCategorias({
  selecionadas,
  disponiveis,
  onChange,
}: {
  selecionadas: CategoriaFiltroGanho[];
  /** Categorias presentes no recorte, com a contagem — de `categoriasDisponiveis`. */
  disponiveis: { categoria: CategoriaFiltroGanho; total: number }[];
  onChange: (proximas: CategoriaFiltroGanho[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const gatilho = useRef<HTMLButtonElement>(null);

  const ativo = selecionadas.length > 0;
  const rotulo = rotuloCategorias(selecionadas);

  function fechar() {
    setAberto(false);
    gatilho.current?.focus();
  }

  function alternar(c: CategoriaFiltroGanho) {
    onChange(
      selecionadas.includes(c) ? selecionadas.filter((x) => x !== c) : [...selecionadas, c],
    );
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
          aria-label={
            ativo
              ? `Filtro de ganhos: ${selecionadas.map((c) => ROTULO_CATEGORIA_GANHO[c]).join(', ')}`
              : 'Filtrar por categoria de ganho'
          }
          className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none"
          style={{
            background: ativo ? AZUL : 'var(--card)',
            color: ativo ? '#fff' : 'var(--foreground)',
            borderColor: ativo ? AZUL : 'var(--border)',
            paddingRight: ativo ? 30 : undefined,
            ['--tw-ring-color' as string]: AZUL,
          }}
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          {rotulo}
        </button>
        {ativo && (
          <button
            type="button"
            onClick={() => onChange([])}
            aria-label="Limpar o filtro de ganhos"
            className="absolute right-1.5 rounded-full p-1 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
            style={{ color: '#fff' }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {aberto && (
        <Popover ancoraRef={gatilho} onFechar={fechar} rotulo="Filtrar por categoria de ganho">
          <div className="w-[286px] p-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.09em]" style={{ color: AZUL }}>
              Categorias de ganho
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Marque quantas quiser. Marcando duas, a lista traz quem tem qualquer uma delas.
            </p>

            <div role="group" aria-label="Categorias de ganho" className="mt-2.5 flex flex-col gap-0.5">
              {disponiveis.length === 0 && (
                <p className="py-2 text-[12px] text-muted-foreground">
                  Nenhuma categoria neste recorte.
                </p>
              )}
              {disponiveis.map(({ categoria, total }) => {
                const marcada = selecionadas.includes(categoria);
                return (
                  <label
                    key={categoria}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-black/[0.04] motion-reduce:transition-none"
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      onChange={() => alternar(categoria)}
                      className="h-3.5 w-3.5 shrink-0 rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                      style={{ accentColor: 'var(--go-blue)', ['--tw-ring-color' as string]: AZUL }}
                    />
                    <span
                      className="flex-1 text-[12.5px] leading-snug"
                      style={{
                        color: marcada ? AZUL : 'var(--foreground)',
                        fontWeight: marcada ? 600 : 400,
                      }}
                    >
                      {ROTULO_CATEGORIA_GANHO[categoria]}
                    </span>
                    {/* A contagem é do recorte: ela é o que impede a pílula dizer 8 e a lista abrir 2. */}
                    <span className="text-[11px] tabular-nums text-muted-foreground">{total}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
