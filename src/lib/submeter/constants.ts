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

// Papel de cada PARTICIPANTE (membro do time) no projeto. NÃO se aplica ao autor/
// submissor — ele é o dono (responsavel_email), fora da lista de participantes.
// São 3 papéis. ⚠️ Os `value` internos `coexecutor`/`planejador` foram MANTIDOS de
// propósito ao renomear os rótulos (Coautor/Participante) e as colunas do Sheets — são
// invisíveis ao usuário e trocá-los exigiria migrar `membros_papeis`. Mapeamento de
// exibição → coluna do Sheets: "Coautor" (`coexecutor`) → "Participantes";
// "Participante" (`planejador`) → "Participantes 2"; "Contribuidor" (`contribuidor`)
// → "Contribuidor". Os papéis LEGADOS `idealizador`/`referencia_tecnica` (feature
// anterior) não são mais oferecidos; no sync caem em "Contribuidor". Um papel por
// pessoa (decisão de produto). A ordem abaixo é a ordem exibida no seletor.
export const PAPEIS_PARTICIPANTE = [
  { value: "coexecutor", label: "Coautor" },
  { value: "planejador", label: "Participante" },
  { value: "contribuidor", label: "Contribuidor" },
] as const;

export type PapelParticipante = (typeof PAPEIS_PARTICIPANTE)[number]["value"];

// Monta o mapa e-mail→papel para o payload `membros_papeis`, só com participantes
// atuais e papéis já escolhidos (descarta vazios). O e-mail é a chave, exatamente
// como aparece em `participantes`. Função pura — testável.
export function montarMembrosPapeis(
  participantes: string[],
  papeis: Record<string, PapelParticipante | "">,
): Record<string, PapelParticipante> {
  const out: Record<string, PapelParticipante> = {};
  for (const email of participantes) {
    const p = papeis[email];
    if (p) out[email] = p;
  }
  return out;
}

export const STEPS = [
  { id: 1, label: "Envio" },
  { id: 2, label: "Projeto" },
  { id: 3, label: "Agente" },
];

// Validação pura da Etapa 1 (Envio). Retorna o mapa de erros por campo (vazio = ok).
// `modoEdicao` RELAXA os campos de "projeto legado" (escopo/status/ferramenta/serviço
// externo): um legado que só quer corrigir participantes/papéis pode não tê-los
// preenchidos, e não deve travar (D2/RF-103). Fora da edição (submissão NOVA), a
// validação é a completa de sempre (RF-106). Identidade (e-mail da conta detectado) e
// participantes/papéis são exigidos nos DOIS modos (RF-101/RF-102). Função pura — testável.
export function validarEtapa1(
  form: FormData,
  opts: { modoEdicao: boolean },
): FieldErrors {
  const errs: FieldErrors = {};
  const { modoEdicao } = opts;

  // Identidade sempre exigida — a conta logada precisa ter sido detectada (caso raro
  // de auth ausente). Nome e e-mail não são mais perguntados; vêm da conta (Godeploy).
  if (!form.email.trim())
    errs.email = "Não identificamos sua conta. Recarregue a página ou entre novamente.";

  // Campos do projeto (escopo/status/ferramenta) só travam na submissão NOVA. Em
  // edição, um legado pode não tê-los preenchidos — não bloqueia (D2/RF-103).
  if (!modoEdicao) {
    if (!form.escopo)
      errs.escopo = "Selecione se a solução é interna ou externa";
    if (!form.prodStatus)
      errs.prodStatus = "Selecione o status do projeto";
    else if (form.prodStatus !== "sim")
      errs.prodStatus =
        form.escopo === "externo"
          ? "Apenas ferramentas externas já em uso podem ser submetidas"
          : "Apenas projetos em produção podem ser submetidos";
    if (form.escopo === "externo") {
      if (!form.servicoExterno.trim())
        errs.servicoExterno = "Informe o nome do serviço externo";
    } else {
      if (!form.ferramenta) errs.ferramenta = "Selecione a ferramenta";
      if (form.ferramenta === "Outros" && !form.ferramentaOutra.trim())
        errs.ferramentaOutra = "Especifique a ferramenta utilizada";
    }
  }

  // Participantes e papéis — exigidos SEMPRE quando "em equipe = sim" (nova e edição).
  if (!form.emEquipe) errs.emEquipe = "Selecione uma opção";
  if (form.emEquipe === "sim" && form.participantes.length === 0)
    errs.participantes = "Informe ao menos um e-mail de participante";
  if (form.emEquipe === "sim" && form.participantes.length > 0) {
    const invalid = form.participantes.filter((p) => !ALLOWED_DOMAINS_RE.test(p));
    if (invalid.length > 0)
      errs.participantes = "Apenas e-mails @gocase, @gobeaute ou @gogroup são permitidos";
    // Papel obrigatório por participante (decisão de produto: obriga escolher).
    else if (form.participantes.some((p) => !form.participantesPapeis[p]))
      errs.participantes = "Escolha o papel de cada participante";
  }

  return errs;
}

// Validação pura da Etapa 2 (Dados do Projeto). Retorna o mapa de erros por campo.
// `hojeISO` é injetado (não usa `Date` interno) para ser testável. Regra de arquivos:
// - sem arquivos novos E sem existentes → exige selecionar ao menos um;
// - sem arquivos novos MAS existentes invalidados (o usuário removeu algum já enviado) →
//   exige re-upload, porque o servidor guarda a doc como texto único concatenado (não por
//   arquivo) e não há como regenerar de um subconjunto. Função pura — testável.
export function validarEtapa2(
  form: FormData,
  opts: {
    arquivosCount: number;
    nomesExistentesCount: number;
    docExistenteInvalidado: boolean;
    hojeISO: string;
  },
): FieldErrors {
  const errs: FieldErrors = {};
  const { arquivosCount, nomesExistentesCount, docExistenteInvalidado, hojeISO } = opts;

  if (!form.nomeProjeto.trim() || form.nomeProjeto.trim().length < 3)
    errs.nomeProjeto = "Informe o nome do projeto (mínimo 3 caracteres)";
  if (!form.dataCriacao) {
    errs.dataCriacao = "Informe a data de criação";
  } else if (form.dataCriacao < "2024-01-01") {
    errs.dataCriacao = "A data mínima é 01/01/2024";
  } else if (form.dataCriacao > hojeISO) {
    errs.dataCriacao = "A data não pode ser no futuro";
  }
  if (!form.descricaoBreve.trim() || form.descricaoBreve.trim().length < 60)
    errs.descricaoBreve = "Descreva o contexto em pelo menos 60 caracteres";
  if (!form.usaAiProxy) errs.usaAiProxy = "Selecione se o projeto usa o AI Proxy";

  if (arquivosCount === 0 && nomesExistentesCount === 0) {
    errs.documentacao = "Selecione pelo menos um arquivo do projeto";
  } else if (arquivosCount === 0 && docExistenteInvalidado) {
    errs.documentacao =
      "Você removeu arquivo(s) enviado(s) antes. Suba novamente os arquivos que deseja manter para regenerar a documentação.";
  }

  return errs;
}

// Campos mínimos para começar a gerar a documentação em segundo plano (fase de doc):
// só o que o servidor PRECISA para criar o projeto e extrair o texto do documento —
// Etapa 1 concluída (escopo) + nome ≥3. Deliberadamente NÃO exige `descricaoBreve` nem
// `usaAiProxy` (ambos da Etapa 2): são os campos que a pessoa digita/responde por último e,
// se estivessem no gatilho, o background só arrancaria no fim da Etapa 2 — sem folga para
// terminar antes do clique em avançar (a demora que a pessoa sentia ao ir para o agente).
// Com o gatilho enxuto, o disparo acontece assim que o arquivo é anexado (o efeito checa
// `arquivos.length > 0` à parte), dando ao processamento o tempo em que a pessoa preenche o
// resto. O texto do documento é o input principal do extrator; a descrição é sinal
// secundário e chega ao servidor via `atualizar-metadados` ao avançar. Não inclui
// tipo/especial (Etapa 2.5), que não afetam a fase de doc. Função pura — testável.
export function camposMinimosDocProntos(form: FormData): boolean {
  return !!form.escopo && form.nomeProjeto.trim().length >= 3;
}

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
  // Papel de cada participante, chaveado pelo e-mail (exatamente como aparece em
  // `participantes`). "" = ainda não escolhido (obrigatório antes de avançar). O
  // autor NÃO entra aqui — só os e-mails do time adicionados pelo submissor.
  participantesPapeis: Record<string, PapelParticipante | "">;
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
