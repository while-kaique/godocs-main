/**
 * "Quem fez o quê" — bloco do cartão de projeto nas abas temporárias do admin
 * (`/especiais` e `/aprovacoes-pendentes`). FONTE ÚNICA das duas telas: o texto por
 * participante é coletado na Etapa 1 e mora só no banco, e quem valida precisa saber
 * quem fez o quê antes de aprovar — mas o cartão é para ESCANEAR.
 *
 * Por isso vem COLAPSADO: 4 pessoas × 100 caracteres somam ~8 linhas e inflariam a
 * coluna inteira (é a mesma lição do aviso de reprovação nos cards de "Meus Projetos",
 * que aberto por padrão crescia ~200px). A tira fechada diz quantas pessoas há; aberta,
 * uma linha por pessoa com o papel ao lado do nome.
 */
import { useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import type { ContribuicaoParticipante } from '@/lib/participantes-contribuicoes';

const AZUL = 'var(--go-blue)';

export function QuemFezOQue({ pessoas }: { pessoas: ContribuicaoParticipante[] }) {
  const [aberto, setAberto] = useState(false);
  if (pessoas.length === 0) return null;

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 rounded text-left text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
        style={{ ['--tw-ring-color' as string]: AZUL }}
      >
        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Quem fez o quê{' '}
          <span className="tabular-nums">
            ({pessoas.length} {pessoas.length === 1 ? 'pessoa' : 'pessoas'})
          </span>
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {aberto && (
        <ul className="mt-1.5 space-y-1.5">
          {pessoas.map((p) => (
            <li key={p.email} className="rounded-md bg-muted/60 px-2 py-1.5">
              <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{p.email}</span>
                {p.papel && (
                  <span
                    className="rounded px-1 py-px text-[10.5px] font-medium"
                    style={{ background: 'rgba(0,89,169,0.1)', color: AZUL }}
                  >
                    {p.papel}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground">{p.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
