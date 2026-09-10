/**
 * A RÉGUA DA ESTRELA na tela, lida da FONTE ÚNICA (`estrelas-regua.ts`).
 *
 * ⚠️ **Por que existe** (pedido do dono do produto, 10/09/2026, olhando o «SendApp» com 2★):
 * *"Voce pode fazer o ajuste no frontend pra eu ver de forma eficiente os criterios de estrelas?
 * Pra eu poder ver la que sendApp é 2 e eu poder ler as 2?"*. O número sozinho não é revisável:
 * para discordar de um 2 é preciso saber o que "2" afirma — e a régua estava só no prompt do
 * agente e num plano, nunca na tela de quem tria.
 *
 * ⚠️ **NÃO redigita a régua.** O texto sai de `NIVEL_ZERO`/`CRITERIOS_ESTRELA`/`descreverEscape`,
 * os mesmos que o agente recebe. Régua na tela divergindo da régua do agente é pior que régua
 * nenhuma: a triagem passaria a corrigir a nota por um critério que ninguém aplicou.
 */
import { useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import { CRITERIOS_ESTRELA, FAIXA_ESCAPE, NIVEL_ZERO, type NivelEstrela } from '@/lib/estrelas-regua';

const AZUL = '#0059A9';
const AMBAR = '#8a5a00';

/** Todos os níveis em ordem, do 0 ao 5. A faixa 6-10 é tratada à parte (ela não tem número). */
function niveis(): NivelEstrela[] {
  return [NIVEL_ZERO, ...CRITERIOS_ESTRELA];
}

/** O verbo do nível — o que a triagem precisa ler junto do número. PURA. */
export function verboDaNota(nota: number | null | undefined): string | null {
  if (typeof nota !== 'number' || !Number.isFinite(nota)) return null;
  if (nota >= FAIXA_ESCAPE.min) return 'Muda o jogo';
  return niveis().find((n) => n.nota === nota)?.verbo ?? null;
}

/**
 * O nível de UMA nota, aberto: verbo, critério, artefatos e exemplos.
 *
 * ⚠️ Os exemplos entram porque são o que torna a régua utilizável de relance: "2 · Executa" é
 * abstrato, "como o Tiktok Scraper" resolve em um segundo.
 */
function Nivel({ n, destaque }: { n: NivelEstrela; destaque: boolean }) {
  return (
    <li
      className="rounded-lg border px-2.5 py-2"
      style={{
        borderColor: destaque ? 'rgba(0,89,169,0.45)' : 'rgba(71,85,105,0.18)',
        background: destaque ? 'rgba(0,89,169,0.07)' : 'transparent',
      }}
    >
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="inline-flex items-baseline gap-1 text-[13px] font-bold" style={{ color: AZUL }}>
          {n.nota}
          <Star className="h-3 w-3 self-center" aria-hidden />
        </span>
        <span className="text-[13px] font-semibold">{n.verbo}</span>
        {/* Estado nunca só por cor: o nível atual é dito em TEXTO, não só realçado. */}
        {destaque && (
          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: AZUL }}>
            nota deste projeto
          </span>
        )}
      </span>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{n.criterio}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
        {n.artefatos} <span className="opacity-70">Ex.: {n.exemplos.join(' · ')}</span>
      </p>
    </li>
  );
}

/**
 * A régua inteira, colapsada, com o nível da nota em destaque.
 *
 * ⚠️ Colapsada por padrão pela mesma razão do painel do agente: são 7 níveis e a ficha é onde a
 * decisão acontece — a régua ajuda quem quer conferir, e não pode empurrar a decisão para fora da
 * vista.
 */
export function ReguaEstrela({ nota }: { nota: number | null }) {
  const [aberto, setAberto] = useState(false);
  const verbo = verboDaNota(nota);
  const escape = typeof nota === 'number' && nota >= FAIXA_ESCAPE.min;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls="regua-estrela"
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0059A9] focus-visible:ring-offset-1"
        style={{ color: escape ? AMBAR : AZUL }}
      >
        {verbo ? `O que significa ${escape ? `a faixa ${FAIXA_ESCAPE.min}-${FAIXA_ESCAPE.max}` : `${nota} · ${verbo}`}` : 'Ver a régua das estrelas'}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {aberto && (
        <ul id="regua-estrela" className="mt-1.5 space-y-1.5">
          {niveis().map((n) => (
            <Nivel key={n.nota} n={n} destaque={n.nota === nota} />
          ))}
          <li
            className="rounded-lg border px-2.5 py-2"
            style={{
              borderColor: escape ? 'rgba(138,90,0,0.45)' : 'rgba(71,85,105,0.18)',
              background: escape ? 'rgba(138,90,0,0.08)' : 'transparent',
            }}
          >
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-bold" style={{ color: AMBAR }}>
                {FAIXA_ESCAPE.min} a {FAIXA_ESCAPE.max}
              </span>
              <span className="text-[13px] font-semibold">Muda o jogo</span>
              {escape && (
                <span className="text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: AMBAR }}>
                  faixa deste projeto
                </span>
              )}
            </span>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Revoluciona como a área ou a empresa trabalha. Sistemas agênticos com impacto direto
              nos KPIs e no resultado financeiro, que abrem novas frentes de receita ou de saving e
              substituem trabalho humano de forma clara.
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              O agente indica a faixa e <strong className="font-semibold">não crava o número</strong>:
              a posição entre {FAIXA_ESCAPE.min} e {FAIXA_ESCAPE.max} é do comitê humano.
            </p>
          </li>
        </ul>
      )}
    </div>
  );
}
