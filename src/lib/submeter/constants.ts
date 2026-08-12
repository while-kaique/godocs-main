import {
  mensagemEspecialInvalido,
  type MotivoBloqueioEspecial,
} from "@/lib/mensagens-submissao";

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

// ─── Ferramentas de CONSTRUÇÃO do projeto (MULTI-seleção) ────────────────────
// O campo responde "com o que isto foi CONSTRUÍDO", não "do que isto depende para
// rodar": banco, APIs e integrações (Supabase, Shopify…) são conteúdo da
// DOCUMENTAÇÃO, não desta lista. ⚠️ **GoDeploy é a ÚNICA exceção aceita aqui**
// (decisão 12/08/2026) — é a nossa infra de deploy e antes só existia grudada na
// opção "Claude + GoDeploy", de quando o campo era de escolha ÚNICA. Não abrir a
// exceção para mais nada (o próximo pedido será Supabase, e aí a lista deixa de
// responder "com o que foi construído").
//
// ⚠️ Multi-seleção desde 12/08/2026 (antes: um `<select>`). A coluna do banco e do
// Sheets segue sendo UMA string (`projetos.ferramenta`, 200 chars) — as escolhas são
// unidas por `FERRAMENTA_SEP` (" + "), o MESMO separador que o valor legado
// "Claude + GoDeploy" já usava, então nada precisou migrar na planilha e o valor
// antigo se desmonta sozinho na leitura (`desserializarFerramentas`).
//
// `familia`/`variante` existem só para a TIPOGRAFIA do seletor: as 3 superfícies do
// Claude aparecem com "Claude" em peso leve e a superfície em negrito, o que agrupa os
// três chips sem precisar desenhar uma caixa em volta deles.
export const FERRAMENTA_OUTROS = "Outros";
export const FERRAMENTA_SEP = " + ";
export const PREFIXO_OUTROS = "Outros: ";
// = `ferramenta` no schema do banco e no zod de `chat.functions.ts`.
export const FERRAMENTA_MAX = 200;

export type FerramentaOpcao = {
  value: string;
  // Rótulo EXIBIDO quando o `value` não cabe na coluna da grade. O gravado é sempre o
  // `value` (a planilha e o glossário dos prompts dependem dele).
  label?: string;
  familia?: string;
  variante?: string;
  // Cor do logo da ferramenta no seletor (`.go-grid-check-marca-<marca>` em styles.css).
  // Só estético — o estado marcado/não nunca depende de cor.
  marca?: string;
};

// ⚠️ SEM ícone/emoji de propósito. A primeira versão dava um emoji a cada opção e a fileira
// virava uma cartela de adesivos que competia com a única coisa que o campo precisa mostrar:
// quais estão marcados e que as 3 superfícies do Claude são a mesma família.
//
// ⚠️ **A ORDEM ABAIXO É A ORDEM VISUAL, e a grade preenche por COLUNA** (`grid-auto-flow:
// column`, 3 linhas) — arranjo pedido pelo Luis em 12/08/2026:
//
//     Claude.ai       │ Python   │ Apps Script
//     Claude Cowork   │ n8n      │ Vercel
//     Claude Code     │ GoDeploy │ Outros
//
// As 3 superfícies do Claude ficam **empilhadas na 1ª coluna** (é o que agrupa a família, sem
// caixa em volta); o GoDeploy fecha a 2ª e o Vercel vai para a última, ao lado do Apps Script,
// com "Outros" sempre por último. ⚠️ Mexer nesta ordem muda TAMBÉM a ordem
// dos nomes dentro da string gravada (`serializarFerramentas` usa esta lista) — é inofensivo,
// porque nada lê a coluna por posição, mas a string de um mesmo projeto muda de forma.
export const FERRAMENTAS_OPCOES: readonly FerramentaOpcao[] = [
  // Coluna 1 — a família Claude, de cima para baixo, na cor do logo dele (`marca`)
  { value: "Claude.ai",     familia: "Claude", variante: ".ai",    marca: "claude" },
  { value: "Claude Cowork", familia: "Claude", variante: "Cowork", marca: "claude" },
  { value: "Claude Code",   familia: "Claude", variante: "Code",   marca: "claude" },
  // Coluna 2
  { value: "Python" },
  { value: "n8n" },
  { value: "GoDeploy" },
  // Coluna 3
  { value: "Google Apps Script", label: "Apps Script" },
  { value: "Vercel" },
  { value: FERRAMENTA_OUTROS },
] as const;

// Ordem canônica das opções (a mesma da lista acima, que é a ordem VISUAL) — é a ordem em que
// a string é montada, para que a mesma escolha gere SEMPRE a mesma string.
export const FERRAMENTAS: readonly string[] = FERRAMENTAS_OPCOES.map((o) => o.value);

// Valores gravados por versões anteriores do formulário (escolha única) e pela
// planilha, mapeados para as opções atuais. Chave comparada em MINÚSCULAS.
// "Claude" sozinho vira **Claude Code**: o campo pergunta com o que se CONSTRUIU e, no
// GoGroup, o Claude que constrói é o Claude Code — é o que o glossário do analisador
// (`analyzer.ts`) já dizia. "Claude + GoDeploy" não precisa de entrada própria: quebra
// no separador e cada metade cai aqui.
export const FERRAMENTAS_LEGADO: Record<string, string> = {
  "claude": "Claude Code",
  "claude ai": "Claude.ai",
  "claude chat": "Claude.ai",
  "godeploy": "GoDeploy",
};

// "n8n + Claude Code" → ["n8n", "Claude Code"]. `Outros: <texto>` volta separado em
// `ferramentaOutra`. ⚠️ Valor LEGADO fora da lista (a planilha traz "Power Automate",
// "VBA"…) é preservado como escolha EXTRA — o seletor o desenha como chip próprio, para
// a edição nunca dar a impressão de que o dado sumiu (era o papel da `<option>` extra
// do antigo `<select>`). Função pura — testável.
export function desserializarFerramentas(bruto: string | null | undefined): {
  ferramentas: string[];
  ferramentaOutra: string;
} {
  const tokens = (bruto ?? "").split(FERRAMENTA_SEP).map((t) => t.trim()).filter(Boolean);
  const ferramentas: string[] = [];
  let ferramentaOutra = "";
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith(PREFIXO_OUTROS.toLowerCase())) {
      ferramentaOutra = token.slice(PREFIXO_OUTROS.length).trim();
      if (!ferramentas.includes(FERRAMENTA_OUTROS)) ferramentas.push(FERRAMENTA_OUTROS);
      continue;
    }
    const canonico =
      FERRAMENTAS.find((f) => f.toLowerCase() === lower) ??
      FERRAMENTAS_LEGADO[lower] ??
      token;
    if (!ferramentas.includes(canonico)) ferramentas.push(canonico);
  }
  return { ferramentas, ferramentaOutra };
}

// Inverso: junta as escolhas em UMA string para o banco/Sheets, na ordem canônica da
// lista — NÃO na ordem dos cliques, senão a mesma escolha geraria strings diferentes e
// o `metaChanged` do wizard acusaria mudança fantasma (reprocessando o agente de graça).
// Valor legado fora da lista vai no fim. "Outros" viaja como "Outros: <texto>".
// Função pura — testável.
export function serializarFerramentas(ferramentas: string[], ferramentaOutra: string): string {
  const escolhidas = ferramentas ?? [];
  const conhecidas = FERRAMENTAS.filter((f) => escolhidas.includes(f));
  const extras = escolhidas.filter((f) => !FERRAMENTAS.includes(f));
  const outra = (ferramentaOutra ?? "").trim();
  return [...conhecidas, ...extras]
    .map((f) => (f === FERRAMENTA_OUTROS && outra ? `${PREFIXO_OUTROS}${outra}` : f))
    .join(FERRAMENTA_SEP);
}

// Quantos caracteres ainda cabem em "Especifique a ferramenta". Antes era um 192 fixo
// (200 do schema − os 8 chars de "Outros: "); com multi-seleção o RESTO da string também
// ocupa espaço, e um cap fixo voltaria a produzir erro de validação DEPOIS de tudo
// preenchido (é a família do bug do caso Josiely — ver `erro-validacao.ts`).
// Função pura — testável.
export function limiteFerramentaOutra(ferramentas: string[]): number {
  const semTexto = serializarFerramentas(ferramentas, "");
  // O token cru "Outros" (6) vira o prefixo "Outros: " (8) quando há texto.
  const extra = (ferramentas ?? []).includes(FERRAMENTA_OUTROS)
    ? PREFIXO_OUTROS.length - FERRAMENTA_OUTROS.length
    : 0;
  return Math.max(0, FERRAMENTA_MAX - semTexto.length - extra);
}

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

// Papel "Coautor" — ÚNICO por projeto (decisão de produto 30/07/2026): cada projeto tem
// 1 autor (o submissor/dono) e no máximo 1 Coautor. Os demais participantes ficam como
// "Participante" ou "Contribuidor". O seletor desabilita "Coautor" para os outros quando
// alguém já o tem, e `validarEtapa1` bloqueia o avanço se vierem 2+ (caso de legado
// importado do Sheets com vários na coluna "Participantes" — o usuário reclassifica).
export const PAPEL_COAUTOR: PapelParticipante = "coexecutor";

// E-mails (dentro de `participantes`) marcados como Coautor. Função pura — testável.
export function coautoresSelecionados(
  participantes: string[],
  papeis: Record<string, PapelParticipante | "">,
): string[] {
  return participantes.filter((email) => papeis[email] === PAPEL_COAUTOR);
}

// Aplica a regra do Coautor único a um mapa de papéis que veio de FORA do formulário
// (seed da edição / rascunho): mantém o PRIMEIRO Coautor da lista e LIMPA o papel dos
// demais (string vazia) — não promove ninguém por conta própria; o usuário escolhe
// (o form já exige papel de todos). Sem 2+ Coautores, devolve o mapa como está.
// Função pura — testável.
export function limitarCoautorUnico(
  participantes: string[],
  papeis: Record<string, PapelParticipante | "">,
): Record<string, PapelParticipante | ""> {
  const coautores = coautoresSelecionados(participantes, papeis);
  if (coautores.length <= 1) return papeis;
  const out = { ...papeis };
  for (const email of coautores.slice(1)) out[email] = "";
  return out;
}

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

/**
 * Quem vê a tela de apresentação (`IntroSubmissao`, antes da Etapa 1).
 *
 * Só a submissão NOVA e limpa passa — os 3 sinais são os mesmos do `seedLoading`
 * em `submeter.tsx`, e cada exclusão tem motivo próprio:
 * - `editProjetoId`  → `/editar/$id` renderiza o MESMO `SubmeterPageContent`; a
 *   apresentação vazaria para quem só quer corrigir um projeto já submetido.
 * - `resumeDraftId`  → `?retomar=<id>` é retomada explícita.
 * - `temRascunhoLocal` → o `rehydrateFromLocal` salta para a etapa onde a pessoa
 *   parou (`setStep(d.step ?? 3)`); a intro ficaria na frente de um chat em curso.
 *
 * Não há flag de "já vi": por decisão de produto a tela aparece SEMPRE que se abre
 * /submeter do zero (inclusive após "Recomeçar" e "Submeter outro projeto").
 */
export function deveMostrarIntro(args: {
  editProjetoId?: string;
  resumeDraftId?: string;
  temRascunhoLocal: boolean;
}): boolean {
  return !args.editProjetoId && !args.resumeDraftId && !args.temRascunhoLocal;
}

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
      if ((form.ferramentas ?? []).length === 0)
        errs.ferramentas = "Selecione ao menos uma ferramenta";
    }
  }

  // As ferramentas SÃO editáveis na edição (a stack muda: ex. Vercel → GoDeploy), mas
  // seguem sem ser obrigatórias num legado que nunca as teve. O que vale nos DOIS modos:
  // marcar "Outros" sem escrever o nome gravaria a string "Outros" — sempre exigimos o nome.
  if (
    form.escopo !== "externo" &&
    (form.ferramentas ?? []).includes(FERRAMENTA_OUTROS) &&
    !form.ferramentaOutra.trim()
  )
    errs.ferramentaOutra = "Especifique a ferramenta utilizada";

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
    // Coautor é ÚNICO por projeto (1 autor + no máximo 1 coautor).
    else if (coautoresSelecionados(form.participantes, form.participantesPapeis).length > 1)
      errs.participantes =
        "Só é possível ter 1 Coautor por projeto — deixe os demais como Participante ou Contribuidor";
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

  // ── Contrafactual ("se desligar hoje") — obrigatório RESPONDER, nada BARRA ──
  // O PONTEIRO movido (custo/receita/KPI + onde verificar) NÃO é mais pergunta de
  // formulário: quem conduz é o AGENTE, que constrói o racional junto com a pessoa e
  // escreve a seção "Ponteiro movido e onde verificar" do memorial. Aqui fica só o
  // contrafactual — QUEM sente falta (pessoas ou times, da Team Guide). O "o que piora"
  // saiu do formulário (03/08/2026): nunca teve coluna própria no Sheets e o agente já
  // cobre o efeito de desligar na conversa. Não reintroduzir aqui.
  if (!form.contrafactualAfetados || form.contrafactualAfetados.length === 0) {
    errs.contrafactualAfetados =
      form.contrafactualAfetadosTipo === "time"
        ? "Selecione ao menos um time/área que sentiria falta"
        : "Selecione ao menos uma pessoa que sentiria falta";
  }

  if (arquivosCount === 0 && nomesExistentesCount === 0) {
    errs.documentacao = "Selecione pelo menos um arquivo do projeto";
  } else if (arquivosCount === 0 && docExistenteInvalidado) {
    errs.documentacao =
      "Você removeu arquivo(s) enviado(s) antes. Suba novamente os arquivos que deseja manter para regenerar a documentação.";
  }

  return errs;
}

/**
 * TRIAGEM DO ESPECIAL (Etapa 2.5) — qual pergunta desqualificou o projeto.
 *
 * Só se aplica a quem marcou `especial`; projeto padrão (saving/receita) nunca é
 * afetado. Precedência: **dashboard primeiro**, porque é o critério OBJETIVO (não
 * depende de julgar a natureza do ganho). Devolve `null` quando nada bloqueia —
 * inclusive com as perguntas ainda em branco (aí o que cobra a resposta é
 * `validarEtapa25Especial`, não este predicado). Função pura — testável.
 */
export function motivoBloqueioEspecial(
  form: Pick<FormData, "especial" | "especialDashboard" | "especialGanhoOrganizacional">,
): MotivoBloqueioEspecial | null {
  if (!form.especial) return null;
  if (form.especialDashboard === "sim") return "dashboard";
  if (form.especialGanhoOrganizacional === "sim") return "organizacional";
  return null;
}

/**
 * Erros da triagem do especial: perguntas não respondidas + o BLOQUEIO em si.
 *
 * O que é exigido acompanha exatamente o que a tela mostra: a 2ª pergunta só é
 * cobrada quando a 1ª foi respondida com "não" (com "sim" o projeto já está
 * bloqueado e a 2ª pergunta não aparece — cobrar uma resposta invisível travaria o
 * formulário sem dizer onde). A mensagem do bloqueio vem da FONTE ÚNICA
 * `mensagens-submissao.ts` (nunca texto solto na tela). Função pura — testável.
 */
export function validarEtapa25Especial(
  form: Pick<FormData, "especial" | "especialDashboard" | "especialGanhoOrganizacional">,
): FieldErrors {
  if (!form.especial) return {};
  const errs: FieldErrors = {};

  if (!form.especialDashboard) {
    errs.especialDashboard = "Responda esta pergunta para continuar";
  } else if (form.especialDashboard === "nao" && !form.especialGanhoOrganizacional) {
    errs.especialGanhoOrganizacional = "Responda esta pergunta para continuar";
  }

  const motivo = motivoBloqueioEspecial(form);
  if (motivo) errs.especialBloqueio = mensagemEspecialInvalido(motivo);

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
  // Ferramentas com que o projeto foi CONSTRUÍDO — multi-seleção (12/08/2026). Vira UMA
  // string no banco/Sheets via `serializarFerramentas`; ver o bloco no topo do arquivo.
  ferramentas: string[];
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
  // ─── Contrafactual ("se desligar isso hoje, quem reclama?") ───
  // QUEM sente falta é escolhido na Team Guide (mesma fonte do autocomplete da Etapa 1),
  // dinamicamente por PESSOA ou por TIME/ÁREA — quando o impacto é de um time inteiro,
  // não se marca pessoa por pessoa. `tipo` decide qual seletor aparece; a lista guarda
  // e-mails (pessoa) ou nomes de área (time). A RASTREABILIDADE (ponteiro movido + onde
  // verificar) NÃO vem mais do formulário — é conduzida pelo agente no memorial, e o
  // "o que piora" (`contrafactualReclamacao`) foi REMOVIDO em 03/08/2026.
  contrafactualAfetadosTipo: AfetadoTipo;
  contrafactualAfetados: string[];
  // Projeto especial (etapa 2.5): altíssimo impacto que não se encaixa em saving/receita.
  especial: boolean;
  contextoEspecial: string;
  // ─── Triagem do especial (Etapa 2.5, só quando `especial` é true) ───
  // Duas perguntas sim/não, EM SEQUÊNCIA (a 2ª só aparece depois da 1ª), antes do
  // contexto especial. Qualquer "sim" DESQUALIFICA o especial e bloqueia o envio
  // (ver `motivoBloqueioEspecial` + `mensagens-submissao.ts`). '' = não respondida.
  // ⚠️ São campos SÓ DO FRONTEND (como `prodStatus`): não vão ao backend, a nenhum
  // prompt e a nenhuma coluna do Sheets — o papel delas é impedir a submissão
  // errada na porta, e o que sobrevive ao envio é a natureza do projeto
  // (`especial`/`tipos_projeto`), que já é gravada.
  especialDashboard: "sim" | "nao" | "";
  especialGanhoOrganizacional: "sim" | "nao" | "";
}

// Quem sentiria falta se a automação parasse: pessoas específicas OU um time/área
// inteiro (evita marcar pessoa por pessoa quando o impacto é do time todo).
export type AfetadoTipo = "pessoa" | "time";

export const AFETADO_TIPOS: { value: AfetadoTipo; label: string }[] = [
  { value: "pessoa", label: "👤 Pessoas específicas" },
  { value: "time", label: "👥 Um time/área inteiro" },
];

// Serialização das duas respostas para o banco (e para a comparação de metaChanged):
// "pessoa:a@x.com;b@y.com". Puras — testáveis isoladas.
export function serializarAfetados(tipo: AfetadoTipo, lista: string[]): string {
  const limpa = lista.map((v) => v.trim()).filter(Boolean);
  return limpa.length ? `${tipo}:${limpa.join(";")}` : "";
}

export function desserializarAfetados(bruto: string | null | undefined): {
  tipo: AfetadoTipo;
  lista: string[];
} {
  const txt = (bruto ?? "").trim();
  const sep = txt.indexOf(":");
  const tipo: AfetadoTipo = txt.slice(0, sep) === "time" ? "time" : "pessoa";
  const lista =
    sep < 0
      ? []
      : txt
          .slice(sep + 1)
          .split(";")
          .map((v) => v.trim())
          .filter(Boolean);
  return { tipo, lista };
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
