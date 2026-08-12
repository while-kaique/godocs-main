// QUANDO o grupo do Google Chat é avisado de um projeto. Módulo PURO — FONTE ÚNICA
// do "quando" e dos textos das notas (não redigitar em call site nenhum).
//
// Régua (decisão do Luis, 11/08/2026): o alerta do grupo deixou de sair a cada
// submissão/edição e passa a sair quando o projeto está LIBERADO do lado do líder.
// Só que "liberado" tem dois caminhos:
//   • a fila REALMENTE abriu (`isento: false`) → o aviso ESPERA a pré-aprovação
//     (quem dispara é `decidirAprovacao`, veredito 'aprovado');
//   • não há ninguém para pré-aprovar (isenção) → o aviso sai JÁ, na submissão, com
//     uma nota dizendo POR QUE não há parecer.
//
// ⚠️ O default é INVERTIDO em relação ao intuitivo, e isso é a decisão central deste
// módulo: diante de um estado que ele não sabe interpretar (motivo `null`, ou um motivo
// NOVO que ninguém mapeou aqui), avisa na SUBMISSÃO. Projeto sem ninguém para aprová-lo
// não pode ficar invisível esperando um parecer que nunca chega — silenciar sumiria com
// ele do grupo para sempre, e a integração da TeamGuide já caiu antes.

/** Motivos de isenção devolvidos por `abrirPreAprovacao` (`ResultadoAbertura['motivo']`). */
export type MotivoIsencaoNotificacao =
  | 'lideranca'
  | 'sem_lider'
  | 'teamguide_indisponivel'
  | 'especial'
  | null;

export type MomentoNotificacao = {
  /** 'submissao' = avisa agora · 'pre_aprovacao' = espera o parecer do líder. */
  quando: 'submissao' | 'pre_aprovacao';
  /** Linha que explica a AUSÊNCIA de parecer. `null` = nada a explicar. */
  nota: string | null;
};

// Textos das notas. Cada caso tem o seu: quem lê o grupo precisa distinguir a isenção
// legítima (o autor é liderança) de uma falha de integração (TeamGuide fora) — foi a
// mesma razão que separou os rótulos da coluna "Aprovação do Líder" (D12).
export const NOTA_SEM_PARECER: Record<'lideranca' | 'sem_lider' | 'teamguide_indisponivel', string> = {
  lideranca:
    'Sem pré-aprovação de líder: o autor tem cargo de liderança (coordenação para cima) e vai direto para a validação da RPA.',
  sem_lider:
    'Sem pré-aprovação de líder: não foi encontrado líder direto do autor na TeamGuide.',
  teamguide_indisponivel:
    'Sem pré-aprovação de líder: a TeamGuide estava indisponível na submissão e a fila não pôde ser aberta.',
};

// Nota do caminho DESCONHECIDO (motivo `null` ou um motivo futuro ainda não mapeado).
// Diz o fato — "não entrou na fila" — sem afirmar um porquê que não se sabe.
export const NOTA_SEM_PARECER_DESCONHECIDO =
  'Sem pré-aprovação de líder: este projeto não entrou na fila de pré-aprovação.';

/**
 * Decide quando o grupo é avisado, a partir do resultado de `abrirPreAprovacao`.
 *
 * ⚠️ Só `isento === false` faz o alerta calar. QUALQUER isenção notifica na submissão —
 * inclusive um motivo que o futuro acrescente (o `default`). Ver o cabeçalho.
 */
export function decidirMomentoNotificacao(r: {
  isento: boolean;
  motivo: MotivoIsencaoNotificacao;
}): MomentoNotificacao {
  // Fila aberta de verdade: o grupo só ouve falar deste projeto quando o líder liberar.
  if (r.isento === false) return { quando: 'pre_aprovacao', nota: null };

  switch (r.motivo) {
    // Especial (D27) não abre fila e tem mensagem PRÓPRIA, que já se explica sozinha —
    // uma nota de "não há parecer" só repetiria o que o cabeçalho dela diz.
    case 'especial':
      return { quando: 'submissao', nota: null };
    case 'lideranca':
    case 'sem_lider':
    case 'teamguide_indisponivel':
      return { quando: 'submissao', nota: NOTA_SEM_PARECER[r.motivo] };
    default:
      return { quando: 'submissao', nota: NOTA_SEM_PARECER_DESCONHECIDO };
  }
}

/**
 * Decide se ESTA decisão do líder é a que avisa o grupo, a partir de quantas linhas o
 * `UPDATE` da fila escreveu (`decidirAprovacoesDoProjeto`).
 *
 * O gate de `decidirAprovacao` é check-then-act — lê a linha `pendente` por `SELECT` e só
 * depois grava. Duas requisições que leem antes de qualquer uma escrever passam as DUAS
 * pelo gate: duplo clique, retry do cliente, ou dois líderes da mesma fila (D4). Quem
 * serializa de fato é o `UPDATE ... AND veredito = 'pendente'`, e é o número de linhas
 * dele que diz quem chegou primeiro. Sem tabela nem coluna nova: o ponto de serialização
 * já existia, faltava só ler o resultado.
 *
 * ⚠️ O default é INVERTIDO, pela mesma razão de `decidirMomentoNotificacao` acima:
 * `null` (o adaptador não reportou) **NOTIFICA**. Silenciar no desconhecido trocaria
 * "duas mensagens" por "nenhuma mensagem" — o dano barulhento pelo dano invisível. E o
 * desconhecido aqui é real: nenhum caminho de produção lia `rowsWritten` antes desta
 * mudança, então o comportamento do `env.DB` do Godeploy não foi observado.
 */
export function deveNotificarDecisao(linhasGravadas: number | null): boolean {
  if (linhasGravadas === null) return true; // "não sei" ≠ "zero"
  return linhasGravadas > 0;
}
