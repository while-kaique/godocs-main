// Remove marcadores de markdown (#, *, _, `, links, citações) MANTENDO o texto e
// as quebras de linha. Usado SÓ na fronteira de persistência (SQLite/Sheets via
// n8n) — o markdown cru continua em documentacao.conteudo, que alimenta o preview
// do chat. Sem isso, o memorial/observações chegam ao Sheets poluídos com `**`, `#`, etc.
export function stripMarkdown(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text
    .replace(/```[^\n]*\n?/g, '')              // cercas de bloco de código ```
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1') // links/imagens [txt](url) → txt
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')        // headings ## no início da linha
    .replace(/^\s{0,3}>\s?/gm, '')             // citações > no início da linha
    .replace(/^(\s*)[*+-]\s+/gm, '$1- ')       // bullets (*, +, -) → "- "
    .replace(/(\*\*|__)(.*?)\1/g, '$2')        // negrito **x** / __x__
    .replace(/\*([^*\n]+)\*/g, '$1')           // itálico *x* (só asterisco, p/ não mexer em snake_case)
    .replace(/`([^`]*)`/g, '$1')               // código inline `x`
    .trim();
}
