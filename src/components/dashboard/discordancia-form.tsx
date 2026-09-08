/**
 * Formulário de DISCORDÂNCIA com o time de avaliação — o que o 👎 da ficha de triagem abre.
 *
 * ## Por que ele existe
 * Antes daqui, o 👎 gravava um polegar em `avaliacao_feedback` e ninguém lia aquilo de volta: o
 * agente não aprendia nada com a discordância. O que faltava era o PORQUÊ — e a diferença entre
 * ter e não ter é a diferença entre o agente decorar "concorde com o humano" e ele aprender o
 * CRITÉRIO que deixou passar (ver `src/lib/correcoes.ts`).
 *
 * ## O desenho
 * A ordem dos campos é a ordem em que se pensa a discordância: **qual era o desfecho certo** →
 * **qual lente errou** → **por quê**. Não é numeração decorativa; é a sequência da decisão.
 *
 * ⚠️ O elemento central é a CITAÇÃO: ao escolher o eixo, o formulário mostra a frase daquele
 * especialista e a pessoa responde a ELA. Isso não é enfeite — a lição que o prompt lê é um PAR
 * ("o agente argumentou X / a triagem respondeu Y"), e sem o lado do agente a réplica humana
 * chega solta, sem o raciocínio a que responde.
 *
 * ⚠️ Registro visual: este formulário vive DENTRO do painel de sombra, que é deliberadamente
 * apagado (slate) contra o azul e o lime do resto do app — sombra não compete com decisão. Ele
 * ADAPTA esse idioma (11px de sobrancelha, 12,5px de corpo, anel de foco `--go-blue`), não
 * inventa um novo.
 */
import { useMemo, useState } from "react";
import { Loader2, MessageSquareQuote, ThumbsDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AJUDA_EIXO,
  EIXOS_CORRECAO,
  MOTIVO_MAX,
  MOTIVO_MIN,
  ROTULO_EIXO,
  VEREDITOS_CERTOS,
  type EixoCorrecao,
} from "@/lib/correcoes";
import { linhaDoEixo, type LinhaParecer } from "@/lib/mesa-parecer";

export type DadosDiscordancia = {
  eixo: EixoCorrecao;
  vereditoCerto: string;
  motivo: string;
};

const SOBRANCELHA = "text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground";
const ANEL_FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0059A9] focus-visible:ring-offset-1";

export function DiscordanciaForm({
  parecer,
  vereditoDoAgente,
  salvando,
  onCancelar,
  onEnviar,
}: {
  /** O parecer da mesa, já partido por especialista — a fonte da citação. */
  parecer: LinhaParecer[];
  /** O desfecho que o agente concluiu — a opção que não faz sentido oferecer. */
  vereditoDoAgente?: string | null;
  salvando: boolean;
  onCancelar: () => void;
  onEnviar: (dados: DadosDiscordancia) => void;
}) {
  const [eixo, setEixo] = useState<EixoCorrecao | null>(null);
  const [vereditoCerto, setVereditoCerto] = useState<string>("");
  const [motivo, setMotivo] = useState("");

  const texto = motivo.trim();
  const faltam = MOTIVO_MIN - texto.length;
  const completo = !!eixo && !!vereditoCerto && faltam <= 0;

  // A frase que a pessoa está contestando. Sem linha daquele especialista (parecer legado, que
  // é um parágrafo só, ou eixo "outro"), o bloco simplesmente não aparece — nunca uma citação
  // inventada nem um vazio com aspas.
  // ⚠️ A MESMA função que o servidor usa para escolher a frase que vai gravada como
  // `leitura_do_agente` — se cada lado escolhesse por conta, o par argumento/réplica guardaria
  // uma réplica a uma frase que o agente não disse ali.
  const citacao = useMemo(() => linhaDoEixo(parecer, eixo), [eixo, parecer]);

  return (
    <div
      className="space-y-3.5 rounded-lg border p-3"
      style={{ borderColor: "rgba(71,85,105,0.28)", background: "rgba(255,255,255,0.55)" }}
    >
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Diga o que o agente errou e por quê. Isso não muda o status: entra como lição no parecer dos{" "}
        <strong className="font-semibold">próximos</strong> projetos parecidos.
      </p>

      {/* 1. O desfecho certo — a discordância começa por onde ela dói. */}
      <fieldset className="space-y-1.5">
        <legend className={SOBRANCELHA}>Qual era o desfecho certo?</legend>
        {/* ⚠️ **Botões de alternância, NÃO `role="radio"`** — e é decisão, não descuido.
            `role="radio"` obriga o contrato de teclado do papel (roving tabindex + setas movendo
            seleção e foco, pulando desabilitados). Com o roving tabindex e SEM as setas, o grupo
            ficava pior que antes: das 5 lentes só a primeira recebia foco, e no desfecho — onde a
            opção do índice 0 costuma vir DESABILITADA (foi o que o agente disse) — o único
            `tabIndex=0` caía justamente nela e o formulário virava insubmissível por teclado.
            `aria-pressed` com todos os botões focáveis diz a verdade sobre o que eles são e deixa
            cada opção alcançável. Implementar as setas é a alternativa; enquanto não estiverem
            aqui, o papel não pode estar. */}
        <div className="flex flex-wrap gap-1.5">
          {VEREDITOS_CERTOS.map((v, i) => {
            const ativo = vereditoCerto === v.valor;
            // Escolher o desfecho que o agente JÁ deu não é discordar: não haveria correção de
            // raciocínio a ensinar, e o servidor recusaria a lição. Melhor não oferecer.
            const foiOAgente = !!vereditoDoAgente && v.valor === vereditoDoAgente;
            return (
              <button
                key={v.valor}
                type="button"
                aria-pressed={ativo}
                disabled={salvando || foiOAgente}
                title={foiOAgente ? "Foi o que o agente concluiu" : undefined}
                onClick={() => setVereditoCerto(v.valor)}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors motion-reduce:transition-none disabled:opacity-60 ${ANEL_FOCO}`}
                style={
                  ativo
                    ? {
                        borderColor: "#0059A9",
                        background: "rgba(0,89,169,0.10)",
                        color: "#0059A9",
                      }
                    : { borderColor: "rgba(71,85,105,0.28)" }
                }
              >
                {/* Estado nunca só por cor: o marcado leva o ✓ além da borda azul. */}
                {ativo ? "✓ " : ""}
                {v.rotulo}
                {foiOAgente ? " (foi o que o agente disse)" : ""}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 2. A lente que errou — título + uma linha de sentido, nunca a chave solta. */}
      <fieldset className="space-y-1.5">
        <legend className={SOBRANCELHA}>Qual lente errou?</legend>
        <div className="space-y-1">
          {EIXOS_CORRECAO.map((e) => {
            const ativo = eixo === e;
            return (
              <button
                key={e}
                type="button"
                aria-pressed={ativo}
                disabled={salvando}
                onClick={() => setEixo(e)}
                className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none disabled:opacity-60 ${ANEL_FOCO}`}
                style={
                  ativo
                    ? { borderColor: "#0059A9", background: "rgba(0,89,169,0.07)" }
                    : { borderColor: "rgba(71,85,105,0.20)" }
                }
              >
                <span
                  aria-hidden
                  className="mt-[3px] inline-block h-2.5 w-2.5 flex-none rounded-full border"
                  style={{
                    borderColor: ativo ? "#0059A9" : "rgba(71,85,105,0.45)",
                    background: ativo ? "#0059A9" : "transparent",
                  }}
                />
                <span className="min-w-0">
                  <span
                    className="block text-[12.5px] font-semibold capitalize"
                    style={{ color: ativo ? "#0059A9" : "#334155" }}
                  >
                    {ROTULO_EIXO[e]}
                  </span>
                  <span className="block text-[11.5px] leading-snug text-muted-foreground">
                    {AJUDA_EIXO[e]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 3. O porquê — respondendo à frase do especialista escolhido, quando ela existe. */}
      <div className="space-y-1.5">
        <label htmlFor="discordancia-motivo" className={`block ${SOBRANCELHA}`}>
          Por quê?
        </label>

        {citacao && (
          <blockquote
            className="flex gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-[11.5px] leading-relaxed"
            style={{
              borderColor: "#0059A9",
              background: "rgba(0,89,169,0.05)",
              color: "#334155",
            }}
          >
            <MessageSquareQuote className="mt-[2px] h-3.5 w-3.5 flex-none" aria-hidden />
            <span>
              <span className="font-semibold">{citacao.autor} disse:</span> {citacao.texto}
            </span>
          </blockquote>
        )}

        <textarea
          id="discordancia-motivo"
          value={motivo}
          onChange={(ev) => setMotivo(ev.target.value.slice(0, MOTIVO_MAX))}
          disabled={salvando}
          rows={3}
          maxLength={MOTIVO_MAX}
          placeholder={
            citacao
              ? "Responda ao que ele disse: o que ele não enxergou?"
              : "O que o agente não enxergou neste projeto?"
          }
          aria-describedby="discordancia-contador"
          className={`w-full resize-y rounded-md border bg-white px-2.5 py-1.5 text-[12.5px] leading-relaxed disabled:opacity-60 ${ANEL_FOCO}`}
          style={{ borderColor: "rgba(71,85,105,0.28)" }}
        />
        {/* O contador diz o que FALTA, não um número cru: "12/400" não ensina nada a ninguém. */}
        <p id="discordancia-contador" className="text-[11px] text-muted-foreground">
          {faltam > 0
            ? `Faltam ${faltam} ${faltam === 1 ? "caractere" : "caracteres"} — uma frase basta, e é ela que ensina.`
            : `${texto.length} de ${MOTIVO_MAX} caracteres.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!completo || salvando}
          onClick={() => onEnviar({ eixo: eixo!, vereditoCerto, motivo: texto })}
        >
          {salvando ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <ThumbsDown className="h-4 w-4" aria-hidden />
          )}
          Registrar discordância
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={salvando} onClick={onCancelar}>
          Cancelar
        </Button>
        {/* Diz o que falta preencher em vez de deixar o botão morto sem explicação. */}
        {!completo && !salvando && (
          <span className="text-[11.5px] text-muted-foreground">
            {!vereditoCerto
              ? "Escolha o desfecho certo."
              : !eixo
                ? "Escolha a lente que errou."
                : "Escreva o porquê."}
          </span>
        )}
      </div>
    </div>
  );
}
