export const AREAS = [
  "AZ", "B2B Gobeauté", "B2B Gocase", "Contabilidade", "CSC", "CX",
  "CX - Agentes", "Dados", "Departamento Pessoal", "E-commerce", "Facilities",
  "Financeiro", "Fiscal", "FP&A", "Gente e Gestão", "Growth", "Ilustração",
  "Jurídico", "Logística", "M&A", "Marketing de Influência",
  "Offline - Administrativo", "Offline - Lojas", "Operações Gobeauté",
  "Operações Gocase - Administrativo", "Transportes", "Qualidade", "Manutenção",
  "Expedição", "Almoxarifado", "Produção", "Produto Gobeauté", "Produto Gocase",
  "Projetos e Integrações", "RPA", "Marketing - Branding",
  "Sourcing & Procurement Gobeauté", "Supply Gogroup", "Tecnologia",
] as const;

export const FERRAMENTAS = [
  "n8n", "Python", "Google Apps Script", "Make", "Lovable",
  "Selenium", "Puppeteer", "Power BI", "Claude + Vercel", "Outros",
] as const;

// Extensões de documentos legíveis
export const ACCEPTED_DOC_EXT_BASE = [".pdf", ".docx", ".doc", ".txt", ".md"];
// Extensões de código e config
export const ACCEPTED_CODE_EXT = [
  ".json", ".ts", ".tsx", ".js", ".jsx", ".py",
  ".sql", ".sh", ".yaml", ".yml", ".toml", ".css", ".html",
];
export const ACCEPTED_DOC_EXT = [...ACCEPTED_DOC_EXT_BASE, ...ACCEPTED_CODE_EXT];

export const MAX_FILE_MB = 10;   // por arquivo
// Sem limite de contagem de arquivos — o gate é o orçamento de tokens (abaixo).
// Cap de segurança alto só para evitar payloads patológicos.
export const MAX_FILES = 5000;

// Orçamento de TOKENS (não de arquivos). ~4 chars por token.
// Analisamos a codebase/pasta inteira desde que não estoure 200k tokens.
// BLOCK = 200k tokens (= cap de truncamento do backend); WARN um pouco antes.
export const TOKEN_BUDGET = 200_000;             // tokens
export const TOKEN_WARN_CHARS = 600_000;         // ~150k tokens
export const TOKEN_BLOCK_CHARS = 800_000;        // ~200k tokens
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ALLOWED_DOMAINS_RE = /^[^\s@]+@(gocase|gobeaute|gogroup)\.(com|com\.br)$/i;

export const STEPS = [
  { id: 1, label: "Envio" },
  { id: 2, label: "Projeto" },
  { id: 3, label: "Agente" },
];

export interface FormData {
  prodStatus: "sim" | "dev" | "idle" | "";
  nome: string;
  email: string;
  area: string;
  ferramenta: string;
  ferramentaOutra: string;
  emEquipe: "sim" | "nao" | "";
  participantes: string[];
  nomeProjeto: string;
  dataCriacao: string;
  tipoProjeto: "saving" | "receita_incremental" | "";
  descricaoBreve: string;
}

export interface FieldErrors {
  [key: string]: string;
}

export type ChatFase = "doc" | "doc_preview" | "saving" | "saving_preview" | "completo";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  options?: [string, string, string];
  isComplete?: boolean;
  isPreview?: boolean;
  fase?: ChatFase;
}

export interface SavingFormData {
  cargo: string;
  horasAntes: string;
  horasDepois: string;
  tipoSaving: 'mensal' | 'pontual' | '';
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
