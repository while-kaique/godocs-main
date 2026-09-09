/**
 * A barra de AÇÃO EM LOTE do `/dashboard`: roda o time de agentes nos projetos selecionados.
 *
 * ⚠️ **Iterada pelo FRONT, em lotes pequenos** (pedido do Luis, 08/09/2026: *"quero um botão geral
 * também que rode nos projetos que eu selecionar"*). É o padrão deste repo para trabalho longo, e
 * o motivo é medido: cada projeto são ~5 chamadas de LLM, e uma tarefa longa em `waitUntil` é
 * **cancelada** pelo Godeploy — foi assim que o botão do time de 30 chamadas prometeu uma estrela
 * que nunca chegou. Aqui cada requisição é curta e a tela mostra onde está.
 * ⚠️ Falha de um lote **não** para a fila: o contador de erros aparece no fim, e o que rodou está
 * gravado (cada projeto é independente).
 */
import { useState } from 'react';
import { Bot, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';

/** Projetos por requisição. Espelha o `LOTE_MAX_PROJETOS` do servidor. */
export const LOTE_TAMANHO = 8;

type Progresso = { feitos: number; total: number; erros: number } | null;

export function BarraLoteAgente({
  ids,
  onLimpar,
  onConcluir,
}: {
  /** Os ids selecionados, na ordem da tela. */
  ids: string[];
  onLimpar: () => void;
  /** Chamado no fim (com ou sem erro) para a tela recarregar a listagem. */
  onConcluir: () => void;
}) {
  const [progresso, setProgresso] = useState<Progresso>(null);
  const rodando = progresso !== null;

  async function rodar() {
    if (rodando || ids.length === 0) return;
    setProgresso({ feitos: 0, total: ids.length, erros: 0 });
    let erros = 0;
    for (let i = 0; i < ids.length; i += LOTE_TAMANHO) {
      const fatia = ids.slice(i, i + LOTE_TAMANHO);
      try {
        const r = (await apiFetch('/api/admin/avaliacao/lote', {
          projetoIds: fatia,
          dry: false,
          forcar: true,
        })) as { ok?: boolean; rodados?: number };
        if (r?.ok !== true) erros += fatia.length;
        else erros += fatia.length - (r.rodados ?? fatia.length);
      } catch {
        erros += fatia.length;
      }
      setProgresso({ feitos: Math.min(i + LOTE_TAMANHO, ids.length), total: ids.length, erros });
    }
    setProgresso(null);
    onConcluir();
  }

  if (ids.length === 0) return null;
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5"
      style={{ borderColor: 'rgba(0,89,169,0.28)', background: 'rgba(0,89,169,0.05)' }}
      role="region"
      aria-label="Ações para os projetos selecionados"
    >
      <span className="text-[12.5px] font-semibold" style={{ color: '#0059A9' }}>
        {ids.length} {ids.length === 1 ? 'projeto selecionado' : 'projetos selecionados'}
      </span>
      <Button type="button" size="sm" className="h-8 text-[12px]" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        Rodar o time nos selecionados
      </Button>
      {rodando && (
        // Progresso em TEXTO, não só numa barra: é o que diz que a fila está andando quando um
        // lote demora (e a régua do repo é estado nunca só por cor/forma).
        <span className="text-[12px] text-muted-foreground" aria-live="polite">
          {progresso!.feitos} de {progresso!.total}
          {progresso!.erros > 0 ? ` · ${progresso!.erros} sem resultado` : ''}
        </span>
      )}
      {!rodando && (
        <button
          type="button"
          onClick={onLimpar}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Limpar seleção
        </button>
      )}
      <span className="text-[11px] text-muted-foreground">
        Roda em lotes de {LOTE_TAMANHO}. Nada aqui escreve na coluna "Estrelas" nem muda o Status.
      </span>
    </div>
  );
}
