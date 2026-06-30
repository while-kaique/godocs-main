import React, { useEffect, useMemo, useRef, useState } from "react";
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

const GODEPLOY_CLAUDE_URL = "https://godeploy.com";

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
  ".wrangler", ".netlify",
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

/** Caminho relativo do arquivo (com subpastas) ou só o nome se não veio de pasta */
function pathOf(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isCodeFile(name: string): boolean {
  return ACCEPTED_CODE_EXT.includes("." + (name.split(".").pop() ?? "").toLowerCase());
}

// ── Árvore de pastas a partir dos caminhos dos arquivos ───────────────────────

type TreeFile = { kind: "file"; name: string; path: string; size: number; chars: number };
type TreeFolder = {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  fileCount: number;
  chars: number;
};
type TreeNode = TreeFile | TreeFolder;

/** Monta a árvore hierárquica e agrega contagem/chars por pasta */
function buildTree(arquivos: File[], fileChars: Map<string, number>): TreeFolder {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [], fileCount: 0, chars: 0 };

  for (const file of arquivos) {
    const fullPath = pathOf(file);
    const segments = fullPath.split("/").filter(Boolean);
    const fileName = segments.pop() ?? file.name;
    const chars = fileChars.get(fullPath) ?? 0;

    // Desce/cria as pastas intermediárias
    let node = root;
    let acc = "";
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.find(
        (c): c is TreeFolder => c.kind === "folder" && c.name === seg
      );
      if (!child) {
        child = { kind: "folder", name: seg, path: acc, children: [], fileCount: 0, chars: 0 };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({ kind: "file", name: fileName, path: fullPath, size: file.size, chars });
  }

  // Agrega contagem e chars (pós-ordem) + ordena (pastas antes, alfabético)
  const aggregate = (folder: TreeFolder): { count: number; chars: number } => {
    let count = 0;
    let chars = 0;
    for (const child of folder.children) {
      if (child.kind === "folder") {
        const r = aggregate(child);
        count += r.count;
        chars += r.chars;
      } else {
        count += 1;
        chars += child.chars;
      }
    }
    folder.fileCount = count;
    folder.chars = chars;
    folder.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { count, chars };
  };
  aggregate(root);

  // Colapsa pastas-corrente (uma pasta com um único filho-pasta) p/ encurtar a árvore
  return collapseSingleChildFolders(root);
}

/** Junta "a/b/c" quando cada nível tem só uma subpasta — fica "a/b/c" numa linha só */
function collapseSingleChildFolders(folder: TreeFolder): TreeFolder {
  folder.children = folder.children.map((c) =>
    c.kind === "folder" ? collapseSingleChildFolders(c) : c
  );
  if (
    folder.path !== "" &&
    folder.children.length === 1 &&
    folder.children[0].kind === "folder"
  ) {
    const only = folder.children[0] as TreeFolder;
    return {
      ...folder,
      name: `${folder.name}/${only.name}`,
      path: only.path,
      children: only.children,
    };
  }
  return folder;
}

// ── Nó da árvore (recursivo) ──────────────────────────────────────────────────

function FileTreeNode({
  node, depth, expanded, onToggle, onRemoveFile, onRemoveFolder,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onRemoveFile: (path: string) => void;
  onRemoveFolder: (path: string) => void;
}) {
  const indent = 8 + depth * 14;

  if (node.kind === "file") {
    return (
      <div
        className="group flex items-center justify-between py-1 pr-2 text-[11px] hover:bg-[rgba(0,89,169,0.04)]"
        style={{ paddingLeft: indent }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[12px]">{isCodeFile(node.name) ? "⚙️" : "📄"}</span>
          <span className="truncate" style={{ color: "var(--go-text-heading)" }}>{node.name}</span>
          <span className="shrink-0" style={{ color: "#9aa4b2" }}>· {fmtTokens(node.chars)}</span>
        </div>
        <button
          type="button"
          onClick={() => onRemoveFile(node.path)}
          className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
          title="Remover arquivo"
        >
          ✕
        </button>
      </div>
    );
  }

  const isOpen = expanded.has(node.path);
  return (
    <div>
      <div
        className="group flex cursor-pointer items-center justify-between py-1 pr-2 text-[11px] hover:bg-[rgba(0,89,169,0.05)]"
        style={{ paddingLeft: indent }}
        onClick={() => onToggle(node.path)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[9px]" style={{ color: "#8b8b9a", width: 10 }}>
            {isOpen ? "▼" : "▶"}
          </span>
          <span className="shrink-0 text-[12px]">{isOpen ? "📂" : "📁"}</span>
          <span className="truncate font-semibold" style={{ color: "var(--go-text-heading)" }}>
            {node.name}
          </span>
          <span className="shrink-0" style={{ color: "#9aa4b2" }}>
            · {node.fileCount} arq · {fmtTokens(node.chars)}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemoveFolder(node.path); }}
          className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626", border: "none" }}
          title="Remover pasta inteira"
        >
          ✕
        </button>
      </div>
      {isOpen && node.children.map((child) => (
        <FileTreeNode
          key={child.path || child.name}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onRemoveFile={onRemoveFile}
          onRemoveFolder={onRemoveFolder}
        />
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function Step2({
  form,
  errors,
  updateField,
  clearError,
  arquivos,
  setArquivos,
  nomesExistentes,
}: {
  form: FormData;
  errors: FieldErrors;
  updateField: <K extends keyof FormData>(key: K, value: FormData[K]) => void;
  clearError: (key: string) => void;
  arquivos: File[];
  setArquivos: (files: File[]) => void;
  nomesExistentes?: string[];
}) {
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [processing, setProcessing] = useState<null | { fase: string; current: number; total: number }>(null);
  // Pastas expandidas na árvore (por caminho). Vazio = tudo recolhido.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Abre o seletor mostrando feedback IMEDIATO (cobre a enumeração do browser,
  // que acontece antes do onChange e pode levar segundos em pastas grandes).
  function openPicker(ref: React.RefObject<HTMLInputElement | null>, isFolder: boolean) {
    setProcessing({ fase: isFolder ? "Lendo a pasta" : "Lendo arquivos", current: 0, total: 0 });
    ref.current?.click();
  }

  // Se o usuário cancelar o diálogo, o evento "cancel" limpa o loading.
  // (React não tipa onCancel em <input>, então anexamos manualmente.)
  useEffect(() => {
    const inputs = [fileInputRef.current, folderInputRef.current];
    const onCancel = () => setProcessing(null);
    inputs.forEach((el) => el?.addEventListener("cancel", onCancel));
    return () => inputs.forEach((el) => el?.removeEventListener("cancel", onCancel));
  }, []);

  // Chars são DERIVADOS dos arquivos (estimativa por tamanho), nunca um estado
  // separado: o step desmonta ao navegar entre etapas, então um Map em useState
  // se perderia e o total voltaria a ~0 tokens ao retornar. Derivar de `arquivos`
  // (que vive no componente pai) mantém a contagem sempre consistente.
  // Texto: bytes ≈ chars (UTF-8). Binário: ~80% do tamanho.
  const fileChars = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of arquivos) {
      m.set(pathOf(f), isTextFile(f.name) ? f.size : Math.round(f.size * 0.8));
    }
    return m;
  }, [arquivos]);

  const descricaoChars = form.descricaoBreve.length;
  const totalFileChars = [...fileChars.values()].reduce((a, b) => a + b, 0);
  const totalChars = totalFileChars + descricaoChars;
  const gateStatus = calcGate(totalChars);

  // Árvore de pastas (recalcula só quando arquivos/chars mudam)
  const tree = useMemo(() => buildTree(arquivos, fileChars), [arquivos, fileChars]);

  function toggleFolder(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function setAllFolders(open: boolean) {
    if (!open) { setExpanded(new Set()); return; }
    const all = new Set<string>();
    const walk = (f: TreeFolder) => {
      for (const c of f.children) {
        if (c.kind === "folder") { all.add(c.path); walk(c); }
      }
    };
    walk(tree);
    setExpanded(all);
  }


  // Cede o controle pro browser pintar a tela antes/durante um trecho pesado
  const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

  async function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);

    // Mostra o spinner antes de qualquer trabalho pesado (browser pinta a tela)
    setProcessing({ fase: "Analisando arquivos", current: 0, total: list.length });
    await yieldToBrowser();

    const accepted: File[] = [];
    const rejected: { name: string; ext: string; reason: string; size: number }[] = [];
    let ignoredCount = 0;
    let emptyCount = 0;
    const ignoredReasons: Record<string, number> = {};

    // Set de nomes já presentes (dedup O(1) em vez de varrer o array a cada arquivo)
    const existentes = new Set(arquivos.map((f) => pathOf(f)));

    console.groupCollapsed(`[Step2/addFiles] Recebidos ${list.length} arquivo(s)`);

    const CHUNK = 2000;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      // webkitRelativePath traz o caminho completo (inclui subpastas)
      const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

      // 1. Ignora pastas de desenvolvimento/build/deps (node_modules, .git, dist, etc.)
      const ignoreReason = shouldIgnorePath(relPath, file.name);
      if (ignoreReason) {
        ignoredCount++;
        const key = ignoreReason.startsWith("pasta") ? ignoreReason : "arquivos de lock/build";
        ignoredReasons[key] = (ignoredReasons[key] ?? 0) + 1;
      } else {
        const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
        const hasExt = file.name.includes(".");

        if (!hasExt) {
          rejected.push({ name: relPath, ext: "(sem extensão)", reason: "sem extensão", size: file.size });
        } else if (!ACCEPTED_DOC_EXT.includes(ext)) {
          rejected.push({ name: relPath, ext, reason: "extensão não suportada", size: file.size });
        } else if (file.size === 0) {
          // Arquivo vazio (0 bytes): readFileAsBase64 produz base64 "" e o backend
          // rejeita o payload com ZodError ("docs[].base64" deve ter ≥1 caractere),
          // travando a submissão inteira (ex.: pasta do projeto com __init__.py ou
          // .gitkeep vazio). Sem conteúdo para documentar — descarta com aviso claro.
          emptyCount++;
          console.log(`🗑️  vazio (0 bytes), ignorado: ${relPath}`);
        } else if (file.size > MAX_FILE_MB * 1024 * 1024) {
          rejected.push({ name: relPath, ext, reason: `excede ${MAX_FILE_MB}MB`, size: file.size });
          toast.error(`"${file.name}" excede ${MAX_FILE_MB}MB`);
        } else if (existentes.has(relPath)) {
          console.log(`⏭️  duplicado, ignorado: ${relPath}`);
        } else {
          existentes.add(relPath);
          accepted.push(file);
        }
      }

      // Atualiza progresso e cede o controle a cada lote (spinner anima)
      if (i % CHUNK === 0) {
        setProcessing({ fase: "Analisando arquivos", current: i, total: list.length });
        await yieldToBrowser();
      }
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

    if (emptyCount > 0) {
      console.warn(`🗑️ ${emptyCount} arquivo(s) vazio(s) (0 bytes) ignorado(s)`);
    }

    console.log(`📦 Resultado: ${accepted.length} aceito(s), ${ignoredCount} ignorado(s) (dev), ${emptyCount} vazio(s), ${rejected.length} rejeitado(s) (formato)`);
    console.groupEnd();

    // Toasts informativos
    if (emptyCount > 0) {
      toast.info(`${emptyCount} arquivo(s) vazio(s) (0 bytes) ignorado(s) — sem conteúdo para documentar`);
    }
    if (ignoredCount > 0) {
      toast.info(`${ignoredCount} arquivo(s) de pastas de desenvolvimento ignorados automaticamente`);
    }
    if (rejected.length > 0) {
      const exts = [...new Set(rejected.map((r) => r.ext))].slice(0, 8).join(", ");
      toast.info(`${rejected.length} arquivo(s) ignorado(s) por formato (não suportado): ${exts}`);
    }

    let merged = [...arquivos, ...accepted];
    // Cap de segurança altíssimo (não é um limite prático) — só evita payload absurdo
    if (merged.length > MAX_FILES) {
      console.warn(`[Step2/addFiles] Cap de segurança de ${MAX_FILES} arquivos atingido — ${merged.length - MAX_FILES} descartado(s)`);
      toast.error(`Muitos arquivos (${merged.length}). Mantidos os primeiros ${MAX_FILES}.`);
      merged = merged.slice(0, MAX_FILES);
    }

    setArquivos(merged);
    clearError("documentacao");
    setProcessing(null);
  }

  function removeFile(path: string) {
    setArquivos(arquivos.filter((f) => pathOf(f) !== path));
  }

  // Remove uma pasta inteira (todos os arquivos sob aquele prefixo)
  function removeFolder(folderPath: string) {
    const prefix = folderPath + "/";
    const removidos = arquivos.filter((f) => pathOf(f).startsWith(prefix)).map(pathOf);
    setArquivos(arquivos.filter((f) => !pathOf(f).startsWith(prefix)));
    if (removidos.length > 0) {
      toast.info(`${removidos.length} arquivo(s) de "${folderPath}/" removido(s)`);
    }
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

      {/* Nome do projeto */}
      <FormGroup>
        <FormLabel required>
          Nome do Projeto
        </FormLabel>
        <FormInput
          type="text"
          placeholder="Ex: Automação de Relatórios de Vendas"
          value={form.nomeProjeto}
          onChange={(e) => updateField("nomeProjeto", e.currentTarget.value)}
          error={errors.nomeProjeto}
        />
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

      {/* Usa AI Proxy? — governança de custo de IA (gateway interno da empresa) */}
      <FormGroup>
        <FormLabel
          required
          hint="O AI Proxy (ai-proxy.gogroupbr.com) é o gateway interno de IA da empresa, que reduz o custo das chamadas. Marque Sim se o projeto roteia chamadas de IA por ele. Marque Não se não usa IA ou usa IA sem passar pelo proxy."
        >
          Este projeto usa o AI Proxy?
        </FormLabel>
        <RadioGroup
          name="usaAiProxy"
          value={form.usaAiProxy}
          onChange={(v) => {
            updateField("usaAiProxy", v as FormData["usaAiProxy"]);
            clearError("usaAiProxy");
          }}
          options={[
            { value: "sim", label: "Sim" },
            { value: "nao", label: "Não" },
          ]}
          error={errors.usaAiProxy}
        />
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
          🤖 <strong style={{ color: "var(--go-blue)" }}>A IA vai ler toda a codebase</strong> e gerar a documentação automaticamente.
          Pode enviar a pasta inteira do projeto (com subpastas) ou os documentos.
          <br />
          <span className="mt-1 block" style={{ color: "#8b8b9a" }}>
            Aceita: código ({ACCEPTED_CODE_EXT.join(" ")}) · docs (PDF, DOCX, TXT, MD) · máx. {MAX_FILE_MB}MB por arquivo
          </span>
          <span className="mt-1 block" style={{ color: "#8b8b9a" }}>
            💡 Sem limite de arquivos — <strong>node_modules</strong>, <strong>.git</strong>, <strong>dist</strong> e afins são ignorados. O único limite é ~200k tokens de conteúdo (a barra abaixo avisa se passar).
          </span>
        </div>

        {/* Arquivos anteriores — exibidos apenas no modo edição quando ainda não há novos */}
        {arquivos.length === 0 && nomesExistentes && nomesExistentes.length > 0 && (
          <div
            className="mb-3 rounded-lg p-3 text-[12px] leading-relaxed"
            style={{ background: "rgba(215,219,0,0.07)", border: "1px solid rgba(215,219,0,0.3)", color: "var(--go-text-primary)" }}
          >
            <span className="font-semibold" style={{ color: "#8a7d00" }}>📎 Arquivos enviados anteriormente:</span>
            <ul className="mt-1.5 space-y-0.5 pl-2" style={{ color: "#8b8b9a" }}>
              {nomesExistentes.map((n) => (
                <li key={n} className="truncate">· {n}</li>
              ))}
            </ul>
            <p className="mt-2" style={{ color: "#8b8b9a" }}>
              O texto já extraído será reaproveitado. Suba novos arquivos abaixo para substituir ou adicionar.
            </p>
          </div>
        )}

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
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void addFiles(files);
              else setProcessing(null); // seleção vazia
              e.target.value = "";
            }}
          />
          {/* webkitdirectory para seleção de pasta */}
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory não está no tipo padrão
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void addFiles(files);
              else setProcessing(null);
              e.target.value = "";
            }}
          />

          {processing ? (
            <div className="flex flex-col items-center justify-center gap-2 py-1">
              <div className="go-spinner" />
              <div className="text-xs font-semibold" style={{ color: "var(--go-blue)" }}>
                {processing.fase}…
              </div>
              <div className="text-[11px]" style={{ color: "var(--go-text-primary)" }}>
                {processing.total > 0
                  ? `${processing.current.toLocaleString("pt-BR")} de ${processing.total.toLocaleString("pt-BR")} arquivo(s) — ignorando node_modules e afins`
                  : "O navegador está lendo os arquivos — pode levar alguns segundos em pastas grandes…"}
              </div>
              {processing.total > 0 && (
                <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full" style={{ background: "rgba(0,89,169,0.1)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, (processing.current / processing.total) * 100)}%`, background: "var(--go-blue)" }}
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
                  onClick={() => openPicker(fileInputRef, false)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{ background: "rgba(0,89,169,0.08)", border: "1px solid rgba(0,89,169,0.2)", color: "var(--go-blue)" }}
                >
                  📄 Selecionar arquivos
                </button>
                <button
                  type="button"
                  onClick={() => openPicker(folderInputRef, true)}
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

        {/* Árvore de arquivos */}
        {arquivos.length > 0 && (
          <div className="mt-3" style={{ animation: "go-slide-down 0.2s ease" }}>
            {/* Cabeçalho com contagem + expandir/recolher tudo */}
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <span className="text-[11px] font-semibold" style={{ color: "var(--go-text-heading)" }}>
                {arquivos.length} arquivo(s) · {fmtTokens(totalChars)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllFolders(true)}
                  className="text-[10px] font-semibold"
                  style={{ color: "var(--go-blue)" }}
                >
                  Expandir tudo
                </button>
                <span style={{ color: "#cbd5e1" }}>·</span>
                <button
                  type="button"
                  onClick={() => setAllFolders(false)}
                  className="text-[10px] font-semibold"
                  style={{ color: "var(--go-blue)" }}
                >
                  Recolher tudo
                </button>
              </div>
            </div>

            {/* Container com scroll limitado */}
            <div
              className="overflow-y-auto rounded-lg"
              style={{ maxHeight: 300, border: "1px solid rgba(0,89,169,0.08)", background: "rgba(0,89,169,0.02)" }}
            >
              {tree.children.map((node) => (
                <FileTreeNode
                  key={node.path || node.name}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onRemoveFile={removeFile}
                  onRemoveFolder={removeFolder}
                />
              ))}
            </div>

            {/* Resumo total + token gate */}
            <div
              className="mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold"
              style={{ background: gc.bg, border: `1px solid ${gc.border}`, color: gc.text }}
            >
              {gateStatus === "ok" && `✅ ${fmtTokens(totalChars)} estimados — dentro do limite`}
              {gateStatus === "warn" && `⚠️ ${fmtTokens(totalChars)} estimados — grande, pode impactar a qualidade`}
              {gateStatus === "block" && `🚫 ${fmtTokens(totalChars)} estimados — acima do limite de ~200k tokens`}
              {gateStatus === "warn" && (
                <div className="mt-0.5 text-[10px] font-normal" style={{ color: "#8a7d00" }}>
                  Conteúdo muito grande pode reduzir a qualidade da análise. Se possível, remova pastas ou arquivos desnecessários.
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
            <strong>Claude</strong> via{" "}
            <a
              href={GODEPLOY_CLAUDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold"
              style={{ color: "var(--go-blue)" }}
            >
              Godeploy
            </a>{" "}
            para gerar uma pré-documentação condensada — depois envie essa documentação aqui.
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
