/**
 * O que o TIME DE AGENTES decidiu — hoje, ontem e nesta semana.
 *
 * Pedido do dono do produto (15/09/2026): *"quero uma view temporal dos agentes no frontend
 * também: quero saber o que foi aprovado pelos agentes hoje, ontem e esta semana"*. A
 * pergunta por trás é de confiança: o agente está trabalhando, e o quanto?
 *
 * ⚠️ **Nenhum dado novo é coletado.** A fonte é o `admin_status_log`, que já registra toda
 * escrita de status com ator e carimbo; aqui só se lê o recorte do ator do agente.
 *
 * ⚠️ **"Esta semana" INCLUI hoje e ontem.** As três janelas não são fatias exclusivas — a
 * pergunta "quanto foi aprovado esta semana" quer o total da semana, e descontar hoje dela
 * daria um número que ninguém pediu.
 *
 * ⚠️ Botão, não bloco fixo: a tela é uma esteira de triagem, e um painel permanente no topo
 * empurra a lista para baixo em favor de um número que se consulta de vez em quando.
 */
import { useRef, useState } from "react";
import { Bot, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Popover } from "@/components/calendario/calendario";
import { apiFetch } from "@/lib/api-client";
import { fmtDataBR } from "@/lib/format-date";
import type { ResumoJanela } from "@/lib/agentes-atividade";

const AZUL = "var(--go-blue)";

type Atividade = { ok: boolean; ator: string; janelas: ResumoJanela[]; motivo?: string };

export function PainelAgentes() {
  const gatilho = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<Atividade | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir() {
    setAberto(true);
    // Recarrega a cada abertura: o número muda a cada corrida do cron (5 em 5 min), e um
    // painel que mostra o estado de meia hora atrás responde a pergunta errada.
    setCarregando(true);
    setErro(null);
    try {
      setDados(await apiFetch<Atividade>("/api/admin/agentes/atividade"));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler a atividade do agente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        onClick={() => (aberto ? setAberto(false) : void abrir())}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-full border bg-card px-3.5 text-[13px] font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
        style={{ ["--tw-ring-color" as string]: AZUL }}
        title="O que o time de agentes decidiu hoje, ontem e nesta semana"
      >
        <Bot className="h-4 w-4" aria-hidden />
        Agentes
      </button>

      {aberto && (
        <Popover
          ancoraRef={gatilho}
          onFechar={() => setAberto(false)}
          rotulo="Atividade do time de agentes"
        >
          <div className="w-[360px] p-4">
            <p
              className="text-[10px] font-bold uppercase tracking-[0.09em]"
              style={{ color: AZUL }}
            >
              Decisões do time de agentes
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              Só o que o agente gravou. Ele aprova ou reprova; o que ele não fecha fica para a
              triagem e não aparece aqui.
            </p>

            {carregando && (
              <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                Lendo o histórico…
              </p>
            )}

            {erro && (
              <p className="mt-4 flex items-start gap-1.5 text-[12px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {erro}
              </p>
            )}

            {!carregando && !erro && dados && (
              <div className="mt-3 flex flex-col gap-3">
                {dados.janelas.map((j) => (
                  <section key={j.janela}>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[12.5px] font-semibold">{j.rotulo}</h3>
                      <span className="flex items-center gap-2 text-[11.5px] tabular-nums">
                        {/* Estado nunca só por cor: ícone + número. */}
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: "#17714f" }}
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          {j.aprovados}
                          <span className="sr-only">aprovados</span>
                        </span>
                        <span
                          className="inline-flex items-center gap-1 font-semibold"
                          style={{ color: "#b3261e" }}
                        >
                          <XCircle className="h-3 w-3" aria-hidden />
                          {j.reprovados}
                          <span className="sr-only">reprovados</span>
                        </span>
                      </span>
                    </div>
                    {j.itens.length === 0 ? (
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        O agente não decidiu nada neste período.
                      </p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {j.itens.slice(0, 6).map((i) => (
                          <li
                            key={`${i.projeto_id}-${i.quando}`}
                            className="flex items-baseline justify-between gap-2 text-[11.5px]"
                          >
                            <span className="truncate" title={i.nome}>
                              {i.nome}
                            </span>
                            <span
                              className="shrink-0 font-medium"
                              style={{ color: i.status === "Aprovado" ? "#17714f" : "#b3261e" }}
                            >
                              {i.status}
                            </span>
                          </li>
                        ))}
                        {j.itens.length > 6 && (
                          <li className="text-[11px] text-muted-foreground">
                            e mais {j.itens.length - 6}
                          </li>
                        )}
                      </ul>
                    )}
                  </section>
                ))}
                <p className="border-t pt-2 text-[10.5px] text-muted-foreground">
                  Dias contados no fuso de Brasília. A semana começa na segunda, e inclui hoje.
                  {dados.janelas[2]?.itens[0]?.quando
                    ? ` Última decisão: ${fmtDataBR(dados.janelas[2].itens[0].quando.slice(0, 10))}.`
                    : ""}
                </p>
              </div>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
