// Formatação do memorial para LEITURA (pós-submissão).
//
// O orquestrador monta o memorial seguindo uma estrutura fixa de pontos
// numerados ([1.1], [2.2], [6.1] …) — esses códigos são o CHECKLIST INTERNO do
// agente (garantem que nenhum ponto obrigatório seja pulado), mas NÃO devem
// aparecer no texto que o aprovador lê: "[2.2] textotextotexto [2.3]" não diz
// nada a quem bate o olho. Esta função troca cada código pelo TÍTULO legível do
// ponto, mantendo a estrutura. É idempotente (texto sem códigos volta igual) e
// determinística — roda no render (tela read-only, chat) e no enriquecimento do
// memorial interno (planilha), cobrindo também memoriais legados já gravados com
// os códigos.

// Título de cada ponto do memorial padronizado. As chaves espelham os códigos
// usados nos prompts do orquestrador (buildSavingPrompt / buildReceitaPrompt).
export const TITULOS_MEMORIAL: Record<string, string> = {
  // Seção 1 — Contexto
  '1.1': 'Projeto',
  '1.2': 'Resumo',
  // Seção 2 — Saving de pessoas
  '2.1': 'Pessoas envolvidas',
  '2.2': 'Detalhe por pessoa',
  '2.3': 'Total de horas',
  // Seção 3 — Contratos / serviços evitados
  '3.1': 'Serviço evitado',
  '3.2': 'Custo evitado',
  '3.3': 'Rateio',
  // Seção 4 — Custo da automação
  '4.1': 'Ferramenta externa',
  '4.2': 'Monitoramento',
  '4.3': 'Custo total',
  // Seção 5 — Resumo do saving
  '5.1': 'Economia de horas',
  '5.2': 'Tipo de saving',
  // Seção 6 — Receita incremental
  '6.1': 'O que gera a receita',
  '6.2': 'Como aumenta a receita',
  '6.3': 'Antes vs. depois',
  '6.4': 'Base de cálculo',
  '6.5': 'Valor da receita',
  '6.6': 'Tipo',
};

// Captura um marcador [x.y] ou um intervalo [x.y-x.z] (o template de N/A usa
// faixas como "[3.1-3.3]"). Em ambos os casos o título do PRIMEIRO código é o
// rótulo da linha. Códigos desconhecidos são removidos para não deixar ruído.
// Consome o espaço logo após o marcador para não sobrar lacuna ao remover um
// código desconhecido — assim a substituição é cirúrgica (não mexe na
// indentação de listas nem em espaços de outras partes do texto).
const MARCADOR = /\[(\d+\.\d+)(?:\s*[-–]\s*\d+\.\d+)?\][ \t]*/g;

/**
 * Troca os códigos [x.y] do memorial pelos títulos legíveis correspondentes.
 *
 * - `[2.2] fazia X` → `**Detalhe por pessoa:** fazia X`
 * - `[3.1-3.3] N/A` → `**Serviço evitado:** N/A`
 * - código fora da tabela → marcador removido (limpa o ruído)
 *
 * Não toca em nada além dos marcadores; o restante do markdown (##, ###, **, -)
 * é preservado. Idempotente: rodar duas vezes não muda o resultado.
 */
export function normalizarMarcadoresMemorial(texto: string | null | undefined): string {
  if (!texto) return texto ?? '';
  return texto.replace(MARCADOR, (_full, codigo: string) => {
    const titulo = TITULOS_MEMORIAL[codigo];
    return titulo ? `**${titulo}:** ` : '';
  });
}
