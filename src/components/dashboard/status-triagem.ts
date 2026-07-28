/**
 * Vocabulário de status da triagem — um lugar só para rótulo, ícone, cor e ordem.
 *
 * A cor aqui é a **régua de triagem**: a borda esquerda de cada linha da tabela e o
 * acento da pílula de filtro. O rótulo e o ícone vêm do `StatusBadge`, que já é
 * compartilhado com "Meus Projetos" — a tela do admin NÃO redefine badge, só empresta
 * a mesma chave (o valor da coluna "Status" em minúsculas).
 */
import { Clock, CheckCircle2, RotateCcw, XCircle, Archive, HelpCircle, Search } from 'lucide-react';

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
    chave: 'em validação',
    label: 'Em validação',
    curto: 'Em validação',
    cor: '#7c3aed',
    icon: Search,
  },
  {
    chave: 'reenvio pendente',
    label: 'Reenvio pendente',
    curto: 'Reenvio',
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
    chave: 'descontinuado',
    label: 'Descontinuado',
    curto: 'Descont.',
    cor: '#475569',
    icon: Archive,
  },
  {
    chave: 'sem_status',
    label: 'Sem status',
    curto: 'Sem status',
    cor: '#9ca3af',
    icon: HelpCircle,
  },
];

/**
 * Status conhecidos (`rejeitado` e `validado` são rótulos legados que ainda existem em
 * linhas antigas da planilha — mapeados para a pílula equivalente em vez de virarem
 * uma coluna solta).
 */
const EQUIVALENTES: Record<string, string> = {
  rejeitado: 'reenvio pendente',
  validado: 'aprovado',
  'em validacao': 'em validação',
};

/** Chave da pílula à qual um status da planilha pertence. */
export function pilulaDe(statusChave: string | null): string {
  if (!statusChave) return 'sem_status';
  return EQUIVALENTES[statusChave] ?? statusChave;
}

export function metaStatus(chave: string): StatusTriagem | undefined {
  return STATUS_TRIAGEM.find((s) => s.chave === chave);
}

/** Cor da régua de uma linha; status desconhecido fica neutro em vez de invisível. */
export function corDaRegua(statusChave: string | null): string {
  return metaStatus(pilulaDe(statusChave))?.cor ?? '#9ca3af';
}
