/**
 * Linhas-fantasma da tabela de triagem.
 *
 * Por que existe: a leitura da planilha custa ~2 s e a tela mostrava um spinner centrado
 * ("Lendo a planilha…"), que apaga a estrutura e faz a espera parecer maior. As linhas
 * fantasma mantêm a página com a mesma silhueta que ela terá quando os dados chegarem —
 * inclusive a régua de status na borda esquerda e a linha do ID em monoespaçada — então a
 * busca e as filas continuam usáveis enquanto a lista preenche.
 *
 * Deliberadamente NÃO usa a cor de nenhum status na régua fantasma: enquanto não se sabe
 * o status, pintar de azul/verde insinuaria uma fila que talvez não exista.
 *
 * A11y: o bloco é `aria-hidden` (é enfeite) e a tela anuncia o carregamento por texto
 * via `aria-live` no rodapé; a animação respeita `prefers-reduced-motion`.
 */

/** Larguras fixas (não aleatórias) para as linhas não virarem um tabuleiro. */
const LARGURAS = ['72%', '58%', '84%', '64%', '78%', '52%', '68%'] as const;

function Barra({ largura, className = '' }: { largura: string; className?: string }) {
  return (
    <span
      className={`block h-3 rounded-full bg-muted-foreground/15 ${className}`}
      style={{ width: largura }}
    />
  );
}

export function SkeletonLinhas({ linhas = 8, colunas = 10 }: { linhas?: number; colunas?: number }) {
  return (
    <>
      {Array.from({ length: linhas }, (_, i) => (
        <tr
          key={i}
          aria-hidden
          className="animate-pulse border-b border-border/70 last:border-0 motion-reduce:animate-none"
          // Escada curta no início: a lista parece preencher de cima para baixo em vez
          // de pulsar em bloco. Sem efeito quando o usuário pede menos movimento.
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <td className="relative py-3.5 pl-5 pr-3">
            <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-muted-foreground/20" />
            <Barra largura={LARGURAS[i % LARGURAS.length]} className="h-3.5" />
            <Barra largura="34%" className="mt-2 h-2.5" />
          </td>
          <td className="px-3 py-3.5">
            <Barra largura="70%" />
            <Barra largura="88%" className="mt-2 h-2.5" />
          </td>
          <td className="hidden px-3 py-3.5 lg:table-cell">
            <Barra largura="60%" />
          </td>
          <td className="px-3 py-3.5">
            <span className="block h-5 w-24 rounded-full bg-muted-foreground/15" />
          </td>
          {/* Pré-status: mesma quebra (`md`) da coluna real, senão a silhueta do
              carregamento não bate com a tabela que chega depois. */}
          <td className="hidden px-3 py-3.5 md:table-cell">
            <span className="block h-5 w-20 rounded-full bg-muted-foreground/15" />
          </td>
          <td className="hidden px-3 py-3.5 xl:table-cell">
            <Barra largura="50%" />
          </td>
          <td className="px-3 py-3.5">
            <span className="ml-auto block h-3 w-16 rounded-full bg-muted-foreground/15" />
          </td>
          <td className="hidden px-3 py-3.5 sm:table-cell">
            <Barra largura="70%" />
          </td>
          {colunas > 8 && <td className="pr-3" />}
        </tr>
      ))}
    </>
  );
}
