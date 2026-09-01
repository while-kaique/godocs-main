/**
 * Parecer da MESA de avaliação (sombra) — FONTE ÚNICA, PURA e importável pelo bundle do CLIENTE.
 *
 * O agregador marca cada frase do parecer com o especialista que a escreveu (`"Financeiro: ..."`)
 * e junta as linhas com `\n`; a ficha do `/dashboard` renderiza uma linha por especialista. Isto
 * mora aqui, e não em `agents/especialista-avaliacao.ts`, porque a TELA precisa dos rótulos e
 * importar aquele arquivo arrastaria os PROMPTS (personas, instruções) para o bundle do cliente.
 *
 * ⚠️ Sem imports de servidor. O `DimensaoAvaliacao` entra como `import type` (apagado no build).
 */
import type { DimensaoAvaliacao } from '@/lib/agents/especialista-avaliacao';

/**
 * Rótulo CURTO da dimensão — para a TELA. Separado do `ROTULO_DIMENSAO` de
 * `especialista-avaliacao.ts`, que é longo de propósito porque vai no PROMPT.
 * ⚠️ Sem parênteses e sem "adversarial": em bullet de 12px o rótulo tem de caber numa palavra.
 */
export const ROTULO_CURTO_DIMENSAO: Record<DimensaoAvaliacao, string> = {
  fte: 'Horas',
  financeiro: 'Financeiro',
  rag: 'Precedente',
  cetico: 'Cético',
};

/** Uma linha do parecer: com autor (frase de um especialista) ou sem (nota de fechamento da mesa). */
export type LinhaParecer = { autor: string | null; texto: string };

const AUTORES = Object.values(ROTULO_CURTO_DIMENSAO);

/**
 * Parte o `motivo` gravado em linhas atribuídas. Reconhece o prefixo `"<Autor>: "` **só** quando o
 * autor é um dos 4 rótulos conhecidos — assim uma frase que por acaso tenha dois-pontos no meio
 * ("Resultado: 40%") não é lida como autor.
 *
 * ⚠️ Tolerante ao FORMATO ANTIGO: parecer gravado antes de 01/09/2026 é um parágrafo corrido sem
 * `\n` e sem prefixo — ele volta como UMA linha sem autor, e a ficha o mostra como sempre. Nenhum
 * backfill é necessário para a tela não quebrar.
 */
export function partirParecerMesa(motivo: string | null | undefined): LinhaParecer[] {
  const bruto = (motivo ?? '').trim();
  if (!bruto) return [];
  const linhas: LinhaParecer[] = [];
  for (const cru of bruto.split('\n')) {
    const linha = cru.trim();
    if (!linha) continue;
    const autor = AUTORES.find((a) => linha.startsWith(`${a}:`)) ?? null;
    if (autor) {
      // Prefixo sem texto atrás ("Financeiro:") não vira bullet órfão — some.
      const texto = linha.slice(autor.length + 1).trim();
      if (texto) linhas.push({ autor, texto });
      continue;
    }
    linhas.push({ autor: null, texto: linha });
  }
  return linhas;
}
