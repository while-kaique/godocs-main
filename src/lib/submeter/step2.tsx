import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACCEPTED_DOC_EXT, MAX_FILE_MB } from "./constants";
import type { FormData, FieldErrors } from "./constants";
import { SectionTitle, FormGroup, FormLabel, FormInput, FieldError } from "./form-components";

export function Step2({
  form, errors, updateField, clearError, arquivo, setArquivo,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setArquivo(file);
    clearError("documentacao");
  }

  return (
    <div>
      <SectionTitle icon="📋">Dados do Projeto</SectionTitle>

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

      <FormGroup>
        <FormLabel required hint="Envie qualquer documentação que descreva o projeto: PDF, DOCX, TXT ou MD">
          Documentação do Projeto
        </FormLabel>

        <div
          className="mb-2 rounded-lg p-3 text-[12px] leading-relaxed"
          style={{ background: "rgba(0,89,169,0.03)", border: "1px solid rgba(0,89,169,0.08)", color: "var(--go-text-primary)" }}
        >
          🤖 <strong style={{ color: "var(--go-blue)" }}>O agente vai analisar sua documentação</strong> e solicitar apenas as informações que estiverem faltando para completar o padrão exigido. Quanto mais detalhada, menos perguntas serão feitas.
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
            <small>PDF, DOCX, DOC, TXT, MD — máx. {MAX_FILE_MB}MB</small>
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
              onClick={() => setArquivo(null)}
              className="ml-2 rounded-full px-2 py-0.5 text-[10px]"
              style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
            >
              remover
            </button>
          </div>
        )}

        <FieldError message={errors.documentacao} />
      </FormGroup>
    </div>
  );
}
