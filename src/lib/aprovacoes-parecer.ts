/**
 * Leitura do parecer do líder a partir da PLANILHA — módulo PURO (roda no cliente).
 *
 * Por que ler da planilha e não da tabela `projeto_aprovacoes`: a ficha de triagem do
 * `/dashboard` tem como invariante que a fonte de verdade é a linha do Sheets
 * (`readAllRows`, nunca o SQLite — ver o cabeçalho de `dashboard-admin.functions.ts`).
 * O detalhe já traz a linha INTEIRA, então o parecer chega sem nenhuma leitura nova, e
 * funciona igual para linha criada por outro ambiente, legado importado ou fila
 * reaberta à mão.
 *
 * O que este módulo faz: desmonta o texto que `justificativaAprovacaoSheet`
 * (`aprovacoes.functions.ts`) monta, para a tela poder exibir cada pedaço no seu lugar
 * em vez de um bloco corrido. O formato escrito é:
 *
 *     Pré-aprovado por Ana Lima (ana@x.com) em 05/08/2026
 *     O projeto move algum KPI da área? — não
 *     Se este projeto fosse desligado hoje, a área sentiria falta? — sim
 *     O saving declarado é coerente com o impacto que você vê na área? — sim
 *     Justificativa do "não" em Move KPI: o ganho aqui é risco fiscal, não KPI de área.
 *
 * ⚠️ As perguntas são reconhecidas pela FONTE ÚNICA `CHECKLIST_APROVACAO`
 * (`aprovacoes-checklist.ts`) — o parser NÃO tem os textos digitados. Mudar a redação de
 * uma pergunta lá continua funcionando aqui; pareceres JÁ GRAVADOS com a redação antiga
 * deixam de casar e caem em `outras` (aparecem na tela como vieram, nunca somem).
 * O teste de ida-e-volta em `tests/dashboard-parecer-lider.test.ts` prende os dois lados.
 */
import { CHECKLIST_APROVACAO, type RespostaChecklist } from '@/lib/aprovacoes-checklist';
import { valorDaColuna } from '@/lib/coluna-chave';

/** Nomes das colunas como o CÓDIGO os escreve (acentuados, regra 4). O casamento com o
 *  cabeçalho real é tolerante — em prod/staging a segunda é "…do Lider". */
export const COLUNA_ESTADO_LIDER = 'Aprovação do Líder';
export const COLUNA_JUSTIFICATIVA_LIDER = 'Justificativa Aprovação do Líder';

// 'dispensado' (D29) NÃO é um veredito: é a fila fechada pelo sistema porque o
// analisador reprovou o projeto por critério. Fica separado de 'reprovado' de propósito —
// dizer "Pré-reprovado" seria afirmar que o líder recusou algo que ele nunca abriu.
export type EstadoParecer =
  | 'aprovado'
  | 'ajuste'
  | 'reprovado'
  | 'pendente'
  | 'dispensado'
  | 'sem_parecer';

export type ItemParecer = { pergunta: string; resposta: RespostaChecklist };

export type ParecerLider = {
  /** Rótulo cru da coluna de estado ("Pré-aprovado", "Ajuste pedido"…). */
  estado: string | null;
  estadoChave: EstadoParecer;
  /** "Ana Lima (ana@x.com)" — quem decidiu, quando o texto segue o formato conhecido. */
  assinatura: string | null;
  /** Data da decisão, como está na planilha (dd/mm/aaaa). */
  decididoEm: string | null;
  /**
   * Primeira linha quando ela NÃO é a assinatura de uma decisão: "Aguardando Ana, Bruno"
   * (fila aberta) ou o motivo da isenção ("Sem líder na TeamGuide", D12). É o que
   * distingue, na auditoria, isenção legítima de falha de integração.
   */
  cabecalho: string | null;
  checklist: ItemParecer[];
  /** Rótulo do texto livre, escrito por `rotuloComentarioSheet` (já legível). */
  comentarioRotulo: string | null;
  comentario: string | null;
  /** Linhas que não casaram nada — exibidas como vieram para nunca perder conteúdo. */
  outras: string[];
  /** Há "não" no checklist? É a contradição que a triagem precisa ver primeiro. */
  temNao: boolean;
  /** Nada a mostrar: a seção não aparece na ficha. */
  vazio: boolean;
};

const SEPARADOR = ' — '; // o mesmo que `detalharChecklist` usa

/** "—", "-" e vazio são ausência de valor na planilha (mesma régua do dashboard). */
function limpo(v: string | undefined | null): string | null {
  const s = String(v ?? '').trim();
  return s === '' || s === '—' || s === '-' ? null : s;
}

/**
 * Estado do parecer a partir do rótulo cru da coluna. EXPORTADA porque a TABELA do
 * dashboard mostra a mesma coluna ("Pré-status") e não pode ter uma segunda régua.
 */
export function chaveDoEstado(estado: string | null): EstadoParecer {
  const k = (estado ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (k === 'pre-aprovado' || k === 'pre aprovado') return 'aprovado';
  if (k === 'ajuste pedido') return 'ajuste';
  if (k === 'pre-reprovado' || k === 'pre reprovado') return 'reprovado';
  if (k === 'pre-pendente' || k === 'pre pendente') return 'pendente';
  if (k === 'dispensado') return 'dispensado';
  return 'sem_parecer';
}

/**
 * Uma linha do checklist? Casa pelo INÍCIO com uma das perguntas da fonte única. Devolve
 * `null` quando a linha é outra coisa.
 */
function lerLinhaChecklist(linha: string): ItemParecer | null {
  for (const p of CHECKLIST_APROVACAO) {
    const prefixo = `${p.pergunta}${SEPARADOR}`;
    if (!linha.startsWith(prefixo)) continue;
    const resp = linha.slice(prefixo.length).trim().toLowerCase();
    // A planilha guarda "não" com acento (regra 4); aceita "nao" por segurança.
    if (resp === 'não' || resp === 'nao') return { pergunta: p.pergunta, resposta: 'nao' };
    if (resp === 'sim') return { pergunta: p.pergunta, resposta: 'sim' };
    return null; // pergunta conhecida com resposta que não entendemos: cai em `outras`
  }
  return null;
}

/**
 * Assinatura da decisão: "<estado> por <nome> (<email>) em <data>". O estado da linha é
 * descartado (a coluna própria já o tem, e é ela que manda).
 */
function lerAssinatura(linha: string): { assinatura: string; decididoEm: string } | null {
  const m = /^.*? por (.+) em (\d{1,2}\/\d{1,2}\/\d{2,4})\s*$/.exec(linha);
  return m ? { assinatura: m[1].trim(), decididoEm: m[2].trim() } : null;
}

/**
 * Desmonta o parecer. `campos` é a linha da planilha chaveada pelo cabeçalho REAL — a
 * busca das duas colunas tolera acento/caixa (`valorDaColuna`).
 */
export function interpretarParecerLider(campos: Record<string, string>): ParecerLider {
  const estado = limpo(valorDaColuna(campos, COLUNA_ESTADO_LIDER));
  const bruto = limpo(valorDaColuna(campos, COLUNA_JUSTIFICATIVA_LIDER));

  const out: ParecerLider = {
    estado,
    estadoChave: chaveDoEstado(estado),
    assinatura: null,
    decididoEm: null,
    cabecalho: null,
    checklist: [],
    comentarioRotulo: null,
    comentario: null,
    outras: [],
    temNao: false,
    vazio: estado == null && bruto == null,
  };
  if (bruto == null) return out;

  const linhas = bruto.split('\n').map((l) => l.trim());

  // 1ª linha: assinatura da decisão, ou o texto de fila aberta / isenção.
  const primeira = linhas[0] ?? '';
  const assinado = lerAssinatura(primeira);
  if (assinado) {
    out.assinatura = assinado.assinatura;
    out.decididoEm = assinado.decididoEm;
  } else if (primeira && !lerLinhaChecklist(primeira)) {
    out.cabecalho = primeira;
  }

  // Da 2ª em diante: perguntas do checklist e, por último, o texto livre do líder.
  // ⚠️ O comentário é sempre a ÚLTIMA parte e pode ter várias linhas (o líder aperta
  // Enter na caixa): tudo que vem depois do rótulo pertence a ele.
  const inicio = assinado || out.cabecalho ? 1 : 0;
  for (let i = inicio; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;
    const item = lerLinhaChecklist(linha);
    if (item) {
      out.checklist.push(item);
      continue;
    }
    const sep = linha.indexOf(': ');
    if (sep > 0) {
      out.comentarioRotulo = linha.slice(0, sep).trim();
      const resto = [linha.slice(sep + 2), ...linhas.slice(i + 1)].join('\n').trim();
      out.comentario = resto || null;
      break; // o resto do texto é do líder, não são campos
    }
    out.outras.push(linha);
  }

  out.temNao = out.checklist.some((c) => c.resposta === 'nao');
  return out;
}
