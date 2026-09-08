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
import type { EixoCorrecao } from '@/lib/correcoes';

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

/**
 * De qual especialista é a frase que cada EIXO de discordância contesta — FONTE ÚNICA da tela
 * (que mostra a citação) e do servidor (que a grava como `leitura_do_agente`).
 *
 * ⚠️ `impacto_irrelevante` cai no FINANCEIRO de propósito: "o ganho é pequeno demais" é objeção
 * do eixo do dinheiro, e é justamente ali que o repo tinha teto de materialidade e NENHUM piso.
 * `outro` não aponta ninguém — quando o erro não é de um eixo, citar um seria pôr palavra na boca
 * de quem não falou.
 */
export const AUTOR_DO_EIXO: Record<EixoCorrecao, string | null> = {
  horas: ROTULO_CURTO_DIMENSAO.fte,
  financeiro: ROTULO_CURTO_DIMENSAO.financeiro,
  precedente: ROTULO_CURTO_DIMENSAO.rag,
  impacto_irrelevante: ROTULO_CURTO_DIMENSAO.financeiro,
  outro: null,
};

/** Uma linha do parecer: com autor (frase de um especialista) ou sem (nota de fechamento da mesa). */
export type LinhaParecer = { autor: string | null; texto: string };

const AUTORES = Object.values(ROTULO_CURTO_DIMENSAO);

/**
 * A frase do parecer que o EIXO escolhido contesta — `null` quando não há uma.
 *
 * ⚠️ Quem a resolve é sempre este helper, nos DOIS lados: a tela mostra a citação para a pessoa
 * responder a ela, e o servidor grava a MESMA frase como `leitura_do_agente` da lição. Se cada
 * lado escolhesse a frase por conta, o par argumento/réplica guardaria uma réplica a uma frase
 * que o agente nem disse ali. E é o servidor que resolve, não o cliente: a palavra do agente não
 * chega pelo payload de quem está discordando dele.
 *
 * ⚠️ Parecer LEGADO (parágrafo corrido, sem autor) e eixo `outro` devolvem `null` — não há frase
 * DAQUELE eixo a citar, e inventar uma seria pior. Cabe ao chamador decidir o que fazer com o
 * `null`: quem grava a lição cai no parecer INTEIRO, porque ali o defeito que se evitava era
 * outro (a frase de um especialista sendo atribuída ao eixo errado), e um contexto genérico do
 * que o agente disse ainda é melhor que meio par vazio.
 */
export function linhaDoEixo(
  parecer: LinhaParecer[],
  eixo: EixoCorrecao | null | undefined,
): LinhaParecer | null {
  if (!eixo) return null;
  const autor = AUTOR_DO_EIXO[eixo];
  if (!autor) return null;
  return parecer.find((l) => l.autor === autor) ?? null;
}

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
