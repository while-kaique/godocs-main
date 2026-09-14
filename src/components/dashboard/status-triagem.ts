/**
 * Vocabulário de status da triagem — um lugar só para rótulo, ícone, cor e ordem.
 *
 * A cor aqui é a **régua de triagem**: a borda esquerda de cada linha da tabela e o
 * acento da pílula de filtro. O rótulo e o ícone vêm do `StatusBadge`, que já é
 * compartilhado com "Meus Projetos" — a tela do admin NÃO redefine badge, só empresta
 * a mesma chave (o valor da coluna "Status" em minúsculas).
 */
import { Clock, CheckCircle2, RotateCcw, XCircle, Archive, ShieldCheck } from 'lucide-react';

export type FiltroStatus = string; // chave em minúsculas, 'todos' ou 'sem_status'

export type StatusTriagem = {
  chave: string;
  label: string;
  /** Rótulo curto para a pílula de filtro (a faixa fica apertada em telas médias). */
  curto: string;
  cor: string;
  icon: typeof Clock;
};

/**
 * Ordem da esteira de triagem: o que precisa de atenção primeiro, o que já terminou
 * depois. "Sem status" fica ao lado de Pendente porque é a mesma fila na prática
 * (célula vazia = ninguém olhou ainda).
 */
export const STATUS_TRIAGEM: StatusTriagem[] = [
  {
    chave: 'pendente',
    label: 'Pendente',
    curto: 'Pendente',
    cor: 'var(--go-blue)',
    icon: Clock,
  },
  {
    // ⚠️ O estado que AUTORIZA o agente (`podeAgenteDecidir`). Ver `status-funil.ts`.
    chave: 'pré-aprovado',
    label: 'Pré-aprovado',
    curto: 'Pré-aprovado',
    cor: '#0ea5e9',
    icon: ShieldCheck,
  },
  {
    chave: 'ajuste pedido',
    label: 'Ajuste pedido',
    curto: 'Ajuste',
    cor: '#8a7d00',
    icon: RotateCcw,
  },
  {
    chave: 'aprovado',
    label: 'Aprovado',
    curto: 'Aprovado',
    cor: '#16a34a',
    icon: CheckCircle2,
  },
  {
    chave: 'reprovado',
    label: 'Reprovado',
    curto: 'Reprovado',
    cor: '#dc2626',
    icon: XCircle,
  },
  {
    // Fora do funil: é o dono arquivando, não uma etapa. Fica na faixa porque a triagem
    // precisa alcançar a fila.
    chave: 'descontinuado',
    label: 'Descontinuado',
    curto: 'Descont.',
    cor: '#475569',
    icon: Archive,
  },
];

/**
 * Status conhecidos (`rejeitado` e `validado` são rótulos legados que ainda existem em
 * linhas antigas da planilha — mapeados para a pílula equivalente em vez de virarem
 * uma coluna solta).
 */
const EQUIVALENTES: Record<string, string> = {
  // Vocabulário ANTERIOR à coluna única (14/09/2026), ainda presente em linhas da planilha.
  rejeitado: 'ajuste pedido',
  'reenvio pendente': 'ajuste pedido',
  validado: 'aprovado',
  'em validacao': 'pendente',
  'em validação': 'pendente',
  'pré-pendente': 'pendente',
  'pre-pendente': 'pendente',
  'pre-aprovado': 'pré-aprovado',
  'pré-reprovado': 'reprovado',
  'pre-reprovado': 'reprovado',
};

/**
 * Chave da pílula à qual um status da planilha pertence.
 *
 * ⚠️ Célula VAZIA cai em `pendente`, não numa pílula "Sem status" própria (14/09/2026): com a
 * coluna única, "ninguém escreveu nada" e "ninguém decidiu ainda" são o mesmo estado do funil,
 * e uma fila só para o vazio dividia a mesma pergunta em duas pílulas.
 * ⚠️ A isenção vem com o porquê colado ("Pré-aprovado (liderança)"), por isso o prefixo.
 */
export function pilulaDe(statusChave: string | null): string {
  const s = (statusChave ?? '').trim().toLowerCase();
  if (!s || s === '—' || s === '-') return 'pendente';
  if (s.startsWith('pré-aprovado') || s.startsWith('pre-aprovado')) return 'pré-aprovado';
  return EQUIVALENTES[s] ?? s;
}

export function metaStatus(chave: string): StatusTriagem | undefined {
  return STATUS_TRIAGEM.find((s) => s.chave === chave);
}

/** Cor da régua de uma linha; status desconhecido fica neutro em vez de invisível. */
export function corDaRegua(statusChave: string | null): string {
  return metaStatus(pilulaDe(statusChave))?.cor ?? '#9ca3af';
}
