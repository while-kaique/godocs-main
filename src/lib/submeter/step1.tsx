import { useEffect } from "react";
import { FERRAMENTAS } from "./constants";
import type { FormData, FieldErrors, PapelParticipante } from "./constants";
import {
  SectionTitle, FormGroup, FormLabel, FormInput, FormSelect,
  RadioGroup, InfoTooltip, ParticipantesPapeisInput, LegendaPapeis,
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
  // Edição: os dados do projeto (escopo/status/ferramenta) viram REFERÊNCIA read-only;
  // só participantes/papéis (e o toggle "em equipe") permanecem editáveis. A submissão
  // NOVA não passa esta prop → formulário completo editável, comportamento inalterado.
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
    const ferramentaLabel = isExterno
      ? (form.servicoExterno || "—")
      : form.ferramenta === "Outros"
        ? (form.ferramentaOutra || "Outros")
        : (form.ferramenta || "—");
    const linhasProjeto = [
      { rotulo: "Escopo", valor: escopoLabel },
      { rotulo: isExterno ? "Serviço externo" : "Ferramenta", valor: ferramentaLabel },
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
            Na edição, estes dados ficam fixos. Aqui você ajusta os participantes e seus papéis.
          </p>
        </div>

        {blocoIdentidade}
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
            updateField("ferramenta", "");
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

          <FormGroup>
            {isExterno ? (
                <>
                  <FormLabel required>Serviço Externo Contrato</FormLabel>
                  <FormInput
                    type="text"
                    placeholder="Ex: Zapier, Make, HubSpot, Salesforce..."
                    value={form.servicoExterno}
                    onChange={(e) => updateField("servicoExterno", e.currentTarget.value)}
                    error={errors.servicoExterno}
                  />
                </>
              ) : (
                <>
                  <FormLabel required>Ferramenta Utilizada</FormLabel>
                  <FormSelect
                    value={form.ferramenta}
                    onChange={(e) => updateField("ferramenta", e.currentTarget.value)}
                    error={errors.ferramenta}
                  >
                    <option value="">Selecione a ferramenta</option>
                    {FERRAMENTAS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </FormSelect>
                  {form.ferramenta === "Outros" && (
                    <div className="mt-2.5" style={{ animation: "go-slide-down 0.25s ease" }}>
                      <label className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#8a7d00" }}>
                        ✏️ Especifique a ferramenta:
                      </label>
                      <FormInput
                        placeholder="Nome da ferramenta..."
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

          {blocoParticipantes}
        </div>
      )}
    </div>
  );
}
