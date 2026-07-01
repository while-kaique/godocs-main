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
  "n8n", "Python", "Google Apps Script", "Claude + GoDeploy",
  "Claude", "Vercel", "Outros"
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
  escopo: "interno" | "externo" | "";
  prodStatus: "sim" | "dev" | "idle" | "";
  nome: string;
  email: string;
  ferramenta: string;
  ferramentaOutra: string;
  servicoExterno: string;
  emEquipe: "sim" | "nao" | "";
  participantes: string[];
  nomeProjeto: string;
  dataCriacao: string;
  tipoProjeto: ("saving" | "receita_incremental")[];
  descricaoBreve: string;
  // Usa o AI Proxy (gateway interno de IA da empresa, ai-proxy.gogroupbr.com)?
  // Governança de custo: projetos que usam IA deveriam rotear pelo proxy interno.
  // '' = não respondido; 'sim'/'nao' = resposta determinística na etapa 2. O agente
  // de documentação faz auto-detecção do uso na doc enviada e cruza com esta resposta.
  usaAiProxy: "sim" | "nao" | "";
  // Projeto especial (etapa 2.5): altíssimo impacto que não se encaixa em saving/receita.
  especial: boolean;
  contextoEspecial: string;
}

export interface FieldErrors {
  [key: string]: string;
}

export type ChatFase = "doc" | "doc_preview" | "saving" | "saving_preview" | "receita" | "receita_preview" | "completo";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  options?: [string, string, string];
  isComplete?: boolean;
  isPreview?: boolean;
  fase?: ChatFase;
}

// Uma linha do formulário = uma pessoa/cargo que executava a tarefa manualmente.
export interface SavingLinhaInput {
  cargo: string;
  horasAntes: string;
  horasDepois: string;
}

// Uma ferramenta/serviço externo que a solução fez a empresa DEIXAR de pagar
// (custo evitado). Distinto do `servicoExterno`/`custoExterno`, que é a ferramenta
// USADA pela automação (custo incorrido, que subtrai). Aqui é o que foi ELIMINADO.
// `recorrencia`: 'mensal' e 'pontual' entram pelo valor CHEIO no saving (sem ÷12) — a
// recorrência é só rótulo exibido, não altera o valor.
export interface CustoEvitadoItemInput {
  nome: string;
  valor: string;
  recorrencia: 'mensal' | 'pontual' | '';
  justificativa: string;
}

export interface SavingFormData {
  linhas: SavingLinhaInput[];
  // Saving: alguém já fazia/mantinha isso manualmente antes da automação?
  // 'sim' → tabela antes+depois (economia clássica). 'nao' → ninguém fazia: a
  // árvore segue para `eliminaGastoExterno` (e, conforme a resposta, custo evitado
  // puro OU equivalente manual estimado — saving contrafactual).
  alguemFazia: 'sim' | 'nao' | '';
  // Árvore do "Não, ninguém fazia": a automação eliminou um gasto externo
  // (contrato/serviço/licença)? 'sim' → coleta o custo evitado (o ganho); 'nao' →
  // contrafactual (equivalente manual estimado). Só relevante quando alguemFazia==='nao'.
  eliminaGastoExterno: 'sim' | 'nao' | '';
  // 2c — só no ramo "Não → elimina SIM": além do gasto eliminado, há um trabalho
  // manual ADICIONAL (que ninguém fazia e o contrato NÃO cobria)? 'sim' → também
  // coleta horas contrafactuais distintas; 'nao' → custo evitado puro (0h, mapeia
  // para alguem_fazia='externo' no payload). Evita a dupla contagem do mesmo trabalho.
  temContrafactualAdicional: 'sim' | 'nao' | '';
  // Saving: a solução evitou um custo externo (ferramenta/serviço que deixou de
  // ser pago)? 'sim' → lista de ferramentas evitadas (custoEvitadoItens). No ramo
  // "Sim, alguém fazia" é a pergunta OPCIONAL de um custo DISTINTO das horas; no
  // ramo "Não" o papel é cumprido por `eliminaGastoExterno`.
  temCustoEvitado: 'sim' | 'nao' | '';
  custoEvitadoItens: CustoEvitadoItemInput[];
  // Saving: a solução INTERNA consome algum serviço externo PAGO para funcionar
  // (chave de API, ElevenLabs, etc.)? 'sim' → lista de serviços (custoProjetoItens).
  // O valor (pontual e mensal pelo valor cheio, sem ÷12) SUBTRAI do saving. Mesmo formato
  // do custo evitado, mas ABATE em vez de somar. ≠ custoExterno (que é escopo externo).
  temCustoProjeto: 'sim' | 'nao' | '';
  custoProjetoItens: CustoEvitadoItemInput[];
  tipoSaving: 'mensal' | 'pontual' | 'trimestral' | 'semestral' | '';
  custoExterno: string;
  custoPeriodicidade: 'mensal' | 'anual' | '';
  // Receita: ganho estimado informado pela pessoa antes do chat (o agente desafia).
  valorReceita: string;
  // Receita: racional curto (de onde vem a receita) — o agente usa como ponto de partida.
  racionalReceita: string;
}

// ─── Resultado da análise IA ────────────────────────────────────────────────

export interface AnaliseResultCriterio {
  criterio: string;
  pontos: number;
  justificativa: string;
}

export interface AnaliseResult {
  resultado: 'aprovado' | 'rejeitado';
  pontuacao_total: number;
  pontuacao_maxima: number;
  justificativa: string;
  resumo: string;
  criterios_hardcoded: AnaliseResultCriterio[];
  criterios_dinamicos: AnaliseResultCriterio[];
}

// ─── Máscara de moeda BR (padroniza a entrada financeira) ───────────────────
// Entrada baseada em centavos: o usuário só digita dígitos e o valor é formatado
// como "1.234,56" automaticamente (não precisa — nem pode — digitar "." ou ",").

// Recebe qualquer string (com ou sem máscara) e devolve "1.234,56" a partir só dos
// dígitos. "" quando não há dígitos.
export function formatMoedaBR(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "1.234,56" → 1234.56 (0 se inválido). Inverso de formatMoedaBR/numeroParaMoedaBR.
export function parseMoedaBR(formatted: string): number {
  const n = parseFloat(String(formatted).replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// 1234.56 → "1.234,56" (para repopular o form na edição a partir do número salvo).
export function numeroParaMoedaBR(n: number): string {
  if (n == null || isNaN(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Arquivo de 0 bytes vira "data:...;base64," → split(",")[1] === "".
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Remove docs sem conteúdo (base64 vazio). Arquivos de 0 bytes produzem base64 ""
// e o backend rejeita o payload inteiro com ZodError ("docs[].base64" exige ≥1
// caractere). O step2 já barra arquivos vazios na seleção; este filtro é a rede de
// segurança para qualquer arquivo que escape (caminho de edição/reprocesso, etc.).
export function descartarDocsVazios<T extends { base64: string }>(docs: T[]): T[] {
  return docs.filter((d) => d.base64.length > 0);
}

// Converte os arquivos selecionados no payload `docs` (base64 + nome), descartando
// arquivos vazios para nunca enviar um base64 "" que o backend recusaria.
export async function filesToDocs(
  files: File[]
): Promise<{ base64: string; filename: string }[]> {
  const docs = await Promise.all(
    files.map(async (f) => ({ base64: await readFileAsBase64(f), filename: f.name }))
  );
  return descartarDocsVazios(docs);
}

// Oculta valores financeiros de SAVING do texto exibido ao usuário (memorial/preview).
// O cliente só pode ver HORAS — nunca R$, taxa/hora ou custo evitado em R$. Isso evita
// que ele manipule os números (as taxas por cargo são internas); só a equipe que
// analisa as submissões vê os valores em R$. É uma rede de segurança: o prompt do
// agente já instrui a não emitir R$, mas aqui removemos qualquer vazamento antes de
// exibir. NÃO aplicar a receita (valor declarado pelo próprio usuário).
export function ocultarReaisSaving(content: string): string {
  // Só remove linhas que de fato carregam dinheiro (R$, "X reais", valor/taxa por
  // hora). NÃO remove por palavras como "custo"/"economia" — uma linha de horas
  // ("Custo adicional: 1h/mês") é legítima e deve permanecer.
  const ehLinhaFinanceira = (l: string) =>
    /r\$/i.test(l) || /\d[\d.,]*\s*reais\b/i.test(l) || /(valor|taxa)[\s/]*(por\s*)?hora/i.test(l);
  return content
    .split("\n")
    .filter((linha) => !ehLinhaFinanceira(linha))
    .join("\n")
    // Segurança extra: remove qualquer "R$ 1.234,56" residual inline
    .replace(/r\$\s*[\d.,]+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
