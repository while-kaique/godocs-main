/**
 * Ações de triagem disponíveis no cartão de `/especiais` — módulo PURO.
 *
 * A tela deixou de ser só de leitura: quem valida decide ali mesmo, sem passar pelo
 * `/dashboard`. A escrita continua sendo a MESMA (`POST /api/admin/dashboard/status` →
 * `definirStatusProjeto`), com a mesma auditoria em `admin_status_log` — aqui só mora o
 * vocabulário das três ações e a regra de quando o motivo é obrigatório.
 *
 * ⚠️ **Reprovar e pedir reenvio exigem motivo**, e não por formalidade: o texto de "Motivo
 * Reprovado" é o que o autor vê no card dele, e o de "Motivo Reenvio" é o que o disparo de
 * e-mails manda. Decisão negativa sem texto vira um "não" mudo para quem submeteu.
 */

/** O que a triagem pode fazer daqui. Aprovar é o único caminho sem texto obrigatório. */
export type AcaoTriagem = 'aprovar' | 'reenviar' | 'reprovar';

/** Status gravado por cada ação — os mesmos rótulos do dropdown da planilha. */
export const STATUS_GRAVAVEIS_ESPECIAIS: Record<AcaoTriagem, string> = {
  aprovar: 'Aprovado',
  reenviar: 'Reenvio Pendente',
  reprovar: 'Reprovado',
};

export const ROTULO_ACAO: Record<AcaoTriagem, string> = {
  aprovar: 'Aprovar',
  reenviar: 'Pedir reenvio',
  reprovar: 'Reprovar',
};

export function rotuloAcao(acao: AcaoTriagem): string {
  return ROTULO_ACAO[acao];
}

export function precisaMotivo(acao: AcaoTriagem): boolean {
  return acao !== 'aprovar';
}

/**
 * O campo em que o motivo é gravado. São colunas DIFERENTES de propósito: "Motivo Reenvio" é
 * escrita só pela triagem humana e alimenta o e-mail de reenvio, enquanto "Motivo Reprovado"
 * também recebe o parecer do analisador — misturar as duas apagaria um dos dois textos.
 */
export function campoDoMotivo(acao: AcaoTriagem): 'motivo_reenvio' | 'motivo_reprovado' | null {
  if (acao === 'reenviar') return 'motivo_reenvio';
  if (acao === 'reprovar') return 'motivo_reprovado';
  return null;
}

/** O que a pergunta acima do campo de texto diz, por ação. */
export const PERGUNTA_MOTIVO: Record<'reenviar' | 'reprovar', string> = {
  reenviar: 'O que precisa ser corrigido? O autor recebe este texto por e-mail.',
  reprovar: 'Por que este projeto não passa? O autor vê este texto no card dele.',
};
