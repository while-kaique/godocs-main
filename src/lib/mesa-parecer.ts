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

/**
 * Tira TRAVESSÃO e HÍFEN-COMO-PONTUAÇÃO do texto do agente (decisão do Luis, 01/09/2026: o parecer
 * não usa traços). Vira ponto ou vírgula, conforme o que já havia antes.
 *
 * ⚠️ **Mantém o hífen DENTRO da palavra** (`e-mail`, `pré-aprovação`, `custo-benefício`): ali ele é
 * ortografia, não pontuação, e apagá-lo escreveria errado. Só casa traço cercado de espaço, traço
 * no começo da linha, e o travessão/en dash em qualquer posição (esses nunca são ortografia).
 *
 * ⚠️ Isto é a TRAVA determinística. A instrução equivalente também está no prompt, mas neste repo
 * "prompt não segura" já custou caro 3 vezes, então a régua final é esta função.
 */
export function semTravessao(texto: string | null | undefined): string {
  let t = (texto ?? '').replace(/^[\s]*[—–-]+[\s]*/, '');
  const junta = (fonte: string, off: number) => {
    const antes = fonte.slice(0, off).trimEnd().slice(-1);
    return /[,.;:!?]/.test(antes) ? ' ' : ', ';
  };
  // travessão e en dash: sempre pontuação
  t = t.replace(/\s*[—–]\s*/g, (_m, off: number) => junta(t, off));
  // hífen SOLTO (cercado de espaço) usado como travessão
  t = t.replace(/\s+-+\s+/g, (_m, off: number) => junta(t, off));
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
