import { useState } from 'react';
import { History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { HistoricoDrawer } from './historico-drawer';

/**
 * Botão "Histórico" + o drawer que ele abre. Autossuficiente (guarda o próprio `open`),
 * então cada tela de aprovação só o solta no cabeçalho. Só admin vê estas telas, e o
 * endpoint por trás é `requireAdmin` — o botão não é a trava.
 */
export function HistoricoButton({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className={className} onClick={() => setAberto(true)}>
        <History className="mr-1.5 size-4" aria-hidden />
        Histórico
      </Button>
      <HistoricoDrawer open={aberto} onOpenChange={setAberto} />
    </>
  );
}
