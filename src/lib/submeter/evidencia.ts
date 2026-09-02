// Campo de EVIDÊNCIA — módulo PURO da régua.
//
// D1: o saving efetivado é o ganho comprovável (a linha de custo existia e parou), e é o
// único bloco que pede prova. RF-208: **anexo sem texto é RECUSADO** — a imagem sozinha
// não diz por que aquele número é desta automação, e é justamente essa amarração que a
// triagem precisa ler. O mesmo componente serve ao racional do ganho imensurável, onde o
// texto é tudo o que existe.
export const EVIDENCIA_MIN = 20

/** Um anexo já lido (base64) — o mesmo shape que o backend recebe em `docs`. */
export type AnexoEvidencia = { base64: string; filename: string }

/**
 * A mensagem do que falta, ou `null` quando está válido.
 *
 * ⚠️ São DUAS mensagens distintas de propósito: "texto curto/ausente" e "anexo sem
 * texto". A segunda existe porque quem anexou o print acha que já provou — dizer só
 * "informe a evidência" ao lado de um anexo aceito parece bug do formulário.
 */
export function erroEvidencia(texto: string, anexos: AnexoEvidencia[]): string | null {
  const escrito = (texto ?? '').trim()
  if (escrito.length >= EVIDENCIA_MIN) return null

  if (anexosUteis(anexos).length > 0) {
    return (
      `O anexo entra como apoio, mas não substitui a explicação: escreva em pelo menos ` +
      `${EVIDENCIA_MIN} caracteres o que ele mostra e por que esse ganho é desta solução.`
    )
  }
  return (
    `Explique em pelo menos ${EVIDENCIA_MIN} caracteres de onde vem esse ganho e onde ` +
    `alguém confere o número.`
  )
}

export function evidenciaValida(texto: string, anexos: AnexoEvidencia[]): boolean {
  return erroEvidencia(texto, anexos) === null
}

/** Anexos que dá para enviar (base64 não-vazio) — 0 bytes derruba o zod do backend. */
export function anexosUteis(anexos: AnexoEvidencia[]): AnexoEvidencia[] {
  return (anexos ?? []).filter(
    (a) => typeof a?.base64 === 'string' && a.base64.trim() !== '',
  )
}
