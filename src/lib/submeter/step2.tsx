import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_DOC_EXT,
  MAX_FILE_MB,
  TOKEN_WARN_CHARS,
  TOKEN_BLOCK_CHARS,
} from "./constants";
import type { FormData, FieldErrors } from "./constants";
import {
  SectionTitle,
  FormGroup,
  FormLabel,
  FormInput,
  FieldError,
  RadioGroup,
  InfoTooltip,
} from "./form-components";

// ── Prompt para Claude.ai quando doc é muito grande ───────────────────────────

const REDIRECT_PROMPT = `Você é um especialista em documentação de automações RPA/IA.
Com base no contexto abaixo, gere uma documentação técnica condensada com exatamente estas 7 seções:

1. **Nome do Projeto**
2. **O que faz** — 2-4 frases: problema, para quem, resultado
3. **Execução** — como é acionado (trigger, schedule, webhook)
4. **Dependências** — APIs, serviços externos, credenciais necessárias
5. **Fluxo** — etapas sequenciais do início ao fim, incluindo IFs
6. **Configurar antes de usar** — pré-requisitos de setup
7. **Atenção** — riscos, limitações, pontos frágeis

Contexto do projeto: [cole aqui o que você tiver]`;

// ── Token gate ────────────────────────────────────────────────────────────────

function estimarTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type GateStatus = "ok" | "warn" | "block";

function calcGate(charCount: number): GateStatus {
  if (charCount >= TOKEN_BLOCK_CHARS) return "block";
  if (charCount >= TOKEN_WARN_CHARS) return "warn";
  return "ok";
}

// ── Componente principal ─────────────────────────────────────────────────────

export function Step2({
  form,
  errors,
  updateField,
  clearError,
  arquivo,
  setArquivo,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  arquivo: File | null;
  setArquivo: (f: File | null) => void;
}) {
  const isN8n = form.ferramenta === "n8n";
  const [dragOver, setDragOver] = useState(false);
  const [fileCharCount, setFileCharCount] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const descricaoCharCount = form.descricaoBreve.length;

  const totalChars = descricaoCharCount + fileCharCount;
  const gateStatus = calcGate(totalChars);
  const tokensEstimados = estimarTokens(totalChars.toString()) > 0
    ? estimarTokens(Array(totalChars).fill("a").join(""))
    : 0;

  const n8nNameStatus = useMemo(() => {
    if (!isN8n || form.nomeProjeto.length < 3) return null;
    if (/^\[.+\]/.test(form.nomeProjeto)) return "ok";
    return "warn";
  }, [isN8n, form.nomeProjeto]);

  function handleFileSelect(file: File | null) {
    if (!file) return;
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_DOC_EXT.includes(ext)) {
      toast.error(`Formato não aceito. Use: ${ACCEPTED_DOC_EXT.join(", ")}`);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Arquivo muito grande. Máximo: ${MAX_FILE_MB}MB`);
      return;
    }
    // Estima chars do arquivo para o token gate
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFileCharCount(text.length);
    };
    reader.readAsText(file);
    setArquivo(file);
    clearError("documentacao");
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(REDIRECT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const gateColor = {
    ok: { bg: "rgba(34,197,94,0.05)", border: "rgba(34,197,94,0.2)", text: "#16a34a" },
    warn: { bg: "rgba(215,219,0,0.06)", border: "rgba(215,219,0,0.25)", text: "#8a7d00" },
    block: { bg: "rgba(220,38,38,0.04)", border: "rgba(220,38,38,0.2)", text: "#dc2626" },
  }[gateStatus];

  const gateLabel = {
    ok: `✅ ~${Math.round(totalChars / 1000)}k chars — dentro do limite`,
    warn: `⚠️ ~${Math.round(totalChars / 1000)}k chars — grande, pode impactar qualidade`,
    block: `🚫 ~${Math.round(totalChars / 1000)}k chars — muito grande para processar`,
  }[gateStatus];

  return (
    <div>
      <SectionTitle icon="📋">Dados do Projeto</SectionTitle>

      {/* Tipo de projeto */}
      <FormGroup>
        <div className="mb-3.5 flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--go-text-heading)" }}>
          Este projeto é de saving ou receita incremental?
          <InfoTooltip>
            <strong className="mb-1 block text-white">Saving vs. Receita Incremental</strong>
            <span className="block mb-2" style={{ color: "rgba(255,255,255,0.85)" }}>
              <strong style={{ color: "var(--go-lime)" }}>Saving</strong> — economia gerada pela automação.
              Ex: processo manual que levava 20h/mês agora é automático (economia de horas e custo operacional).
            </span>
            <span className="block" style={{ color: "rgba(255,255,255,0.85)" }}>
              <strong style={{ color: "var(--go-lime)" }}>Receita Incremental</strong> — aumento de receita gerado pela automação.
              Ex: automação que dispara ofertas personalizadas e aumenta conversão de vendas.
            </span>
          </InfoTooltip>
        </div>
        <RadioGroup
          name="tipoProjeto"
          value={form.tipoProjeto}
          onChange={(v) => updateField("tipoProjeto", v as FormData["tipoProjeto"])}
          error={errors.tipoProjeto}
          options={[
            { value: "saving", label: "💰 Saving" },
            { value: "receita_incremental", label: "📈 Receita Incremental" },
          ]}
        />
      </FormGroup>

      {/* Nome do projeto */}
      <FormGroup>
        <FormLabel
          required
          hint={isN8n ? "Copie e cole o nome do fluxo exatamente como aparece no n8n" : undefined}
        >
          {isN8n ? "Nome exato do Fluxo Principal" : "Nome do Projeto"}
        </FormLabel>
        <FormInput
          type="text"
          placeholder={isN8n ? "Ex: [CX] Envio de NPS Automático" : "Ex: Automação de Relatórios de Vendas"}
          value={form.nomeProjeto}
          onChange={(e) => updateField("nomeProjeto", e.currentTarget.value)}
          error={errors.nomeProjeto}
        />
        {isN8n && (
          <div
            className="mt-2 rounded-lg p-2.5"
            style={{ background: "rgba(215,219,0,0.06)", border: "1px solid rgba(215,219,0,0.2)", animation: "go-slide-down 0.25s ease" }}
          >
            <div className="mb-1 flex items-center gap-1 text-[11px] font-bold" style={{ color: "#8a7d00" }}>
              ⚠️ Atenção: nome deve ser idêntico ao do n8n
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
              O nome precisa ser <strong style={{ color: "#8a7d00" }}>copiado exatamente</strong> como aparece no n8n — incluindo maiúsculas, espaços e prefixo entre colchetes.
            </div>
          </div>
        )}
        {n8nNameStatus && (
          <span
            className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={
              n8nNameStatus === "ok"
                ? { background: "rgba(34,197,94,0.06)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.15)" }
                : { background: "rgba(215,219,0,0.06)", color: "#8a7d00", border: "1px solid rgba(215,219,0,0.2)" }
            }
          >
            {n8nNameStatus === "ok"
              ? "✅ Prefixo detectado — parece um nome válido de fluxo n8n"
              : "⚠️ Sem prefixo — verifique se copiou o nome correto do n8n"}
          </span>
        )}
      </FormGroup>

      {/* Data de criação */}
      <FormGroup>
        <FormLabel required hint="Quando o projeto foi desenvolvido e colocado em produção">
          Data de Criação do Projeto
        </FormLabel>
        <FormInput
          type="date"
          value={form.dataCriacao}
          min="2024-01-01"
          max={new Date().toISOString().split("T")[0]}
          onChange={(e) => updateField("dataCriacao", e.currentTarget.value)}
          error={errors.dataCriacao}
          className="cursor-pointer"
        />
      </FormGroup>

      {/* Descrição breve */}
      <FormGroup>
        <FormLabel
          required
          hint="Descreva em 2-4 frases o que este projeto faz, para quem e qual o resultado"
        >
          Descrição do Projeto
        </FormLabel>
        <textarea
          className={cn(
            "go-input w-full resize-none rounded-lg p-3 text-sm leading-relaxed",
            errors.descricaoBreve && "!border-[#dc2626]"
          )}
          style={{
            minHeight: 96,
            border: "1.5px solid rgba(0,89,169,0.18)",
            background: "var(--go-white)",
            color: "var(--go-text-heading)",
            outline: "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          placeholder="Ex: Esta automação busca diariamente os pedidos pendentes no ERP, consulta o status de entrega na transportadora e envia um e-mail automático para o cliente com a atualização. Reduz o trabalho manual da equipe de CX e melhora o tempo de resposta."
          value={form.descricaoBreve}
          onChange={(e) => {
            updateField("descricaoBreve", e.currentTarget.value);
            clearError("descricaoBreve");
          }}
          maxLength={1000}
        />
        <div className="mt-1 flex justify-between">
          <FieldError message={errors.descricaoBreve} />
          <span
            className="text-[10px]"
            style={{ color: descricaoCharCount > 900 ? "#dc2626" : "#8b8b9a" }}
          >
            {descricaoCharCount}/1000
          </span>
        </div>
      </FormGroup>

      {/* Documentação */}
      <FormGroup>
        <FormLabel required hint="Envie qualquer documentação que descreva o projeto">
          Documentação do Projeto
        </FormLabel>

        <div
          className="mb-2 rounded-lg p-3 text-[12px] leading-relaxed"
          style={{ background: "rgba(0,89,169,0.03)", border: "1px solid rgba(0,89,169,0.08)", color: "var(--go-text-primary)" }}
        >
          🤖 <strong style={{ color: "var(--go-blue)" }}>O agente vai analisar sua documentação</strong> e solicitar apenas as informações que estiverem faltando. Quanto mais detalhada, menos perguntas serão feitas.
          <br />
          <span className="mt-1 block" style={{ color: "#8b8b9a" }}>
            Aceita: PDF, DOCX, DOC, TXT, MD, JSON (fluxo n8n ou JSON geral)
          </span>
        </div>

        <div
          className={cn(
            "relative cursor-pointer rounded-xl p-6 text-center transition-colors",
            dragOver && "!border-[var(--go-blue)] !bg-[rgba(199,233,253,0.4)]",
            errors.documentacao && "!border-[#dc2626]"
          )}
          style={{ border: "2px dashed rgba(0,89,169,0.25)", background: "rgba(199,233,253,0.15)" }}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelect(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_DOC_EXT.join(",")}
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <div className="mb-2 text-[28px] opacity-60">📄</div>
          <div className="text-xs" style={{ color: "var(--go-text-primary)" }}>
            <strong style={{ color: "var(--go-blue)" }}>Clique para selecionar</strong> ou arraste o arquivo
            <br />
            <small>PDF, DOCX, DOC, TXT, MD, JSON — máx. {MAX_FILE_MB}MB</small>
          </div>
        </div>

        {arquivo && (
          <div
            className="mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: "rgba(0,89,169,0.04)", color: "var(--go-blue)" }}
          >
            <span>📎 {arquivo.name}</span>
            <button
              type="button"
              onClick={() => { setArquivo(null); setFileCharCount(0); }}
              className="ml-2 rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
            >
              remover
            </button>
          </div>
        )}

        <FieldError message={errors.documentacao} />

        {/* Token gate — só exibe quando há conteúdo */}
        {totalChars > 0 && (
          <div
            className="mt-3 rounded-lg px-3 py-2.5 text-[11px] font-semibold"
            style={{
              background: gateColor.bg,
              border: `1px solid ${gateColor.border}`,
              color: gateColor.text,
              animation: "go-slide-down 0.25s ease",
            }}
          >
            {gateLabel}
            {gateStatus === "warn" && (
              <div className="mt-1 text-[10px] font-normal" style={{ color: "#8a7d00" }}>
                Documentos muito grandes podem reduzir a qualidade da análise. Se possível, envie uma versão resumida.
              </div>
            )}
          </div>
        )}
      </FormGroup>

      {/* Painel de bloqueio: redireciona ao Claude.ai para condensar */}
      {gateStatus === "block" && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{
            background: "rgba(220,38,38,0.03)",
            border: "1px solid rgba(220,38,38,0.15)",
            animation: "go-slide-down 0.3s ease",
          }}
        >
          <div className="mb-2 text-[13px] font-bold" style={{ color: "#dc2626" }}>
            🚫 Documentação muito grande
          </div>
          <p className="mb-3 text-[12px] leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
            O arquivo enviado ultrapassa o limite de processamento. Use o prompt abaixo no{" "}
            <strong>Claude.ai</strong> para gerar uma versão condensada e depois envie aqui.
          </p>
          <div
            className="mb-3 rounded-lg p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
            style={{
              background: "rgba(0,0,0,0.03)",
              border: "1px solid rgba(0,0,0,0.08)",
              color: "var(--go-text-primary)",
              maxHeight: 160,
              overflowY: "auto",
            }}
          >
            {REDIRECT_PROMPT}
          </div>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
            style={{
              background: copied ? "rgba(34,197,94,0.1)" : "rgba(0,89,169,0.06)",
              border: `1px solid ${copied ? "rgba(34,197,94,0.2)" : "rgba(0,89,169,0.15)"}`,
              color: copied ? "#16a34a" : "var(--go-blue)",
            }}
          >
            {copied ? "✅ Copiado!" : "📋 Copiar prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
