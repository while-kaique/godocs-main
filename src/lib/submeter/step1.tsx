import { useEffect, useMemo } from "react";
import {
  FERRAMENTAS, FERRAMENTAS_OPCOES, FERRAMENTA_OUTROS, limiteFerramentaOutra,
} from "./constants";
import type { FormData, FieldErrors, PapelParticipante } from "./constants";
import {
  SectionTitle, FormGroup, FormLabel, FormInput,
  RadioGroup, GridCheckboxGroup, InfoTooltip, ParticipantesPapeisInput, LegendaPapeis,
} from "./form-components";
import { useSugestoesParticipantes, prefetchSugestoesParticipantes } from "./participantes-sugestoes";

export function Step1({
  form, errors, updateField, setError, clearError, readOnlyProjeto,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  setError: (key: string, msg: string) => void;
  clearError: (key: string) => void;
  // Edição: escopo e status viram REFERÊNCIA read-only; ferramenta/serviço externo e
  // participantes/papéis (com o toggle "em equipe") permanecem editáveis — a stack de um
  // projeto muda de verdade depois de submetido. A submissão NOVA não passa esta prop →
  // formulário completo editável, comportamento inalterado.
  readOnlyProjeto?: boolean;
}) {
  const isExterno = form.escopo === "externo";
  const escopoDefinido = form.escopo === "interno" || form.escopo === "externo";
  const prodBlocked = form.prodStatus === "dev" || form.prodStatus === "idle";

  // Lista da TeamGuide para o autocomplete de participantes (carrega 1x, só
  // quando o campo aparece; falha → campo segue aceitando e-mail digitado).
  const { pessoas: sugestoesParticipantes, loading: sugestoesLoading } =
    useSugestoesParticipantes(form.emEquipe === "sim");
  // Aquece a lista assim que a Etapa 1 monta — antes mesmo de marcar "em equipe" —
  // para o autocomplete já estar pronto quando o usuário começar a digitar.
  useEffect(() => { prefetchSugestoesParticipantes(); }, []);

  const prodLabel = isExterno
    ? "Essa ferramenta externa já está em uso na solução?"
    : "Este projeto já está em produção?";

  const prodTooltip = isExterno ? (
    <>
      <strong className="mb-0.5 block text-white">Apenas soluções em uso</strong>
      A ferramenta externa precisa estar{" "}
      <em className="not-italic font-bold" style={{ color: "var(--go-lime)" }}>ativa e sendo utilizada</em>{" "}
      na solução, com engajamento real de usuários ou processos.
    </>
  ) : (
    <>
      <strong className="mb-0.5 block text-white">Somente projetos em produção</strong>
      O projeto precisa estar{" "}
      <em className="not-italic font-bold" style={{ color: "var(--go-lime)" }}>ativo e sendo utilizado</em>{" "}
      no dia a dia, com engajamento real de usuários ou processos.
    </>
  );

  const prodOptions = isExterno
    ? [
        { value: "sim",  label: "🟢 Sim, já está em uso" },
        { value: "dev",  label: "🔧 Não, ainda está sendo configurado" },
        { value: "idle", label: "⏸️ Está pronta, mas ainda não é utilizada" },
      ]
    : [
        { value: "sim",  label: "🟢 Sim, já está em produção e sendo utilizado" },
        { value: "dev",  label: "🔧 Não, ainda está sendo desenvolvido" },
        { value: "idle", label: "⏸️ Está pronto, mas ainda não é utilizado" },
      ];

  function addParticipant(email: string): boolean {
    const lower = email.toLowerCase();
    if (form.participantes.some((p) => p.toLowerCase() === lower)) return false;
    // Papel começa vazio (obrigatório escolher) — não pré-classifica ninguém.
    updateField("participantes", [...form.participantes, email]);
    return true;
  }

  function removeParticipant(email: string) {
    updateField("participantes", form.participantes.filter((p) => p !== email));
    const { [email]: _removido, ...resto } = form.participantesPapeis;
    updateField("participantesPapeis", resto);
  }

  function setPapelParticipant(email: string, papel: PapelParticipante) {
    updateField("participantesPapeis", { ...form.participantesPapeis, [email]: papel });
    clearError("participantes");
  }

  // Bloco de identidade (autor) — read-only, comum aos dois modos. A conta logada
  // (Godeploy) preenche nome + e-mail; sinalizado por ícone + texto (não só cor).
  const blocoIdentidade = (
    <FormGroup>
      {form.email ? (
        <div
          className="flex items-center gap-3 rounded-xl px-3.5 py-3"
          style={{ background: "rgba(0,89,169,0.05)", border: "1px solid rgba(0,89,169,0.15)" }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px]"
            style={{ background: "rgba(0,89,169,0.1)" }}
            aria-hidden="true"
          >
            👤
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--go-blue)" }}>
              Submetendo como
            </div>
            <div className="truncate text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
              {form.nome || form.email}
            </div>
            {form.nome && (
              <div className="truncate text-[11px]" style={{ color: "#8b8b9a" }}>
                {form.email}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-xl px-3.5 py-3 text-[12px] leading-relaxed"
          style={{ background: "rgba(215,219,0,0.07)", border: "1px solid rgba(215,219,0,0.3)", color: "#8a7d00" }}
        >
          <span aria-hidden="true">⚠️</span>
          <span>
            Não foi possível identificar sua conta automaticamente. Recarregue a página
            ou entre novamente; sua identidade é obtida do login da plataforma.
          </span>
        </div>
      )}
    </FormGroup>
  );

  // Opções do seletor = a lista canônica + qualquer valor LEGADO que o projeto já
  // carrega e não está nela ("Power Automate", "VBA"… importados da planilha). Sem esse
  // acréscimo o chip do valor atual simplesmente não existiria e a pessoa acharia que o
  // dado sumiu na edição — era o papel da `<option>` extra do antigo `<select>`.
  // ⚠️ Desmarcar um chip legado o remove de vez (não volta à lista): é a leitura correta
  // de "não é isso", e a pessoa pode reescrevê-lo em "Outros".
  const opcoesFerramentas = useMemo(() => {
    const extras = (form.ferramentas ?? [])
      .filter((f) => !FERRAMENTAS.includes(f))
      .map((f) => ({ value: f }));
    return [...FERRAMENTAS_OPCOES, ...extras];
  }, [form.ferramentas]);

  // Bloco da ferramenta / serviço externo — EDITÁVEL nos dois modos. Na edição, a
  // stack de um projeto muda de verdade (ex.: hospedagem Vercel → GoDeploy) e a pessoa
  // precisa corrigir sem abrir chamado; o ESCOPO (interna/externa) segue fixo, porque
  // trocá-lo muda a regra financeira (custo externo) — por isso só o campo do escopo
  // vigente aparece aqui.
  const blocoFerramenta = (
    <FormGroup>
      {isExterno ? (
        <>
          <FormLabel required>Serviço Externo Contrato</FormLabel>
          {readOnlyProjeto && (
            <p className="mb-1.5 text-[11px] leading-relaxed" style={{ color: "#8b8b9a" }}>
              Trocou de serviço desde a submissão? Atualize aqui.
            </p>
          )}
          <FormInput
            type="text"
            placeholder="Ex: Zapier, Make, HubSpot, Salesforce..."
            maxLength={200} /* = `servico_externo` no schema */
            value={form.servicoExterno}
            onChange={(e) => updateField("servicoExterno", e.currentTarget.value)}
            error={errors.servicoExterno}
          />
        </>
      ) : (
        <>
          <FormLabel required>Ferramentas utilizadas</FormLabel>
          {/* A frase que separa CONSTRUÇÃO de EXECUÇÃO. Antes não existia e a lista era
              lida como "a stack do projeto", então vinha Supabase/APIs no campo — isso é
              conteúdo da DOCUMENTAÇÃO. ⚠️ NÃO explicar aqui que o GoDeploy é a exceção da
              regra (pedido do Luis, 12/08/2026: "ninguém precisa saber disso") — a exceção
              é decisão interna, e citá-la só convida a pessoa a discutir a régua. */}
          <p className="mb-2 text-[11.5px] leading-relaxed" style={{ color: "#8b8b9a" }}>
            Marque tudo que você usou para{" "}
            <strong style={{ color: "var(--go-text-primary)" }}>construir</strong> o projeto. O
            que ele usa para{" "}
            <strong style={{ color: "var(--go-text-primary)" }}>funcionar</strong> (Supabase,
            APIs, integrações) fica na documentação.
            {readOnlyProjeto && " Mudou desde a submissão? Atualize aqui."}
          </p>
          <GridCheckboxGroup
            ariaLabel="Ferramentas utilizadas para construir o projeto"
            options={opcoesFerramentas}
            value={form.ferramentas ?? []}
            onChange={(v) => { updateField("ferramentas", v); clearError("ferramentas"); }}
            error={errors.ferramentas}
          />
          {/* Ajuda das 3 superfícies do Claude — LOGO ABAIXO da grade, alinhada à esquerda
              (ou seja, embaixo da coluna dos Claudes), porque é ali que a dúvida nasce. Vem
              como PERGUNTA visível em vez do ícone "i": ninguém vai caçar um ícone para
              descobrir uma diferença que nem sabe que existe. Abre no hover E no foco de
              teclado (o gatilho é o mesmo span do InfoTooltip). */}
          <div className="mt-2">
            <InfoTooltip
              largura={370}
              trigger={<>Qual a diferença entre os 3 Claudes?</>}
            >
              <strong className="mb-1.5 block text-white">
                Os 3 são o mesmo Claude, em lugares diferentes
              </strong>
              <span className="mb-1.5 block" style={{ color: "rgba(255,255,255,0.88)" }}>
                <strong style={{ color: "var(--go-lime)" }}>Claude AI</strong> — o Claude no
                navegador. Você conversa, cola texto ou planilha e pede análise, rascunho ou um
                trecho de código para copiar na mão.
              </span>
              <span className="mb-1.5 block" style={{ color: "rgba(255,255,255,0.88)" }}>
                <strong style={{ color: "var(--go-lime)" }}>Claude Cowork</strong> — o Claude
                trabalhando sobre os seus arquivos e ferramentas conectadas: você delega uma
                tarefa de várias etapas e acompanha ele executando. Não precisa ser código.
              </span>
              <span className="block" style={{ color: "rgba(255,255,255,0.88)" }}>
                <strong style={{ color: "var(--go-lime)" }}>Claude Code</strong> — o Claude
                dentro do terminal ou da IDE, lendo e editando o código do projeto direto no
                repositório.
              </span>
            </InfoTooltip>
          </div>
          {(form.ferramentas ?? []).includes(FERRAMENTA_OUTROS) && (
            <div className="mt-2.5" style={{ animation: "go-slide-down 0.25s ease" }}>
              <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
                ✏️ Especifique a ferramenta:
              </label>
              <FormInput
                placeholder="Nome da ferramenta..."
                /* Cap DINÂMICO: o que sobra dos 200 chars de `ferramenta` depois das
                   outras marcadas. Um cap fixo (era 192) voltaria a estourar o zod
                   depois de tudo preenchido — ver limiteFerramentaOutra. */
                maxLength={limiteFerramentaOutra(form.ferramentas ?? [])}
                value={form.ferramentaOutra}
                onChange={(e) => updateField("ferramentaOutra", e.currentTarget.value)}
                error={errors.ferramentaOutra}
                className="!border-[rgba(215,219,0,0.35)] focus:!border-[#b8a600] focus:!shadow-[0_0_0_3px_rgba(215,219,0,0.08)]"
              />
            </div>
          )}
        </>
      )}
    </FormGroup>
  );

  // Bloco de participantes + papéis — EDITÁVEL nos dois modos (é o foco da edição).
  const blocoParticipantes = (
    <FormGroup>
      <FormLabel required>Projeto desenvolvido em equipe?</FormLabel>
      <RadioGroup
        name="emEquipe"
        value={form.emEquipe}
        onChange={(v) => updateField("emEquipe", v as FormData["emEquipe"])}
        error={errors.emEquipe}
        options={[
          { value: "sim", label: "👥 Sim, em equipe" },
          { value: "nao", label: "👤 Não, individual" },
        ]}
      />
      {form.emEquipe === "sim" && (
        <div className="mt-2.5" style={{ animation: "go-slide-down 0.25s ease" }}>
          <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
            👥 Participantes e seus papéis:
          </label>
          <ParticipantesPapeisInput
            participantes={form.participantes}
            papeis={form.participantesPapeis}
            onAdd={addParticipant}
            onRemove={removeParticipant}
            onSetPapel={setPapelParticipant}
            error={errors.participantes}
            suggestions={sugestoesParticipantes}
            loadingSuggestions={sugestoesLoading}
          />
          <LegendaPapeis />
        </div>
      )}
    </FormGroup>
  );

  // ── Modo EDIÇÃO: dados do projeto como referência read-only; foco em participantes ──
  if (readOnlyProjeto) {
    const escopoLabel =
      form.escopo === "externo" ? "Externa" : form.escopo === "interno" ? "Interna" : "—";
    const statusLabel =
      form.prodStatus === "sim"
        ? isExterno ? "Em uso" : "Em produção"
        : form.prodStatus === "dev"
          ? isExterno ? "Em configuração" : "Em desenvolvimento"
          : form.prodStatus === "idle"
            ? "Pronto, sem uso"
            : "—";
    // A ferramenta SAIU desta lista (virou campo editável abaixo) — só escopo e status
    // continuam fixos na edição.
    const linhasProjeto = [
      { rotulo: "Escopo", valor: escopoLabel },
      { rotulo: "Status", valor: statusLabel },
    ];

    return (
      <div>
        <div
          className="relative mb-6 rounded-xl p-4"
          style={{ background: "rgba(0,89,169,0.05)", border: "1px solid rgba(0,89,169,0.15)" }}
        >
          <div
            className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--go-blue)" }}
          >
            <span aria-hidden="true">🔒</span> Dados do projeto · somente leitura
          </div>
          <dl className="flex flex-col gap-2.5">
            {linhasProjeto.map((it) => (
              <div key={it.rotulo} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-[11px] font-semibold" style={{ color: "var(--go-text-primary)" }}>
                  {it.rotulo}
                </dt>
                <dd className="truncate text-right text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
                  {it.valor}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "#8b8b9a" }}>
            Na edição, estes dados ficam fixos. Abaixo você ajusta a ferramenta, os
            participantes e seus papéis.
          </p>
        </div>

        {blocoIdentidade}
        {blocoFerramenta}
        {blocoParticipantes}
      </div>
    );
  }

  // ── Modo SUBMISSÃO NOVA: formulário completo editável (comportamento inalterado) ──
  return (
    <div>
      {/* ── Gate de Escopo ── */}
      <div
        className="relative mb-6 rounded-xl p-4"
        style={{ background: "rgba(199,233,253,0.3)", border: "1px solid rgba(0,89,169,0.08)" }}
      >
        <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
          Esta solução é interna ou externa?
          <InfoTooltip>
            <strong className="mb-1 block text-white">Interna vs. Externa</strong>
            <span className="block mb-2" style={{ color: "rgba(255,255,255,0.85)" }}>
              <strong style={{ color: "var(--go-lime)" }}>Interna</strong> — construída com nossos próprios recursos
              (Claude, Codex, Office, Python, n8n etc.). Custo zero de licença externa.
            </span>
            <span className="block" style={{ color: "rgba(255,255,255,0.85)" }}>
              <strong style={{ color: "var(--go-lime)" }}>Externa</strong> — usa um serviço de terceiros com custo
              recorrente (SaaS, API paga, plataforma externa). O custo entra no cálculo de saving líquido.
            </span>
          </InfoTooltip>
        </div>

        <RadioGroup
          name="escopo"
          value={form.escopo}
          onChange={(v) => {
            updateField("escopo", v as FormData["escopo"]);
            // Resetar campos dependentes ao trocar escopo
            updateField("prodStatus", "");
            updateField("ferramentas", []);
            updateField("ferramentaOutra", "");
            updateField("servicoExterno", "");
          }}
          error={errors.escopo}
          options={[
            { value: "interno", label: "🏠 Interna" },
            { value: "externo", label: "🌐 Externa" },
          ]}
        />

        {form.escopo === "externo" && (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs"
            style={{ background: "rgba(0,89,169,0.04)", border: "1px solid rgba(0,89,169,0.1)", color: "var(--go-text-primary)", animation: "go-slide-down 0.25s ease" }}
          >
            <span className="mt-px shrink-0">💡</span>
            <span>O custo mensal da ferramenta externa será informado na etapa de Análise de Impacto e será abatido do ganho calculado.</span>
          </div>
        )}
      </div>

      {/* ── Resto do Step 1 (só aparece após escolher escopo) ── */}
      {escopoDefinido && (
        <div style={{ animation: "go-slide-down 0.3s ease" }}>
          {/* Gate de Produção / Uso */}
          <div
            className="relative mb-6 rounded-xl p-4"
            style={{ background: "rgba(199,233,253,0.3)", border: "1px solid rgba(0,89,169,0.08)" }}
          >
            <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
              {prodLabel}
              <InfoTooltip>{prodTooltip}</InfoTooltip>
            </div>

            <RadioGroup
              name="prodStatus"
              value={form.prodStatus}
              onChange={(v) => updateField("prodStatus", v as FormData["prodStatus"])}
              error={errors.prodStatus}
              vertical
              options={prodOptions}
            />

            {prodBlocked && (
              <div
                className="mt-3.5 rounded-lg p-3.5"
                style={{ background: "rgba(220,38,38,0.03)", border: "1px solid rgba(220,38,38,0.12)", animation: "go-slide-down 0.3s ease" }}
              >
                <div className="mb-1.5 text-xl">🚫</div>
                <div className="mb-1 text-[13px] font-bold" style={{ color: "#dc2626" }}>
                  Submissão não permitida neste momento
                </div>
                <div className="text-xs leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
                  {isExterno ? (
                    form.prodStatus === "dev" ? (
                      <>Ferramentas externas <strong style={{ color: "#dc2626" }}>ainda em configuração</strong> não podem ser submetidas.</>
                    ) : (
                      <>Ferramentas externas prontas mas <strong style={{ color: "#dc2626" }}>sem utilização ativa</strong> não podem ser submetidas.</>
                    )
                  ) : (
                    form.prodStatus === "dev" ? (
                      <>Projetos <strong style={{ color: "#dc2626" }}>ainda em desenvolvimento</strong> não podem ser submetidos.</>
                    ) : (
                      <>Projetos prontos mas <strong style={{ color: "#dc2626" }}>sem utilização ativa</strong> não podem ser submetidos.</>
                    )
                  )}
                </div>
              </div>
            )}

            {form.prodStatus === "sim" && (
              <div
                className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold"
                style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)", color: "#16a34a", animation: "go-slide-down 0.25s ease" }}
              >
                ✅ Ótimo! Prossiga com o preenchimento abaixo.
              </div>
            )}
          </div>

          <SectionTitle icon="👤">Dados do Responsável</SectionTitle>

          {/* Identidade automática: nome + e-mail vêm da conta logada (Godeploy),
              não são mais perguntados. Bloco read-only — sinalizado por ícone +
              texto (não só cor), respeitando a11y. */}
          {blocoIdentidade}

          {blocoFerramenta}

          {blocoParticipantes}
        </div>
      )}
    </div>
  );
}
