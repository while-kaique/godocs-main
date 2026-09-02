import * as React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { FormGroup, FormLabel, FormSelect, FieldError } from "./form-components";
import { CampoData } from "@/components/calendario/calendario";
import { hojeIso } from "@/lib/calendario-datas";
import { TIPO_SAVING_LABEL } from "@/lib/projeto-rotulos";
import { GANHO_ROTULOS, TIPOS_RECEITA } from "@/lib/ganhos-rotulos";
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
import { CampoEvidencia } from "./campo-evidencia";
import { ListaItens, type RotulosLista } from "./lista-itens";
import { TabelaHoras } from "./tabela-horas";
import {
  adicionarLinhaHoras,
  atualizarLinhaHoras,
  removerLinhaHoras,
} from "./horas";
import { adicionarItem, atualizarItem, removerItem } from "./itens-lista";
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
  placeholderNome: "Ex: OpenAI API · GoDeploy · ElevenLabs",
  ariaNome: "Nome do item de custo para rodar",
  placeholderValor: "99,90",
  ariaValor: "Valor do item de custo para rodar",
  ariaFrequencia: "Frequência do custo para rodar",
  placeholderDescricao: "O que é isso? (ex: geração das respostas do agente)",
  ariaDescricao: "O que é este item de custo",
  ariaRemover: "Remover item de custo para rodar",
  botaoAdicionar: "Adicionar outro item",
};

function SeletorFrequencia({
  valor,
  onChange,
  erro,
  ariaLabel,
}: {
  valor: Frequencia | "";
  onChange: (v: Frequencia | "") => void;
  erro?: string;
  ariaLabel: string;
}) {
  return (
    <FormSelect
      aria-label={ariaLabel}
      value={valor}
      onChange={(e) => onChange(e.currentTarget.value as Frequencia | "")}
      error={erro}
    >
      <option value="">Selecione...</option>
      {(["mensal", "pontual", "trimestral", "semestral"] as Frequencia[]).map((f) => (
        <option key={f} value={f}>
          {TIPO_SAVING_LABEL[f]}
        </option>
      ))}
    </FormSelect>
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
  const hoje = hojeIso();
  const opts = React.useMemo(() => ({ hojeISO: hoje }), [hoje]);

  const [aberto, setAberto] = React.useState<string | null>(() => blocoInicial(blocos));

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

  function conteudoDe(categoria: GanhoCategoria): React.ReactNode {
    const rotulo = GANHO_ROTULOS[categoria];
    const rodape = (
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => avancarDe(categoria)}
          className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
          style={{ background: "rgba(0,89,169,0.08)", color: "var(--go-blue)" }}
        >
          Pronto, próximo
        </button>
      </div>
    );

    if (categoria === "saving_efetivado") {
      return (
        <div>
          <p className="mb-3 text-[12px]" style={{ color: "#7b7b8a" }}>
            {rotulo.descricao}
          </p>
          <FormGroup>
            <FormLabel required>Com que frequência esse valor deixou de sair?</FormLabel>
            <SeletorFrequencia
              ariaLabel="Frequência do saving efetivado"
              valor={dados.savingFrequencia}
              onChange={(v) => onChange({ savingFrequencia: v })}
              erro={errors.savingFrequencia}
            />
          </FormGroup>
          <FormGroup>
            <FormLabel required>Quanto era?</FormLabel>
            <CampoValor
              ariaLabel="Valor do saving efetivado"
              valor={dados.savingValor}
              onChange={(v) => onChange({ savingValor: v })}
              erro={errors.savingValor}
            />
          </FormGroup>
          <FormGroup>
            <FormLabel required hint="A partir de quando a empresa parou de pagar">
              Desde quando
            </FormLabel>
            <CampoData
              valor={dados.savingDesde}
              maximo={hoje}
              ariaLabel="Desde quando o saving vale"
              onChange={(iso) => onChange({ savingDesde: iso })}
              erro={errors.savingDesde}
            />
            <FieldError message={errors.savingDesde} />
          </FormGroup>
          <FormGroup>
            <FormLabel required hint="Onde isso pode ser conferido: extrato, fatura, contrato encerrado">
              Como se comprova
            </FormLabel>
            <CampoEvidencia
              texto={dados.savingEvidencia}
              anexos={dados.savingAnexos}
              onChangeTexto={(v) => onChange({ savingEvidencia: v })}
              onChangeAnexos={(v) => onChange({ savingAnexos: v })}
              erro={errors.savingEvidencia}
              placeholder="Ex: o contrato com a XPTO foi encerrado em maio; a fatura de junho já não tem a linha de R$ 1.200. Dá para conferir no financeiro, fornecedor XPTO."
            />
          </FormGroup>
          {rodape}
        </div>
      );
    }

    if (categoria === "custo_evitado") {
      return (
        <div>
          <p className="mb-3 text-[12px]" style={{ color: "#7b7b8a" }}>
            {rotulo.descricao}
          </p>
          <FormGroup>
            <FormLabel required>Com que frequência esse ganho acontece?</FormLabel>
            <SeletorFrequencia
              ariaLabel="Frequência do custo evitado"
              valor={dados.ceFrequencia}
              onChange={(v) => onChange({ ceFrequencia: v })}
              erro={errors.ceFrequencia}
            />
          </FormGroup>

          {/* Os DOIS braços somam antes do peso de 50%. Ter só um é caso normal, e a
              validação exige "ao menos um" — não os dois. */}
          <FormGroup>
            <FormLabel hint="Quem fazia o trabalho à mão e quanto tempo levava. Deixe em branco se não havia trabalho manual.">
              Horas liberadas
            </FormLabel>
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
          </FormGroup>

          <FormGroup>
            <FormLabel hint="A vaga que não foi aberta, a consultoria que não foi contratada. Deixe em branco se não houve.">
              Valor que não chegou a ser contratado
            </FormLabel>
            <CampoValor
              ariaLabel="Valor não contratado"
              valor={dados.ceNaoContratado}
              onChange={(v) => onChange({ ceNaoContratado: v })}
              erro={errors.ceNaoContratado}
            />
          </FormGroup>

          {/* O erro de "nenhum dos dois braços" fica ENTRE os dois campos que o
              resolvem, não no fim do bloco: no fim, a pessoa lê "informe as horas ou o
              valor" sem ver a qual par a frase se refere. */}
          <FieldError message={errors.ceBracos} />

          <FormGroup>
            <FormLabel required hint={`Pelo menos ${RACIONAL_MIN} caracteres`}>
              Por que essa despesa não aconteceu
            </FormLabel>
            <AreaTexto
              ariaLabel="Racional do custo evitado"
              valor={dados.ceRacional}
              onChange={(v) => onChange({ ceRacional: v })}
              erro={errors.ceRacional}
              placeholder="Ex: o volume dobrou em janeiro e teríamos aberto duas vagas de conferente; com o robô a equipe atual absorveu."
            />
          </FormGroup>
          {rodape}
        </div>
      );
    }

    if (categoria === "receita_incremental") {
      return (
        <div>
          <p className="mb-3 text-[12px]" style={{ color: "#7b7b8a" }}>
            {rotulo.descricao}
          </p>
          <FormGroup>
            <FormLabel required>Com que frequência essa receita entra?</FormLabel>
            <SeletorFrequencia
              ariaLabel="Frequência da receita incremental"
              valor={dados.receitaFrequencia}
              onChange={(v) => onChange({ receitaFrequencia: v })}
              erro={errors.receitaFrequencia}
            />
          </FormGroup>
          <FormGroup>
            <FormLabel required>Quanto</FormLabel>
            <CampoValor
              ariaLabel="Valor da receita incremental"
              valor={dados.receitaValor}
              onChange={(v) => onChange({ receitaValor: v })}
              erro={errors.receitaValor}
            />
          </FormGroup>
          <FormGroup>
            <FormLabel required>De onde vem</FormLabel>
            <FormSelect
              aria-label="Tipo de receita"
              value={dados.receitaTipo}
              onChange={(e) => onChange({ receitaTipo: e.currentTarget.value })}
              error={errors.receitaTipo}
            >
              <option value="">Selecione...</option>
              {TIPOS_RECEITA.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup>
            <FormLabel required hint={`Pelo menos ${RACIONAL_MIN} caracteres`}>
              Como esta solução gera essa receita
            </FormLabel>
            <AreaTexto
              ariaLabel="Racional da receita incremental"
              valor={dados.receitaRacional}
              onChange={(v) => onChange({ receitaRacional: v })}
              erro={errors.receitaRacional}
              placeholder="Ex: o fluxo recupera carrinhos abandonados por WhatsApp; antes de setembro ninguém fazia esse contato."
            />
          </FormGroup>
          {rodape}
        </div>
      );
    }

    // Imensurável — só o racional, pelo mesmo componente de evidência. Sem valor e sem
    // frequência: a categoria não tem número por definição, e o que a representa é a
    // estrela (D5/D8).
    return (
      <div>
        <p className="mb-3 text-[12px]" style={{ color: "#7b7b8a" }}>
          {rotulo.descricao}
        </p>
        <FormGroup>
          <FormLabel required hint="Diga o que mudou e o que teria acontecido sem isto">
            Qual é o ganho
          </FormLabel>
          <CampoEvidencia
            texto={dados.imensuravelRacional}
            anexos={dados.imensuravelAnexos}
            onChangeTexto={(v) => onChange({ imensuravelRacional: v })}
            onChangeAnexos={(v) => onChange({ imensuravelAnexos: v })}
            erro={errors.imensuravelRacional}
            placeholder="Ex: o robô confere 100% dos lançamentos antes do fechamento. Antes a conferência era por amostra e uma multa de ICMS passou batida em 2025."
            rotuloAnexo="Anexar ou colar print"
          />
        </FormGroup>
        {rodape}
      </div>
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
      <div className="mt-6 rounded-xl p-3.5" style={{ background: "var(--go-cream)" }}>
        <FormLabel hint="API, plataforma, licença: o que a empresa paga para esta solução continuar rodando. Deixe em branco se não há custo.">
          Custo para rodar
        </FormLabel>
        {soImensuravel ? (
          <p className="mb-1 text-[11.5px]" style={{ color: "#7b7b8a" }}>
            Registramos o custo, mas ele não entra em conta nenhuma neste projeto, porque
            o ganho aqui não tem número.
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

      {errors.ganhoCategorias ? (
        <div className="mt-4">
          <FieldError message={errors.ganhoCategorias} />
        </div>
      ) : null}

      <div className="mt-7 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onVoltar}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={{ color: "#6b6b7a", background: "rgba(0,0,0,0.04)" }}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Voltar
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors disabled:opacity-60"
          style={{ background: "var(--go-blue)" }}
        >
          {loading ? "Enviando..." : "Revisar e enviar"}
          {loading ? null : <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
