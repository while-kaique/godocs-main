import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, PauseCircle } from "lucide-react";
import { estadoBloqueio, type FaseBloqueio } from "@/lib/bloqueio-submissao";

/**
 * Faixa de aviso do BLOQUEIO TEMPORÁRIO de novas submissões.
 *
 * Duas caras, mesma faixa:
 *  • ANTES da janela  → lembrete de prazo (azul GoGroup, ícone de calendário/relógio);
 *    o envio ainda funciona.
 *  • DURANTE a janela → envio pausado (âmbar, ícone de pausa); o botão fica bloqueado
 *    por quem consome este hook (`useBloqueioSubmissao`).
 *
 * a11y (regra 11): o estado nunca depende só da cor — há ícone + rótulo textual
 * ("Aviso" / "Submissões pausadas") e a faixa é um `role="status"`. Sem animação
 * (nada a respeitar em `prefers-reduced-motion`). Copy da fonte única
 * `src/lib/bloqueio-submissao.ts` — nenhum texto mora aqui.
 */

/** Nada a avisar, nada a bloquear — o mesmo formato que `estadoBloqueio` devolve na fase livre. */
const SEM_BLOQUEIO = { fase: "livre" as FaseBloqueio, mensagem: null, bloqueado: false };

/**
 * Reavalia o estado no mount e a cada minuto (cobre a página aberta cruzando a virada).
 *
 * ⚠️ FORA DE PRODUÇÃO a pausa NÃO se aplica. O motivo é o conteúdo do próprio aviso: ele
 * anuncia que "o GoDocs vai receber uma versão nova e melhor" — e essa versão nova é
 * exatamente o que se valida no app de STAGING. Manter a faixa lá desabilitaria o botão
 * "Submeter" no único ambiente onde a coisa anunciada pode ser testada.
 *
 * ⚠️ Por que aqui, e não movendo a janela em `bloqueio-submissao.ts`: aquele módulo é PURO
 * e é a fonte única da janela e da copy, com testes que travam os marcos. Mexer nas
 * constantes para liberar o staging mudaria a régua de PRODUÇÃO junto (o cliente não lê
 * `process.env`, só os defaults baked) e quebraria os testes do módulo. A distinção
 * "onde estou rodando" é da BORDA, não da régua.
 *
 * Reusa a MESMA query da faixa de staging (`public-config`, cache infinito), então não
 * custa requisição nova. Enquanto o ambiente é desconhecido, vale a régua de produção: a
 * dúvida erra para o lado de bloquear, nunca para o de liberar indevidamente.
 */
export function useBloqueioSubmissao() {
  const [estado, setEstado] = useState(() => estadoBloqueio());
  useEffect(() => {
    const id = setInterval(() => setEstado(estadoBloqueio()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery<{ env: string }>({
    queryKey: ["public-config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) return { env: "production" };
      return (await res.json()) as { env: string };
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (data && data.env !== "production") return SEM_BLOQUEIO;
  return estado;
}

const TINTA: Record<
  Exclude<FaseBloqueio, "livre">,
  { bar: string; bg: string; rotulo: string; titulo: string; corpo: string }
> = {
  antes: {
    bar: "var(--go-blue)",
    bg: "rgba(0,89,169,0.06)",
    rotulo: "var(--go-blue)",
    titulo: "var(--go-text-heading)",
    corpo: "#4a4a57",
  },
  durante: {
    bar: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    rotulo: "#b45309",
    titulo: "#78350f",
    corpo: "#78350f",
  },
};

export function AvisoBloqueioSubmissao({
  fase,
  mensagem,
  className,
}: {
  fase: FaseBloqueio;
  mensagem: string | null;
  className?: string;
}) {
  if (fase === "livre" || !mensagem) return null;
  const tinta = TINTA[fase];
  const Icone = fase === "durante" ? PauseCircle : CalendarClock;
  const rotulo = fase === "durante" ? "Submissões pausadas" : "Aviso";

  return (
    <section
      role="status"
      className={`overflow-hidden rounded-xl ${className ?? ""}`}
      style={{ background: tinta.bg, borderLeft: `3px solid ${tinta.bar}` }}
    >
      <div className="flex items-start gap-3 px-4 py-3" style={{ maxWidth: "72ch" }}>
        <Icone className="mt-0.5 h-5 w-5 shrink-0" style={{ color: tinta.bar }} aria-hidden />
        <div>
          <p
            className="text-[10px] font-bold uppercase"
            style={{ color: tinta.rotulo, letterSpacing: "0.08em" }}
          >
            {rotulo}
          </p>
          <p className="mt-0.5 text-[13px]" style={{ color: tinta.corpo, lineHeight: 1.55 }}>
            {mensagem}
          </p>
        </div>
      </div>
    </section>
  );
}
