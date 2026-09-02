import * as React from "react";
import { cn } from "@/lib/utils";
import { FieldError, InfoTooltip } from "./form-components";
import { FREQUENCIA_ABAS, GANHO_ROTULOS } from "@/lib/ganhos-rotulos";
import { CATEGORIA_IMENSURAVEL, type GanhoCategoria } from "@/lib/ganhos";
import type { Frequencia } from "@/lib/impacto";
import { formatMoedaBR } from "./constants";
import type { FieldErrors } from "./constants";
import { Acordeao, type BlocoAcordeao } from "./acordeao";
import {
  alternarAberto,
  aoCompletar,
  blocoInicial,
  ordemBlocos,
} from "./acordeao-estado";
import { unidadeHoras } from "@/lib/projeto-rotulos";
import { hojeIso } from "@/lib/calendario-datas";
import { CampoEvidencia } from "./campo-evidencia";
import { ListaItens, type RotulosLista } from "./lista-itens";
import { TabelaHoras } from "./tabela-horas";
import {
  adicionarLinhaHoras,
  atualizarLinhaHoras,
  removerLinhaHoras,
} from "./horas";
import { adicionarItem, atualizarItem, itemVazio, removerItem } from "./itens-lista";
import {
  passosCustoEvitado,
  passosReceita,
  passosSaving,
  respostaCustoRodarInicial,
  type RespostaCustoRodar,
} from "./revelacao";
import {
  blocoCompleto,
  resumoBloco,
  RACIONAL_MIN,
  type GanhosFormData,
} from "./validacao-etapa3";

/**
 * ETAPA 3 (v2) — os blocos de ganho, num acordeão, sem agente.
 *
 * Substitui o `SavingForm` + `Step3Chat` da v1 (2800 linhas, das quais ~1330 do form),
 * onde a coleta do ganho era uma CONVERSA com 7 gates determinísticos por cima.
 *
 * A régua toda vive fora daqui, em módulos puros e testados: `validacao-etapa3.ts` (o que
 * cada bloco exige, o que o bloco resume, a tradução para o modelo da T3),
 * `acordeao-estado.ts` (qual bloco abre), `horas.ts`, `itens-lista.ts`, `evidencia.ts`.
 * O que sobra aqui é montagem — e é de propósito: neste repo o Vitest roda
 * `environment: 'node'`, então régua dentro do `.tsx` é régua sem teste.
 *
 * ⚠️ Nenhum R$ de HORA aparece nesta tela. A tabela de horas mostra horas; o R$ do braço
 * de horas é derivado no backend (`resolverValorHora`). Decisão da v1 que a v2 mantém:
 * mostrar valor/hora ao submissor induz manipulação do número.
 *
 * ⚠️ O bloco "custo para rodar" fica FORA do acordeão porque é perguntado a TODO projeto,
 * inclusive ao imensurável — mas, no imensurável, ele não entra em conta nenhuma
 * (`paraGanhosProjeto` deixa o custo de fora ali, senão o projeto sem número teria
 * impacto NEGATIVO e cairia abaixo de um projeto sem ganho algum).
 */
const ROTULOS_CUSTO_RODAR: RotulosLista = {
  colunaNome: "Item",
  placeholderNome: "Ex: OpenAI API · ElevenLabs",
  ariaNome: "Nome do item de custo para rodar",
  placeholderValor: "99,90",
  ariaValor: "Valor do item de custo para rodar",
  ariaFrequencia: "Frequência do custo para rodar",
  placeholderDescricao: "O que é isso? (ex: geração das respostas do agente)",
  ariaDescricao: "O que é este item de custo",
  ariaRemover: "Remover item de custo para rodar",
  botaoAdicionar: "Adicionar outro item",
};

/**
 * Cada resposta abre a próxima. A animação é a mesma `go-fade-in-up` da v1.
 *
 * ⚠️ `prefers-reduced-motion` já é neutralizado globalmente (`styles.css:209`), inclusive
 * para animação declarada em `style` inline — não precisa de guarda aqui.
 */
const REVELAR = { animation: "go-fade-in-up 0.35s ease both" } as const;

/**
 * O painel de um bloco — o cartão LIME da v1 (`step3-chat.tsx:1440`).
 *
 * A v2 tinha nascido com os campos soltos sobre branco, em azul: ficou uma tela de
 * formulário genérico. O lime é o que dizia "aqui se fala do GANHO" na v1, e o Luis pediu
 * essas cores de volta (02/09/2026). O verde escuro `#6b6e00` é o par legível do
 * `--go-lime` sobre claro (o lime puro reprova contraste em texto pequeno).
 */
const VERDE_TEXTO = "#6b6e00";

function PainelBloco({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="space-y-4 rounded-xl p-4"
      style={{
        background: "rgba(215,219,0,0.03)",
        border: "1.5px solid rgba(215,219,0,0.15)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Uma pergunta do painel: rótulo curto, ajuda de UMA linha e o campo.
 *
 * ⚠️ Texto ENXUTO é regra desta tela, não estilo: o rótulo pergunta, a ajuda desempata, e
 * a descrição longa da categoria já foi lida nos cards da Etapa 2 (`GANHO_ROTULOS`) — ela
 * era repetida aqui e virou parágrafo que ninguém lê.
 */
function Pergunta({
  titulo,
  ajuda,
  obrigatorio,
  children,
}: {
  titulo: React.ReactNode;
  ajuda?: React.ReactNode;
  obrigatorio?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={REVELAR}>
      <label
        className="mb-1.5 block text-[12px] font-semibold"
        style={{ color: "var(--go-text-heading)" }}
      >
        {titulo}
        {obrigatorio ? <span style={{ color: "#e53e3e" }}> *</span> : null}
      </label>
      {ajuda ? (
        <p className="mb-2 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
          {ajuda}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Par sim/não colado — o segmentado da v1 (`selectTinhaAntes` e irmãos).
 *
 * A11y: `role="radiogroup"` + `aria-checked`, e o estado não é só cor (o marcado fica
 * preenchido e em negrito). Foco de teclado visível pelo `focus-visible` do reset.
 */
function SimNao({
  valor,
  onChange,
  rotuloSim,
  rotuloNao,
  ariaLabel,
}: {
  valor: "sim" | "nao" | "";
  onChange: (v: "sim" | "nao") => void;
  rotuloSim: string;
  rotuloNao: string;
  ariaLabel: string;
}) {
  const opcoes: { v: "nao" | "sim"; lbl: string }[] = [
    { v: "nao", lbl: rotuloNao },
    { v: "sim", lbl: rotuloSim },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-0 overflow-hidden rounded-xl"
      style={{ border: "1.5px solid rgba(215,219,0,0.2)" }}
    >
      {opcoes.map(({ v, lbl }, i) => {
        const ativo = valor === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(v)}
            className={cn(
              "flex-1 py-2.5 text-[12.5px] transition-all",
              ativo ? "font-extrabold" : "font-semibold",
            )}
            style={{
              background: ativo ? VERDE_TEXTO : "transparent",
              color: ativo ? "#fff" : VERDE_TEXTO,
              borderRight: i === 0 ? "1px solid rgba(215,219,0,0.2)" : "none",
            }}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Frequência — as 4 ABAS lado a lado, como na v1 (NÃO um dropdown).
 *
 * ⚠️ Era um `FormSelect` e virou fileira de opções por decisão do Luis (02/09/2026): a
 * cadência é a escolha que muda o SIGNIFICADO do valor digitado logo abaixo (um número
 * "por mês" e o "acumulado do semestre" não são a mesma grandeza), e escolha assim fica
 * VISÍVEL, não escondida atrás de um clique. Não voltar ao dropdown.
 *
 * ⚠️ O desenho é o `.go-radio-label`/`.go-radio-checked` do design system (`styles.css`),
 * o mesmo retângulo de largura regular do resto do formulário — não um estilo novo
 * escrito aqui. Rótulos e ordem vêm da fonte única `FREQUENCIA_ABAS`.
 *
 * A11y: `<input type="radio">` de verdade (setas do teclado + leitor de tela), escondido
 * com `peer sr-only`, e o anel de foco acende no rótulo por `peer-focus-visible`. O
 * estado NUNCA é só cor — a opção marcada também fica em negrito.
 */
function SeletorFrequencia({
  valor,
  onChange,
  erro,
  ariaLabel,
  nome,
}: {
  valor: Frequencia | "";
  onChange: (v: Frequencia | "") => void;
  erro?: string;
  ariaLabel: string;
  /** Nome do grupo de rádio — único por bloco, senão as 3 fileiras viram um grupo só. */
  nome: string;
}) {
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {FREQUENCIA_ABAS.map(({ value, label }) => {
          const marcado = valor === value;
          return (
            <label
              key={value}
              className={cn(
                "go-radio-label cursor-pointer select-none",
                marcado && "go-radio-checked",
              )}
            >
              <input
                type="radio"
                name={nome}
                value={value}
                checked={marcado}
                onChange={() => onChange(value)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[inherit] peer-focus-visible:[box-shadow:0_0_0_3px_rgba(0,89,169,0.3)]"
              />
              <span className={marcado ? "font-extrabold" : undefined}>{label}</span>
            </label>
          );
        })}
      </div>
      {/* Trimestral/semestral coletam o valor CHEIO do período (sem ÷3/÷6) — a mesma
          decisão de produto da v1. Dizer isto aqui, no instante da escolha, é o que
          impede a pessoa de informar a média mensal num campo que soma o período. */}
      {(valor === "trimestral" || valor === "semestral") && (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
          Rotina a cada {valor === "trimestral" ? "3 meses" : "6 meses"}. Informe o valor{" "}
          <strong>
            acumulado do {valor === "trimestral" ? "trimestre" : "semestre"}
          </strong>{" "}
          (não a média por mês).
        </p>
      )}
      <FieldError message={erro} />
    </div>
  );
}

function CampoValor({
  valor,
  onChange,
  erro,
  ariaLabel,
  placeholder = "1.200,00",
}: {
  valor: string;
  onChange: (v: string) => void;
  erro?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold" style={{ color: "#8b8b9a" }}>
          R$
        </span>
        <input
          type="text"
          inputMode="numeric"
          aria-label={ariaLabel}
          aria-invalid={erro ? true : undefined}
          placeholder={placeholder}
          value={valor}
          onChange={(e) => onChange(formatMoedaBR(e.currentTarget.value))}
          className="go-input flex-1"
          style={{
            height: 40,
            padding: "0 10px",
            borderRadius: "var(--go-radius-md)",
            border: erro ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
            background: "var(--go-white)",
            fontSize: 14,
          }}
        />
      </div>
      <FieldError message={erro} />
    </>
  );
}

function AreaTexto({
  valor,
  onChange,
  erro,
  ariaLabel,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  erro?: string;
  ariaLabel: string;
  placeholder: string;
}) {
  return (
    <>
      <textarea
        aria-label={ariaLabel}
        aria-invalid={erro ? true : undefined}
        rows={3}
        value={valor}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        className="go-input w-full"
        style={{
          padding: "10px 12px",
          borderRadius: "var(--go-radius-md)",
          border: erro ? "1.5px solid #e53e3e" : "1.5px solid rgba(215,219,0,0.2)",
          background: "var(--go-white)",
          fontSize: 13,
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />
      <FieldError message={erro} />
    </>
  );
}

export function Step3Ganhos({
  categorias,
  dados,
  errors,
  onChange,
  onSubmit,
  onVoltar,
  loading,
}: {
  categorias: GanhoCategoria[];
  dados: GanhosFormData;
  errors: FieldErrors;
  onChange: (patch: Partial<GanhosFormData>) => void;
  onSubmit: () => void;
  onVoltar: () => void;
  loading: boolean;
}) {
  const blocos = React.useMemo(() => ordemBlocos(categorias), [categorias]);
  // ⚠️ `hojeISO` segue no parâmetro de `validarBloco`/`validarEtapa3` embora nenhuma régua
  // o consuma hoje: a única que dependia dele era o "desde quando" do saving (data no
  // futuro = projeção), campo que saiu em 02/09/2026 quando o valor virou o par
  // antes/agora. Mantido como em `validarEtapa2` e `demoSeedForm`, que fizeram a mesma
  // escolha ao perder a "data de criação" — o dia continua sendo injetado (nunca lido de
  // um `Date` interno), então uma régua de data que volte já nasce testável.
  const hoje = hojeIso();
  const opts = React.useMemo(() => ({ hojeISO: hoje }), [hoje]);

  const [aberto, setAberto] = React.useState<string | null>(() => blocoInicial(blocos));

  // "Tem custo para rodar?" — a pergunta que a v1 fazia antes de mostrar a lista. Vive
  // aqui, e não no modelo, porque "não tem" É a lista vazia (`GanhosDeclarados`): não há
  // campo novo a gravar. O valor inicial é DERIVADO do que já está preenchido
  // (`respostaCustoRodarInicial`), senão quem volta ao passo com itens digitados veria a
  // pergunta em branco e a própria lista escondida.
  const [temCustoRodar, setTemCustoRodar] = React.useState<RespostaCustoRodar>(() =>
    respostaCustoRodarInicial(dados.custoRodar),
  );

  // A seleção pode mudar na Etapa 2 e voltar para cá: se o bloco aberto deixou de existir
  // (ou nunca houve um), reabre o primeiro. Sem isto o acordeão fica todo fechado sem a
  // pessoa ter fechado nada.
  React.useEffect(() => {
    setAberto((atual) =>
      atual && (blocos as readonly string[]).includes(atual)
        ? atual
        : blocoInicial(blocos),
    );
  }, [blocos]);

  const completos = React.useMemo(
    () => blocos.filter((b) => blocoCompleto(b, dados, opts)),
    [blocos, dados, opts],
  );

  // Fecha o bloco que acabou de completar e abre o próximo PENDENTE. O disparo é o clique
  // no botão do bloco, não um efeito sobre `completos`: reagir à completude automática
  // fecharia o bloco no meio da digitação, no instante em que o último campo fica válido.
  function avancarDe(id: GanhoCategoria) {
    setAberto(aoCompletar(blocos, completos, id));
  }

  /**
   * O conteúdo de um bloco — perguntas REVELADAS uma a uma (`revelacao.ts`).
   *
   * ⚠️ A ordem é a da conta: primeiro a CADÊNCIA (ela muda o significado do número),
   * depois o número, depois a prova. Não reordenar para "pedir o valor logo" — foi a
   * cadência escolhida antes que fez a v1 nunca receber média mensal num campo de
   * período.
   */
  function conteudoDe(categoria: GanhoCategoria): React.ReactNode {
    // Só aparece quando a última pergunta do bloco já está na tela: botão de "próximo"
    // acima de perguntas ainda escondidas convida a pular o bloco pela metade.
    const rodape = (
      <div className="flex justify-end" style={REVELAR}>
        <button
          type="button"
          onClick={() => avancarDe(categoria)}
          className="rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-colors"
          style={{ background: "rgba(215,219,0,0.16)", color: VERDE_TEXTO }}
        >
          Pronto, próximo
        </button>
      </div>
    );

    if (categoria === "saving_efetivado") {
      const passos = passosSaving(dados);
      return (
        <PainelBloco>
          <Pergunta titulo="Com que frequência esse valor saía do caixa?" obrigatorio>
            <SeletorFrequencia
              ariaLabel="Frequência do saving efetivado"
              nome="freq-saving-efetivado"
              valor={dados.savingFrequencia}
              onChange={(v) => onChange({ savingFrequencia: v })}
              erro={errors.savingFrequencia}
            />
          </Pergunta>

          {/* ⚠️ O PAR antes/agora, lado a lado: o saving é a DIFERENÇA. Uma despesa pode
              ter caído de R$ 20k para R$ 5k, e aí o ganho são os R$ 15k — perguntar um
              valor só fazia o formulário aceitar 20k de saving num contrato que a empresa
              ainda paga. Quando a despesa acabou, "agora" é 0. */}
          {passos.valores ? (
            <Pergunta
              titulo="Quanto era e quanto é agora?"
              ajuda="O saving é a diferença entre os dois. Se a despesa acabou de vez, escreva 0 em “agora”."
              obrigatorio
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "#9a9aa8" }}
                  >
                    Antes
                  </span>
                  <CampoValor
                    ariaLabel="Quanto a empresa pagava antes"
                    valor={dados.savingValorAntes}
                    onChange={(v) => onChange({ savingValorAntes: v })}
                    erro={errors.savingValorAntes}
                    placeholder="20.000,00"
                  />
                </div>
                <div>
                  <span
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: "#9a9aa8" }}
                  >
                    Agora
                  </span>
                  <CampoValor
                    ariaLabel="Quanto a empresa paga agora"
                    valor={dados.savingValorAgora}
                    onChange={(v) => onChange({ savingValorAgora: v })}
                    erro={errors.savingValorAgora}
                    placeholder="5.000,00"
                  />
                </div>
              </div>
            </Pergunta>
          ) : null}

          {passos.evidencia ? (
            <Pergunta
              titulo="Como se comprova?"
              ajuda="Extrato, fatura ou contrato encerrado: diga onde alguém confere."
              obrigatorio
            >
              <CampoEvidencia
                texto={dados.savingEvidencia}
                anexos={dados.savingAnexos}
                onChangeTexto={(v) => onChange({ savingEvidencia: v })}
                onChangeAnexos={(v) => onChange({ savingAnexos: v })}
                erro={errors.savingEvidencia}
                placeholder="Ex: contrato com a XPTO renegociado em maio; a fatura de junho caiu de R$ 20.000 para R$ 5.000."
              />
            </Pergunta>
          ) : null}

          {passos.evidencia ? rodape : null}
        </PainelBloco>
      );
    }

    if (categoria === "custo_evitado") {
      const passos = passosCustoEvitado(dados);
      return (
        <PainelBloco>
          <Pergunta titulo="Com que frequência esse ganho acontece?" obrigatorio>
            <SeletorFrequencia
              ariaLabel="Frequência do custo evitado"
              nome="freq-custo-evitado"
              valor={dados.ceFrequencia}
              onChange={(v) => onChange({ ceFrequencia: v })}
              erro={errors.ceFrequencia}
            />
          </Pergunta>

          {/* Os DOIS braços aparecem juntos: eles somam, e ter só um é o caso normal
              (a validação exige ao menos um, nunca os dois). */}
          {passos.bracos ? (
            <>
              <Pergunta
                titulo={`Horas liberadas (${unidadeHoras(dados.ceFrequencia || "mensal")})`}
                ajuda="Quem fazia à mão e quanto tempo levava. Em branco se não havia trabalho manual."
              >
                <TabelaHoras
                  linhas={dados.ceLinhas}
                  frequencia={dados.ceFrequencia}
                  errors={errors}
                  onAdicionar={() => onChange({ ceLinhas: adicionarLinhaHoras(dados.ceLinhas) })}
                  onRemover={(i) => onChange({ ceLinhas: removerLinhaHoras(dados.ceLinhas, i) })}
                  onAtualizar={(i, patch) =>
                    onChange({ ceLinhas: atualizarLinhaHoras(dados.ceLinhas, i, patch) })
                  }
                />
              </Pergunta>

              {/* ⚠️ A explicação vive num "izinho" (pedido do Luis): como AJUDA fixa
                  embaixo do rótulo ela competia com o rótulo e a pergunta ficava
                  confusa. O gatilho é o mesmo `InfoTooltip` da tabela de horas — hover E
                  foco de teclado. */}
              <Pergunta
                titulo={
                  <span className="inline-flex items-center gap-1.5">
                    Valor que não chegou a ser contratado
                    <InfoTooltip
                      largura={280}
                      ariaLabel="O que entra em valor que não chegou a ser contratado"
                    >
                      A <strong>vaga que não foi aberta</strong>, a{" "}
                      <strong>consultoria que não foi contratada</strong>. Deixe em branco
                      se não houve.
                    </InfoTooltip>
                  </span>
                }
              >
                <CampoValor
                  ariaLabel="Valor não contratado"
                  valor={dados.ceNaoContratado}
                  onChange={(v) => onChange({ ceNaoContratado: v })}
                  erro={errors.ceNaoContratado}
                />
              </Pergunta>

              {/* O erro de "nenhum dos dois braços" fica ENTRE os dois campos que o
                  resolvem: no fim do bloco, a frase não diz a qual par se refere. */}
              <FieldError message={errors.ceBracos} />
            </>
          ) : null}

          {passos.racional ? (
            <Pergunta
              titulo="Por que essa despesa não aconteceu?"
              ajuda={`Pelo menos ${RACIONAL_MIN} caracteres`}
              obrigatorio
            >
              <AreaTexto
                ariaLabel="Racional do custo evitado"
                valor={dados.ceRacional}
                onChange={(v) => onChange({ ceRacional: v })}
                erro={errors.ceRacional}
                placeholder="Ex: o volume dobrou em janeiro e teríamos aberto duas vagas de conferente; com o robô a equipe atual absorveu."
              />
            </Pergunta>
          ) : null}

          {passos.racional ? rodape : null}
        </PainelBloco>
      );
    }

    if (categoria === "receita_incremental") {
      const passos = passosReceita(dados);
      return (
        <PainelBloco>
          {/* ⚠️ Este bloco é o da PROD, campo a campo (pedido do Luis, 02/09/2026):
              frequência do ganho · quanto de receita nova · racional em uma frase. A
              única coisa que muda é o racional aceitar anexo/print, que na v1 era função
              do chat. NÃO reintroduzir o "de onde vem esse dinheiro" com lista de
              opções — foi invenção minha e saiu. */}
          <Pergunta titulo="Frequência do ganho" obrigatorio>
            <SeletorFrequencia
              ariaLabel="Frequência da receita incremental"
              nome="freq-receita-incremental"
              valor={dados.receitaFrequencia}
              onChange={(v) => onChange({ receitaFrequencia: v })}
              erro={errors.receitaFrequencia}
            />
          </Pergunta>

          {passos.valor ? (
            <Pergunta
              titulo="Ganho de receita"
              ajuda="Quanto de receita NOVA o projeto gera no período que você marcou acima."
              obrigatorio
            >
              <CampoValor
                ariaLabel="Valor da receita incremental"
                valor={dados.receitaValor}
                onChange={(v) => onChange({ receitaValor: v })}
                erro={errors.receitaValor}
              />
            </Pergunta>
          ) : null}

          {passos.racional ? (
            <Pergunta
              titulo="Racional"
              ajuda={
                <>
                  Em uma frase, de onde vem essa receita e como o número foi apurado. Ex.:{" "}
                  <em>as estampas geradas com IA vendem esse valor por mês</em>.
                </>
              }
              obrigatorio
            >
              <CampoEvidencia
                texto={dados.receitaRacional}
                anexos={dados.receitaAnexos}
                onChangeTexto={(v) => onChange({ receitaRacional: v })}
                onChangeAnexos={(v) => onChange({ receitaAnexos: v })}
                erro={errors.receitaRacional}
                placeholder="Ex: o fluxo recupera carrinhos abandonados por WhatsApp; antes de setembro ninguém fazia esse contato. Base: relatório de vendas recuperadas."
                rotuloAnexo="Anexar ou colar print"
              />
            </Pergunta>
          ) : null}

          {passos.racional ? rodape : null}
        </PainelBloco>
      );
    }

    // Imensurável — uma pergunta só, pelo mesmo componente de evidência. Sem valor e sem
    // frequência: a categoria não tem número por definição, e o que a representa é a
    // estrela (D5/D8). Aqui não há o que revelar em passos.
    return (
      <PainelBloco>
        <Pergunta
          titulo="Qual é o ganho?"
          ajuda="Diga o que mudou e o que teria acontecido sem isto."
          obrigatorio
        >
          <CampoEvidencia
            texto={dados.imensuravelRacional}
            anexos={dados.imensuravelAnexos}
            onChangeTexto={(v) => onChange({ imensuravelRacional: v })}
            onChangeAnexos={(v) => onChange({ imensuravelAnexos: v })}
            erro={errors.imensuravelRacional}
            placeholder="Ex: o robô confere 100% dos lançamentos antes do fechamento. Antes era por amostra e uma multa de ICMS passou batida em 2025."
            rotuloAnexo="Anexar ou colar print"
          />
        </Pergunta>
        {rodape}
      </PainelBloco>
    );
  }

  const blocosAcordeao: BlocoAcordeao[] = blocos.map((categoria) => ({
    id: categoria,
    titulo: GANHO_ROTULOS[categoria].titulo,
    resumo: resumoBloco(categoria, dados),
    completo: completos.includes(categoria),
    conteudo: conteudoDe(categoria),
  }));

  const soImensuravel = blocos.length === 1 && blocos[0] === CATEGORIA_IMENSURAVEL;

  return (
    <div className="px-6 py-6 sm:px-8">
      <h2 className="text-[17px] font-bold" style={{ color: "var(--go-text-primary)" }}>
        O ganho deste projeto
      </h2>
      <p className="mt-1 mb-5 text-[12.5px]" style={{ color: "#7b7b8a" }}>
        Um bloco por tipo de ganho que você marcou. Complete um e o próximo abre.
      </p>

      <Acordeao
        blocos={blocosAcordeao}
        aberto={aberto}
        onAlternar={(id) => setAberto((atual) => alternarAberto(atual, id))}
      />

      {/* ── Custo para rodar — fora do acordeão, perguntado a todos ────────────────
          É a FUSÃO das duas linhas de custo da v1 (`custo_externo_mensal`, a plataforma
          onde a solução roda, e `custo_projeto_itens`, API/SaaS por uso), que
          economicamente sempre foram a mesma coisa e que ninguém distinguia (D3). */}
      <div className="mt-5">
        <PainelBloco>
          <Pergunta
            titulo="Esta solução tem algum custo para rodar?"
            ajuda="API, plataforma, licença: o que a empresa paga para ela continuar de pé."
            obrigatorio
          >
            <SimNao
              ariaLabel="Esta solução tem custo para rodar?"
              valor={temCustoRodar}
              rotuloNao="Não tem custo"
              rotuloSim="Sim, tem custo"
              onChange={(v) => {
                setTemCustoRodar(v);
                // "Não" LIMPA a lista: uma linha em branco é o que a validação ignora
                // (`itemEmBranco`), então responder "não" depois de ter digitado algo
                // não pode deixar um custo fantasma abatendo o ganho.
                if (v === "nao") onChange({ custoRodar: [itemVazio()] });
              }}
            />
          </Pergunta>

          {temCustoRodar === "sim" ? (
            <div style={REVELAR}>
              {soImensuravel ? (
                <p className="mb-2 text-[11px] leading-snug" style={{ color: "#8b8b9a" }}>
                  Registramos o custo, mas ele não entra em conta nenhuma aqui: o ganho
                  deste projeto não tem número.
                </p>
              ) : null}
              <ListaItens
                itens={dados.custoRodar}
                errors={errors}
                prefixoErro="cr"
                rotulos={ROTULOS_CUSTO_RODAR}
                onAdicionar={() => onChange({ custoRodar: adicionarItem(dados.custoRodar) })}
                onRemover={(i) => onChange({ custoRodar: removerItem(dados.custoRodar, i) })}
                onAtualizar={(i, patch) =>
                  onChange({ custoRodar: atualizarItem(dados.custoRodar, i, patch) })
                }
              />
            </div>
          ) : null}
        </PainelBloco>
      </div>

      {errors.ganhoCategorias ? (
        <div className="mt-4">
          <FieldError message={errors.ganhoCategorias} />
        </div>
      ) : null}

      {/* Navegação — as MESMAS pílulas das outras etapas (`.go-btn-back` / `.go-btn-next`,
          styles.css). Estes botões estavam com estilo próprio (retângulo cinza + azul),
          e etapa nenhuma do wizard tem botão assim: a Etapa 3 só desenha os seus aqui
          porque ela fica fora da barra de navegação de `submeter.tsx`, não porque seja
          outra linguagem visual. */}
      <div className="mt-7 flex items-center justify-between gap-3">
        <button type="button" onClick={onVoltar} disabled={loading} className="go-btn-back">
          &larr; Voltar
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className="go-btn-next inline-flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span>Enviando…</span>
              <div className="go-spinner" />
            </>
          ) : (
            <span>Revisar e enviar &rarr;</span>
          )}
        </button>
      </div>
    </div>
  );
}
