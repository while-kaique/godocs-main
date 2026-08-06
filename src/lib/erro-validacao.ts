/**
 * Tradução de erro de validação (Zod) para uma mensagem que a PESSOA entende.
 *
 * Origem (bug real, 05/08/2026 — caso Josiely): o campo "Especifique a ferramenta"
 * não tinha limite na tela, o schema tinha `max(200)` e o `ZodError` subia CRU pelo
 * `errorJson(err.message, 500)` — o toast mostrava
 * `[{"code":"too_big","maximum":200,…}]` em inglês. A pessoa tentou 10 vezes sem
 * saber o que corrigir. Aqui o erro vira 400 + frase em PT-BR NOMEANDO o campo e o
 * limite, para dar um próximo passo acionável.
 *
 * Módulo PURO (sem I/O, sem `process.env`) — testável e seguro de importar no worker.
 */

/** Rótulos como a pessoa VÊ o campo no formulário (não o nome técnico). */
const ROTULOS: Record<string, string> = {
  ferramenta: "Ferramenta utilizada",
  servico_externo: "Serviço externo contratado",
  nome_projeto: "Nome do projeto",
  descricao_breve: "Descrição do projeto",
  contrafactual_afetados: "Quem sentiria falta",
  contrafactual_reclamacao: "O que piora sem a automação",
  contexto_especial: "Contexto do projeto especial",
  responsavel_nome: "Nome do responsável",
  responsavel_email: "E-mail do responsável",
  area: "Área",
  content: "Mensagem",
  docs: "Arquivos",
  linhas: "Tabela de horas",
  membros: "Participantes",
  data_criacao: "Data de criação",
};

/** Uma issue do Zod, no mínimo que precisamos (duck typing — não importamos zod aqui). */
interface IssueLike {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  maximum?: unknown;
  minimum?: unknown;
  type?: unknown;
}

/** Detecta um ZodError sem depender da classe (o worker não importa zod). */
function extrairIssues(err: unknown): IssueLike[] | null {
  const e = err as { name?: unknown; issues?: unknown } | null;
  if (!e || typeof e !== "object") return null;
  if (!Array.isArray(e.issues) || e.issues.length === 0) return null;
  if (e.name !== undefined && e.name !== "ZodError") return null;
  return e.issues as IssueLike[];
}

function rotulo(path: unknown): string {
  if (!Array.isArray(path) || path.length === 0) return "um dos campos";
  // Pega o último segmento nomeado (ex.: ['docs', 0, 'base64'] → 'base64').
  const nomes = path.filter((p): p is string => typeof p === "string");
  const chave = nomes[0] ?? "";
  return ROTULOS[chave] ?? (chave ? `"${chave}"` : "um dos campos");
}

/** Frase para UMA issue. */
function frase(issue: IssueLike): string {
  const campo = rotulo(issue.path);
  const max = typeof issue.maximum === "number" ? issue.maximum : null;
  const min = typeof issue.minimum === "number" ? issue.minimum : null;

  switch (issue.code) {
    case "too_big":
      if (issue.type === "array" && max !== null)
        return `${campo}: no máximo ${max} ${max === 1 ? "item" : "itens"}.`;
      return max !== null
        ? `${campo}: texto muito longo — o limite é ${max} caracteres. Encurte e tente de novo.`
        : `${campo}: conteúdo muito longo.`;
    case "too_small":
      if (issue.type === "array")
        return `${campo}: envie ${min && min > 1 ? `pelo menos ${min} itens` : "pelo menos 1 item"}.`;
      return `${campo}: preencha este campo.`;
    case "invalid_type":
      return `${campo}: preencha este campo.`;
    case "invalid_string":
      return `${campo}: formato inválido.`;
    case "invalid_enum_value":
      return `${campo}: opção inválida — escolha uma das opções da tela.`;
    default:
      return `${campo}: valor inválido.`;
  }
}

/**
 * Traduz um erro de validação em `{ status: 400, mensagem }` legível.
 * Devolve `null` quando o erro NÃO é de validação (aí o chamador segue o fluxo
 * normal de 500 — não engolimos falhas de verdade como se fossem do usuário).
 */
export function traduzirErroValidacao(err: unknown): { status: number; mensagem: string } | null {
  const issues = extrairIssues(err);
  if (!issues) return null;

  // No máximo 3 frases: mais que isso vira parede de texto num toast.
  const frases = Array.from(new Set(issues.map(frase))).slice(0, 3);
  const extra = issues.length > frases.length ? ` (+${issues.length - frases.length} outro(s) campo(s))` : "";

  return {
    status: 400,
    mensagem: `Não foi possível enviar — revise ${frases.length > 1 ? "os campos" : "o campo"}: ${frases.join(" ")}${extra}`,
  };
}
