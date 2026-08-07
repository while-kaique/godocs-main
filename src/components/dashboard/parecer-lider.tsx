/**
 * Parecer do líder na ficha de triagem — o que antes só existia legível na planilha.
 *
 * Pedido do Luis (05/08/2026): a triagem precisava abrir o Sheets e ler uma célula
 * multi-linha para saber o que o líder respondeu. Aqui o mesmo conteúdo aparece dividido:
 * estado, quem decidiu e quando, uma linha por pergunta do checklist com o sim/não, e o
 * texto do líder rotulado pelo que ele é.
 *
 * Decisões de desenho:
 *  • O que a triagem caça é a CONTRADIÇÃO (pré-aprovado com um "não" no checklist), então
 *    o "não" tem peso visual — chip preenchido, ícone e a palavra — e o "sim" fica quieto.
 *    Estado nunca só por cor (regra 11): sempre ícone + palavra.
 *  • Vocabulário de pré-aprovação ("Pré-aprovado", "Ajuste pedido"), nunca "Aprovado" —
 *    no mesmo overlay existe o Status do projeto e confundir os dois seria grave.
 *  • Nada é descartado: linha que o parser não reconhece aparece como veio.
 */
import {
  CheckCircle2,
  XCircle,
  Clock,
  CircleSlash,
  MinusCircle,
  PencilLine,
  Quote,
} from 'lucide-react';
import { chaveDoEstado, type EstadoParecer, type ParecerLider } from '@/lib/aprovacoes-parecer';

/** Aparência de cada estado. `icone` + `rotulo` garantem leitura sem depender da cor. */
const APARENCIA: Record<
  EstadoParecer,
  { rotulo: string; cor: string; fundo: string; borda: string; Icone: typeof CheckCircle2 }
> = {
  aprovado: {
    rotulo: 'Pré-aprovado',
    cor: '#186a3b',
    fundo: 'rgba(24,106,59,0.10)',
    borda: 'rgba(24,106,59,0.35)',
    Icone: CheckCircle2,
  },
  ajuste: {
    rotulo: 'Ajuste pedido',
    cor: '#8a5a00',
    fundo: 'rgba(214,158,46,0.14)',
    borda: 'rgba(214,158,46,0.45)',
    Icone: PencilLine,
  },
  reprovado: {
    rotulo: 'Pré-reprovado',
    cor: '#a4262c',
    fundo: 'rgba(164,38,44,0.10)',
    borda: 'rgba(164,38,44,0.35)',
    Icone: XCircle,
  },
  pendente: {
    rotulo: 'Pré-pendente',
    cor: 'var(--go-blue)',
    fundo: 'rgba(0,89,169,0.08)',
    borda: 'rgba(0,89,169,0.30)',
    Icone: Clock,
  },
  // Cinza-ardósia e ícone de "deixou de valer", não uma cor de veredito: ninguém julgou
  // este projeto — o sistema fechou a fila porque o analisador o reprovou por critério.
  // Distinto do vermelho `XCircle` (o líder recusou) e do `MinusCircle` (célula vazia).
  dispensado: {
    rotulo: 'Dispensado',
    cor: '#475569',
    fundo: 'rgba(71,85,105,0.10)',
    borda: 'rgba(71,85,105,0.32)',
    Icone: CircleSlash,
  },
  sem_parecer: {
    rotulo: 'Sem parecer',
    cor: '#5b6470',
    fundo: 'rgba(91,100,112,0.08)',
    borda: 'rgba(91,100,112,0.30)',
    Icone: MinusCircle,
  },
};

/**
 * Chip do estado do parecer — usado na ficha E na coluna "Pré-status" da tabela, para os
 * dois lugares não terem réguas diferentes de rótulo, cor e ícone.
 *
 * `estado` é o valor CRU da coluna: estado desconhecido (alguém digitou à mão na planilha)
 * é exibido como está, não traduzido para "Pré-aprovado".
 */
export function ChipEstadoParecer({
  estado,
  compacto = false,
}: {
  estado: string | null;
  compacto?: boolean;
}) {
  const chave = chaveDoEstado(estado);
  const a = APARENCIA[chave];
  const { Icone } = a;
  const rotulo = chave === 'sem_parecer' ? (estado ?? a.rotulo) : a.rotulo;
  return (
    <span
      className={
        compacto
          ? 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold'
          : 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold'
      }
      style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
    >
      <Icone className={compacto ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5'} aria-hidden />
      {rotulo}
    </span>
  );
}

function Resposta({ valor }: { valor: 'sim' | 'nao' }) {
  const nao = valor === 'nao';
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-bold uppercase tracking-[0.04em]"
      style={
        nao
          ? { background: '#8a5a00', color: '#fff' }
          : {
              background: 'transparent',
              color: '#186a3b',
              border: '1px solid rgba(24,106,59,0.35)',
            }
      }
    >
      {nao ? <XCircle className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
      {nao ? 'não' : 'sim'}
    </span>
  );
}

export function ParecerLiderPainel({ parecer }: { parecer: ParecerLider }) {
  const semRespostas =
    !parecer.checklist.length && !parecer.comentario && !parecer.outras.length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ChipEstadoParecer estado={parecer.estado} />
        {parecer.assinatura && (
          <p className="text-[12.5px] text-muted-foreground">
            por <span className="font-medium text-foreground">{parecer.assinatura}</span>
            {parecer.decididoEm ? ` em ${parecer.decididoEm}` : ''}
          </p>
        )}
        {/* Fila aberta ("Aguardando…") ou motivo da isenção (D12) — é o que separa
            isenção legítima de falha de integração. */}
        {parecer.cabecalho && (
          <p className="text-[12.5px] text-muted-foreground">{parecer.cabecalho}</p>
        )}
        {parecer.temNao && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'rgba(138,90,0,0.12)',
              border: '1px solid rgba(138,90,0,0.4)',
              color: '#8a5a00',
            }}
          >
            <XCircle className="h-3 w-3" aria-hidden />
            Respondeu "não" no checklist
          </span>
        )}
      </div>

      {parecer.checklist.length > 0 && (
        // A espinha à esquerda amarra as 3 respostas como UM registro; a faixa marca a
        // linha do "não" para quem varre a ficha rolando.
        <ul
          className="mt-3.5 space-y-px border-l-2 pl-3"
          style={{ borderColor: 'rgba(0,89,169,0.25)' }}
        >
          {parecer.checklist.map((c) => (
            <li
              key={c.pergunta}
              className="flex items-start justify-between gap-3 rounded-r-md py-1.5 pr-2"
              style={
                c.resposta === 'nao'
                  ? { background: 'rgba(138,90,0,0.07)', paddingLeft: '0.5rem' }
                  : { paddingLeft: '0.5rem' }
              }
            >
              <span className="text-[13px] leading-snug">{c.pergunta}</span>
              <Resposta valor={c.resposta} />
            </li>
          ))}
        </ul>
      )}

      {parecer.comentario && (
        <figure className="mt-3.5">
          <figcaption className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {parecer.comentarioRotulo ?? 'Texto do líder'}
          </figcaption>
          <blockquote
            className="mt-1 flex gap-2 rounded-lg border-l-2 bg-muted/40 p-2.5 text-[13px] leading-relaxed"
            style={{ borderColor: 'var(--go-lime)' }}
          >
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="whitespace-pre-wrap">{parecer.comentario}</span>
          </blockquote>
        </figure>
      )}

      {parecer.outras.length > 0 && (
        <div className="mt-3 space-y-0.5">
          {parecer.outras.map((l, i) => (
            <p key={i} className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">
              {l}
            </p>
          ))}
        </div>
      )}

      {semRespostas && !parecer.cabecalho && !parecer.assinatura && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          A planilha não tem detalhe deste parecer — só o estado.
        </p>
      )}
    </div>
  );
}
