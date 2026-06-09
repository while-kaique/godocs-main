import React from "react";
import { AREAS, FERRAMENTAS } from "./constants";
import type { FormData, FieldErrors } from "./constants";
import {
  SectionTitle, FormGroup, FormLabel, FormInput, FormSelect,
  RadioGroup, InfoTooltip, ChipsInput,
} from "./form-components";

export function Step1({
  form, errors, updateField, setError, clearError,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  setError: (key: string, msg: string) => void;
  clearError: (key: string) => void;
}) {
  const isExterno = form.escopo === "externo";
  const escopoDefinido = form.escopo === "interno" || form.escopo === "externo";
  const prodBlocked = form.prodStatus === "dev" || form.prodStatus === "idle";

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
    updateField("participantes", [...form.participantes, email]);
    return true;
  }

  function removeParticipant(email: string) {
    updateField("participantes", form.participantes.filter((p) => p !== email));
  }

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
            <span>O custo mensal da ferramenta externa será informado na etapa de Análise de Impacto e será abatido do saving calculado.</span>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup>
              <FormLabel required>Nome Completo</FormLabel>
              <FormInput
                type="text"
                placeholder="Seu nome completo"
                value={form.nome}
                onChange={(e) => updateField("nome", e.currentTarget.value)}
                error={errors.nome}
              />
            </FormGroup>
            <FormGroup>
              <FormLabel required>E-mail</FormLabel>
              <FormInput
                type="email"
                placeholder="seu.email@gocase.com.br"
                value={form.email}
                onChange={(e) => updateField("email", e.currentTarget.value)}
                error={errors.email}
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup>
              <FormLabel required>Área</FormLabel>
              <FormSelect
                value={form.area}
                onChange={(e) => updateField("area", e.currentTarget.value)}
                error={errors.area}
              >
                <option value="">Selecione sua área</option>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </FormSelect>
            </FormGroup>
            <FormGroup>
              {isExterno ? (
                <>
                  <FormLabel required>Serviço Externo Utilizado</FormLabel>
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
          </div>

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
                  👥 E-mails dos participantes:
                </label>
                <ChipsInput
                  chips={form.participantes}
                  onAdd={addParticipant}
                  onRemove={removeParticipant}
                  error={errors.participantes}
                />
              </div>
            )}
          </FormGroup>
        </div>
      )}
    </div>
  );
}
