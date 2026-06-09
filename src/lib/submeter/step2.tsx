import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ACCEPTED_DOC_EXT,
  ACCEPTED_CODE_EXT,
  MAX_FILE_MB,
  MAX_FILES,
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

// ── Prompt para Claude.ai quando arquivos são muito grandes ──────────────────

const REDIRECT_PROMPT = `Você é um especialista em documentação de automações RPA/IA.
Com base no contexto abaixo, gere uma documentação técnica condensada com exatamente estas 7 seções:

1. **Nome do Projeto**
2. **O que faz** — 2-4 frases: problema, para quem, resultado
3. **Execução** — como é acionado (trigger, schedule, webhook)
4. **Dependências** — APIs, serviços externos, credenciais necessárias
5. **Fluxo** — etapas sequenciais do início ao fim, incluindo IFs
6. **Configurar antes de usar** — pré-requisitos de setup
7. **Atenção** — riscos, limitações, pontos frágeis

Cole aqui o conteúdo dos seus arquivos: [cole aqui]`;

// ── Helpers ──────────────────────────────────────────────────────────────────

type GateStatus = "ok" | "warn" | "block";

function calcGate(totalChars: number): GateStatus {
  if (totalChars >= TOKEN_BLOCK_CHARS) return "block";
  if (totalChars >= TOKEN_WARN_CHARS) return "warn";
  return "ok";
}

function fmtTokens(chars: number): string {
  const tokens = Math.round(chars / 4);
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tokens` : `~${tokens} tokens`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Extensões que podem ser lidas como texto no browser
const TEXT_EXTS = new Set([
  "json", "ts", "tsx", "js", "jsx", "py", "sql", "sh",
  "yaml", "yml", "toml", "css", "html", "txt", "md", "xml",
]);

function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTS.has(ext);
}

// Pastas de desenvolvimento/build/deps que NUNCA devem ser enviadas
// (verificadas por segmento do caminho — estilo .gitignore)
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "dist", "build", "out", ".next", ".nuxt", ".output", ".vercel",
  "coverage", ".cache", ".vite", ".turbo", ".parcel-cache",
  "venv", ".venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache",
  "vendor", "target", "bin", "obj", ".idea", ".vscode", ".gradle",
  "tmp", "temp", ".terraform",
]);

// Padrões de arquivo que devem ser ignorados (lock, minificados, mapas, etc.)
function isIgnoredFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css") ||
    lower.endsWith(".map") ||
    lower === "package-lock.json" ||
    lower === "yarn.lock" ||
    lower === "pnpm-lock.yaml" ||
    lower === "bun.lockb" ||
    lower === "poetry.lock" ||
    lower === "composer.lock" ||
    lower === ".ds_store" ||
    lower === "thumbs.db"
  );
}

/** Decide se um arquivo deve ser ignorado com base no caminho relativo */
function shouldIgnorePath(relPath: string, fileName: string): string | null {
  // Algum segmento do caminho é uma pasta de desenvolvimento?
  const segments = relPath.split("/");
  for (const seg of segments) {
    if (IGNORED_DIRS.has(seg)) return `pasta ignorada: ${seg}/`;
  }
  if (isIgnoredFileName(fileName)) return "arquivo de lock/build";
  return null;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsText(file, "utf-8");
  });
}

// ── Componente principal ─────────────────────────────────────────────────────

export function Step2({
  form,
  errors,
  updateField,
  clearError,
  arquivos,
  setArquivos,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  arquivos: File[];
  setArquivos: (files: File[]) => void;
}) {
  const isN8n = form.ferramenta === "n8n";
  const [dragOver, setDragOver] = useState(false);
  const [fileChars, setFileChars] = useState<Map<string, number>>(new Map());
  const [copied, setCopied] = useState(false);
  const [processing, setProcessing] = useState<null | { fase: string; current: number; total: number }>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const descricaoChars = form.descricaoBreve.length;
  const totalFileChars = [...fileChars.values()].reduce((a, b) => a + b, 0);
  const totalChars = totalFileChars + descricaoChars;
  const gateStatus = calcGate(totalChars);

  const n8nNameStatus =
    isN8n && form.nomeProjeto.length >= 3
      ? /^\[.+\]/.test(form.nomeProjeto)
        ? "ok"
        : "warn"
      : null;

  // Estima os chars de um arquivo (lê conteúdo real p/ texto, tamanho p/ binário)
  const estimateFileChars = useCallback(async (file: File): Promise<number> => {
    if (isTextFile(file.name)) {
      const text = await readFileAsText(file);
      return text.length;
    }
    // PDF/DOCX (binário): não dá pra ler chars no browser → estima por tamanho
    return Math.round(file.size * 0.8);
  }, []);

  // Cede o controle pro browser pintar a tela antes de um trecho síncrono pesado
  const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

  async function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);

    // Mostra o spinner antes de qualquer trabalho pesado (browser pinta a tela)
    setProcessing({ fase: "Filtrando arquivos", current: 0, total: list.length });
    await yieldToBrowser();

    const accepted: File[] = [];
    const rejected: { name: string; ext: string; reason: string; size: number }[] = [];
    let ignoredCount = 0;
    const ignoredReasons: Record<string, number> = {};

    console.groupCollapsed(`[Step2/addFiles] Recebidos ${list.length} arquivo(s)`);

    for (const file of list) {
      // webkitRelativePath traz o caminho completo dentro da pasta selecionada
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

      // 1. Ignora pastas de desenvolvimento/build/deps (node_modules, .git, dist, etc.)
      const ignoreReason = shouldIgnorePath(relPath, file.name);
      if (ignoreReason) {
        ignoredCount++;
        const key = ignoreReason.startsWith("pasta") ? ignoreReason : "arquivos de lock/build";
        ignoredReasons[key] = (ignoredReasons[key] ?? 0) + 1;
        continue;
      }

      const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      const hasExt = file.name.includes(".");

      if (!hasExt) {
        rejected.push({ name: relPath, ext: "(sem extensão)", reason: "sem extensão", size: file.size });
        continue;
      }
      if (!ACCEPTED_DOC_EXT.includes(ext)) {
        rejected.push({ name: relPath, ext, reason: "extensão não suportada", size: file.size });
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        rejected.push({ name: relPath, ext, reason: `excede ${MAX_FILE_MB}MB`, size: file.size });
        toast.error(`"${file.name}" excede ${MAX_FILE_MB}MB`);
        continue;
      }
      if (arquivos.some((f) => f.name === file.name)) {
        console.log(`⏭️  duplicado, ignorado: ${relPath}`);
        continue;
      }
      accepted.push(file);
    }

    // Log dos ignorados (pastas de dev) — só resumo, nunca lista completa
    if (ignoredCount > 0) {
      console.warn(`🚫 ${ignoredCount} arquivo(s) ignorado(s) automaticamente (pastas de desenvolvimento):`, ignoredReasons);
    }

    // Log detalhado dos rejeitados por formato (limitado p/ não travar o console)
    if (rejected.length > 0) {
      console.warn(`⚠️ ${rejected.length} arquivo(s) rejeitado(s) por formato:`);
      console.table(
        rejected.slice(0, 100).map((r) => ({
          arquivo: r.name, extensão: r.ext, motivo: r.reason, tamanho: fmtSize(r.size),
        }))
      );
      if (rejected.length > 100) console.warn(`...+${rejected.length - 100} não mostrados na tabela`);

      const porExt = rejected.reduce<Record<string, number>>((acc, r) => {
        acc[r.ext] = (acc[r.ext] ?? 0) + 1;
        return acc;
      }, {});
      console.warn("Extensões rejeitadas (contagem):", porExt);
    }

    console.log(`📦 Resultado: ${accepted.length} aceito(s), ${ignoredCount} ignorado(s) (dev), ${rejected.length} rejeitado(s) (formato)`);
    console.groupEnd();

    // Toasts informativos
    if (ignoredCount > 0) {
      toast.info(`${ignoredCount} arquivo(s) de pastas de desenvolvimento ignorados automaticamente`);
    }
    if (rejected.length > 0) {
      const exts = [...new Set(rejected.map((r) => r.ext))].slice(0, 8).join(", ");
      toast.error(`${rejected.length} arquivo(s) ignorado(s) por formato: ${exts}`);
    }

    const merged = [...arquivos, ...accepted].slice(0, MAX_FILES);
    if (arquivos.length + accepted.length > MAX_FILES) {
      console.warn(`[Step2/addFiles] Limite de ${MAX_FILES} arquivos atingido — ${arquivos.length + accepted.length - MAX_FILES} descartado(s)`);
      toast.error(`Limite de ${MAX_FILES} arquivos — só os primeiros ${MAX_FILES} foram mantidos`);
    }

    setArquivos(merged);
    clearError("documentacao");

    // Lê o conteúdo dos novos arquivos com progresso visível
    const novos = accepted.slice(0, MAX_FILES - arquivos.length);
    const charsAcc = new Map<string, number>();
    for (let i = 0; i < novos.length; i++) {
      setProcessing({ fase: "Lendo conteúdo", current: i + 1, total: novos.length });
      const chars = await estimateFileChars(novos[i]);
      charsAcc.set(novos[i].name, chars);
      const tokens = Math.round(chars / 4);
      console.log(`[Step2/estimate] "${novos[i].name}": ${chars} chars → ~${tokens} tokens`);
    }
    setFileChars((prev) => {
      const next = new Map(prev);
      for (const [k, v] of charsAcc) next.set(k, v);
      return next;
    });

    setProcessing(null);
  }

  function removeFile(name: string) {
    setArquivos(arquivos.filter((f) => f.name !== name));
    setFileChars((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(REDIRECT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const gateColors = {
    ok:   { bg: "rgba(34,197,94,0.05)",   border: "rgba(34,197,94,0.2)",   text: "#16a34a" },
    warn: { bg: "rgba(215,219,0,0.06)",   border: "rgba(215,219,0,0.25)",  text: "#8a7d00" },
    block:{ bg: "rgba(220,38,38,0.04)",   border: "rgba(220,38,38,0.2)",   text: "#dc2626" },
  };
  const gc = gateColors[gateStatus];

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
            { value: "saving",              label: "💰 Saving" },
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
          <div className="mt-2 rounded-lg p-2.5" style={{ background: "rgba(215,219,0,0.06)", border: "1px solid rgba(215,219,0,0.2)" }}>
            <div className="mb-1 text-[11px] font-bold" style={{ color: "#8a7d00" }}>
              ⚠️ Atenção: nome deve ser idêntico ao do n8n
            </div>
            <div className="text-[11px]" style={{ color: "var(--go-text-primary)" }}>
              Copie <strong style={{ color: "#8a7d00" }}>exatamente</strong> como aparece no n8n — maiúsculas, espaços e prefixo entre colchetes incluídos.
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
            {n8nNameStatus === "ok" ? "✅ Prefixo detectado" : "⚠️ Sem prefixo — verifique o nome"}
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

      {/* Contexto de negócio */}
      <FormGroup>
        <FormLabel
          required
          hint="Descreva em 2-4 frases para que serve este projeto, para quem e qual o resultado esperado"
        >
          Contexto de Negócio
        </FormLabel>
        <textarea
          className={cn(
            "go-input w-full resize-none rounded-lg p-3 text-sm leading-relaxed",
            errors.descricaoBreve && "!border-[#dc2626]"
          )}
          style={{
            minHeight: 88,
            border: "1.5px solid rgba(0,89,169,0.18)",
            background: "var(--go-white)",
            color: "var(--go-text-heading)",
            outline: "none",
            transition: "border-color 0.15s",
          }}
          placeholder="Ex: Esta automação busca os pedidos pendentes no ERP, consulta o status de entrega na transportadora e envia e-mail automático para o cliente. Reduz o trabalho manual do time de CX e melhora o tempo de resposta."
          value={form.descricaoBreve}
          onChange={(e) => {
            updateField("descricaoBreve", e.currentTarget.value);
            clearError("descricaoBreve");
          }}
          maxLength={1000}
        />
        <div className="mt-1 flex justify-between">
          <FieldError message={errors.descricaoBreve} />
          <span className="text-[10px]" style={{ color: descricaoChars > 900 ? "#dc2626" : "#8b8b9a" }}>
            {descricaoChars}/1000
          </span>
        </div>
      </FormGroup>

      {/* Upload de arquivos */}
      <FormGroup>
        <FormLabel required>
          Arquivos do Projeto
        </FormLabel>

        <div
          className="mb-2.5 rounded-lg p-3 text-[12px] leading-relaxed"
          style={{ background: "rgba(0,89,169,0.03)", border: "1px solid rgba(0,89,169,0.08)", color: "var(--go-text-primary)" }}
        >
          🤖 <strong style={{ color: "var(--go-blue)" }}>A IA vai ler todo o código</strong> e gerar a documentação automaticamente.
          Envie os arquivos relevantes do projeto: workflow JSON, scripts, configs, README.
          <br />
          <span className="mt-1 block" style={{ color: "#8b8b9a" }}>
            Aceita: código ({ACCEPTED_CODE_EXT.join(" ")}) · docs (PDF, DOCX, TXT, MD) · máx. {MAX_FILE_MB}MB por arquivo · até {MAX_FILES} arquivos
          </span>
          <span className="mt-1 block" style={{ color: "#8b8b9a" }}>
            💡 Pode enviar a pasta inteira — <strong>node_modules</strong>, <strong>.git</strong>, <strong>dist</strong> e afins são ignorados automaticamente.
          </span>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            "relative rounded-xl p-5 text-center transition-colors",
            dragOver && "!border-[var(--go-blue)] !bg-[rgba(199,233,253,0.4)]",
            errors.documentacao && "!border-[#dc2626]"
          )}
          style={{ border: "2px dashed rgba(0,89,169,0.25)", background: "rgba(199,233,253,0.12)" }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_DOC_EXT.join(",")}
            className="hidden"
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
          />
          {/* webkitdirectory para seleção de pasta */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory não está no tipo padrão
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
          />

          {processing ? (
            <div className="flex flex-col items-center justify-center gap-2 py-1">
              <div className="go-spinner" />
              <div className="text-xs font-semibold" style={{ color: "var(--go-blue)" }}>
                {processing.fase}…
              </div>
              <div className="text-[11px]" style={{ color: "var(--go-text-primary)" }}>
                {processing.fase === "Filtrando arquivos"
                  ? `${processing.total.toLocaleString("pt-BR")} arquivo(s) recebidos — filtrando node_modules e afins`
                  : `Lendo ${processing.current} de ${processing.total}`}
              </div>
              {/* Barra de progresso (só na fase de leitura, onde total é pequeno) */}
              {processing.fase === "Lendo conteúdo" && processing.total > 0 && (
                <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full" style={{ background: "rgba(0,89,169,0.1)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(processing.current / processing.total) * 100}%`, background: "var(--go-blue)" }}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mb-3 text-[26px] opacity-50">📂</div>
              <div className="mb-3 text-xs" style={{ color: "var(--go-text-primary)" }}>
                Arraste arquivos aqui ou use os botões abaixo
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{ background: "rgba(0,89,169,0.08)", border: "1px solid rgba(0,89,169,0.2)", color: "var(--go-blue)" }}
                >
                  📄 Selecionar arquivos
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{ background: "rgba(0,89,169,0.08)", border: "1px solid rgba(0,89,169,0.2)", color: "var(--go-blue)" }}
                >
                  📁 Selecionar pasta
                </button>
              </div>
            </>
          )}
        </div>

        <FieldError message={errors.documentacao} />

        {/* Lista de arquivos */}
        {arquivos.length > 0 && (
          <div className="mt-3 space-y-1.5" style={{ animation: "go-slide-down 0.2s ease" }}>
            {arquivos.map((file) => {
              const chars = fileChars.get(file.name);
              const tokenLabel = chars != null ? fmtTokens(chars) : "estimando...";
              return (
                <div
                  key={file.name}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-[11px]"
                  style={{ background: "rgba(0,89,169,0.03)", border: "1px solid rgba(0,89,169,0.08)" }}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-[13px]">
                      {ACCEPTED_CODE_EXT.includes("." + file.name.split(".").pop()?.toLowerCase()) ? "⚙️" : "📄"}
                    </span>
                    <span className="truncate font-medium" style={{ color: "var(--go-text-heading)" }}>
                      {file.name}
                    </span>
                    <span style={{ color: "#8b8b9a", whiteSpace: "nowrap" }}>
                      {fmtSize(file.size)} · {tokenLabel}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(file.name)}
                    className="ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
                  >
                    remover
                  </button>
                </div>
              );
            })}

            {/* Resumo total + token gate */}
            <div
              className="mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold"
              style={{ background: gc.bg, border: `1px solid ${gc.border}`, color: gc.text }}
            >
              {gateStatus === "ok" && `✅ ${arquivos.length} arquivo(s) · ${fmtTokens(totalChars)} estimados — dentro do limite`}
              {gateStatus === "warn" && `⚠️ ${arquivos.length} arquivo(s) · ${fmtTokens(totalChars)} estimados — grande, pode impactar qualidade`}
              {gateStatus === "block" && `🚫 ${arquivos.length} arquivo(s) · ${fmtTokens(totalChars)} estimados — muito grande para processar diretamente`}
              {gateStatus === "warn" && (
                <div className="mt-0.5 text-[10px] font-normal" style={{ color: "#8a7d00" }}>
                  Documentos muito grandes podem reduzir a qualidade da análise. Se possível, remova arquivos desnecessários.
                </div>
              )}
            </div>
          </div>
        )}
      </FormGroup>

      {/* Painel de bloqueio */}
      {gateStatus === "block" && (
        <div
          className="mt-2 rounded-xl p-4"
          style={{ background: "rgba(220,38,38,0.03)", border: "1px solid rgba(220,38,38,0.15)", animation: "go-slide-down 0.3s ease" }}
        >
          <div className="mb-2 text-[13px] font-bold" style={{ color: "#dc2626" }}>
            🚫 Arquivos grandes demais
          </div>
          <p className="mb-3 text-[12px] leading-relaxed" style={{ color: "var(--go-text-primary)" }}>
            O volume de código ultrapassa o limite de processamento direto. Use o prompt abaixo no{" "}
            <strong>Claude.ai</strong> para gerar uma pré-documentação condensada — depois envie essa documentação aqui.
          </p>
          <div
            className="mb-3 rounded-lg p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap"
            style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.08)", color: "var(--go-text-primary)", maxHeight: 160, overflowY: "auto" }}
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
