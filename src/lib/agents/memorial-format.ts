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
  '1.3': 'Processo alterado',
  '1.4': 'Ponteiro movido e onde verificar',
  // Seção 2 — Saving de pessoas
  '2.1': 'Pessoas envolvidas',
  '2.2': 'Detalhe por pessoa',
  '2.3': 'Total de horas',
  '2.4': 'O que mudou após a automação',
  '2.5': 'Carga real e ganho por escala',
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

// ─── Esqueleto do memorial financeiro — FONTE ÚNICA da estrutura ─────────────
// As SEÇÕES do memorial (+ se cada uma é obrigatória/condicional/opcional por
// perfil de ganho) são declaradas AQUI e renderizadas por descreverEsqueletoMemorial()
// para dentro dos prompts do orquestrador (buildSaving*/buildReceita*).
//
// ⚠️ REGRA: ao EVOLUIR o sistema — novo perfil de ganho, nova seção/campo obrigatório,
// nova coluna do Sheets derivada do memorial — atualize ESTE esqueleto. Ele é a FONTE
// ÚNICA da estrutura; os prompts devem derivar dele para nunca sair de sincronia com o
// que o validador/planilha esperam. (Migração incremental: o `custo_evitado` já deriva
// daqui; `saving`/`receita` herdam o detalhamento inline e migram aos poucos.)
//
// modo: 'saving' (economia de horas, real ou contrafactual) · 'custo_evitado' (ganho
// 100% custo externo eliminado, SEM horas — alguem_fazia='externo') · 'receita'.
export type ModoMemorial = 'saving' | 'custo_evitado' | 'receita';

export type SecaoEsqueleto = {
  secao: string;        // cabeçalho "### ..." da seção no memorial
  nivel: 'obrigatoria' | 'condicional' | 'opcional';
  gatilho?: string;     // quando 'condicional'/'opcional': em que situação se aplica
  conteudo: string;     // o que a seção deve conter (instrui o agente)
};

export const MEMORIAL_ESQUELETO: Record<ModoMemorial, SecaoEsqueleto[]> = {
  saving: [
    { secao: 'Contexto', nivel: 'obrigatoria', conteudo: '1-2 frases do que o projeto faz (use o que foi aprovado).' },
    { secao: 'Processo alterado', nivel: 'obrigatoria', conteudo: 'Qual rotina/processo mudou, como era ANTES, como é AGORA e a MAGNITUDE (volume, frequência, tempo). Sem R$. ⚠️ Se a documentação técnica JÁ APROVADA descreve o processo e a magnitude, escreva a seção a partir dela — NÃO pergunte de novo.' },
    { secao: 'Ponteiro movido e onde verificar', nivel: 'obrigatoria', conteudo: 'QUAL ponteiro o projeto moveu de fato — custo · receita · KPI da área (erro, retrabalho, prazo/SLA, fraude/risco) — e ONDE alguém pode abrir e conferir esse número (relatório, painel, sistema ou base NOMEADOS). Sem R$. É a RASTREABILIDADE da régua de critério de projeto: construa o racional COM o usuário; se ele não souber onde conferir, registre isso explicitamente em vez de inventar uma fonte.' },
    { secao: 'Saving de Pessoas', nivel: 'obrigatoria', conteudo: 'Por cargo: o que fazia, frequência×tempo, COMPOSIÇÃO das horas (quebra por atividade somando o total), horas antes/depois, economia.' },
    { secao: 'O que mudou após a automação', nivel: 'condicional', gatilho: 'saving MENSAL ≥ 44h no total OU em algum cargo', conteudo: 'Atividades concretas NOMEADAS para onde o tempo foi (nunca "outras atividades") + o que o time passou a entregar A MAIS, com NÚMERO quando houver (ex.: "tempo foi para hunting e entrevistas → 2-3 entrevistas a mais por dia") + frase concluindo a validade do ganho. Sem R$.' },
    { secao: 'Contratos/Serviços Evitados', nivel: 'opcional', gatilho: 'há um custo externo evitado DISTINTO das horas', conteudo: 'QUAL gasto a empresa deixou de pagar — o rótulo não importa (contrato, licença, serviço de terceiro, taxa, multa, juros, hora extra, retrabalho pago) —, o efeito qualitativo (sem R$) e o rateio. "N/A" quando não há.' },
    { secao: 'Custo da Automação', nivel: 'obrigatoria', conteudo: 'Ferramenta externa, monitoramento, custo total — ou "N/A".' },
    { secao: 'Resumo', nivel: 'obrigatoria', conteudo: 'Economia total de horas + tipo (mensal/pontual).' },
  ],
  custo_evitado: [
    { secao: 'Contexto', nivel: 'obrigatoria', conteudo: '1-2 frases do que o projeto faz (use o que foi aprovado).' },
    { secao: 'Processo alterado', nivel: 'obrigatoria', conteudo: 'Qual rotina/processo mudou, como era ANTES, como é AGORA e a MAGNITUDE (volume, frequência, tempo). Sem R$. ⚠️ Se a documentação técnica JÁ APROVADA descreve o processo e a magnitude, escreva a seção a partir dela — NÃO pergunte de novo.' },
    { secao: 'Ponteiro movido e onde verificar', nivel: 'obrigatoria', conteudo: 'QUAL ponteiro o projeto moveu de fato — custo · receita · KPI da área (erro, retrabalho, prazo/SLA, fraude/risco) — e ONDE alguém pode abrir e conferir esse número (relatório, painel, sistema ou base NOMEADOS). Sem R$. É a RASTREABILIDADE da régua de critério de projeto: construa o racional COM o usuário; se ele não souber onde conferir, registre isso explicitamente em vez de inventar uma fonte.' },
    { secao: 'Contratos/Serviços Evitados', nivel: 'obrigatoria', conteudo: 'É o ganho ÚNICO do projeto — registre COM SUBSTÂNCIA (validado com o usuário, sem R$): (a) QUAL gasto a empresa deixou de pagar, com o rótulo que ele tem de verdade (contrato, licença, serviço de terceiro, taxa, multa, juros, hora extra, retrabalho pago); (b) REALIDADE — já parou/caiu DE FATO na prática (não "vai ser"); (c) ATRIBUIÇÃO — a parada é POR CAUSA desta automação; (d) ESCOPO — o que o gasto cobria ou por que ele existia (ex.: 1 agente terceirizado, ~X atendimentos/mês; multa por recolher o imposto após o vencimento); rateio (mensal/pontual).' },
    { secao: 'Resumo', nivel: 'obrigatoria', conteudo: 'Ganho = custo externo eliminado + tipo. NÃO existe seção "Saving de Pessoas" nem horas neste perfil.' },
  ],
  receita: [
    { secao: 'Processo alterado', nivel: 'obrigatoria', conteudo: 'Qual rotina/processo mudou, como era ANTES, como é AGORA e a MAGNITUDE (volume, frequência, tempo). Sem R$. ⚠️ Se a documentação técnica JÁ APROVADA descreve o processo e a magnitude, escreva a seção a partir dela — NÃO pergunte de novo.' },
    { secao: 'Ponteiro movido e onde verificar', nivel: 'obrigatoria', conteudo: 'QUAL ponteiro o projeto moveu de fato — custo · receita · KPI da área (erro, retrabalho, prazo/SLA, fraude/risco) — e ONDE alguém pode abrir e conferir esse número (relatório, painel, sistema ou base NOMEADOS). Sem R$. É a RASTREABILIDADE da régua de critério de projeto: construa o racional COM o usuário; se ele não souber onde conferir, registre isso explicitamente em vez de inventar uma fonte.' },
    { secao: 'O que gera a receita', nivel: 'obrigatoria', conteudo: 'A fonte concreta da receita incremental.' },
    { secao: 'Como aumenta a receita', nivel: 'obrigatoria', conteudo: 'O mecanismo pelo qual o projeto aumenta a receita.' },
    { secao: 'Antes vs. depois', nivel: 'obrigatoria', conteudo: 'Comparação concreta do antes e do depois.' },
    { secao: 'Base de cálculo', nivel: 'obrigatoria', conteudo: 'A base de cálculo do valor declarado.' },
    { secao: 'Resumo', nivel: 'obrigatoria', conteudo: 'Valor da receita + tipo (mensal/pontual).' },
  ],
};

// Renderiza o esqueleto de um modo como texto para embutir no prompt do orquestrador.
// O agente recebe a lista de seções com o nível (obrigatória/condicional/opcional) e
// o que cada uma deve conter — derivado da FONTE ÚNICA acima.
export function descreverEsqueletoMemorial(modo: ModoMemorial): string {
  return MEMORIAL_ESQUELETO[modo]
    .map((s) => {
      const tag =
        s.nivel === 'obrigatoria'
          ? 'OBRIGATÓRIA'
          : s.nivel === 'condicional'
            ? `CONDICIONAL — ${s.gatilho}`
            : `OPCIONAL${s.gatilho ? ` — ${s.gatilho}` : ''}`;
      return `### ${s.secao}  [${tag}]\n${s.conteudo}`;
    })
    .join('\n\n');
}

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

// Título do ponto [2.4] — a justificativa "o que mudou após a automação" que o gate
// de economia alta (≥44h/mês) obriga. Fatiada para a coluna "Alocação Ganhos" da
// planilha (antes ficava só dentro do memorial, difícil de inspecionar).
const TITULO_ALOCACAO_GANHOS = TITULOS_MEMORIAL['2.4'].toLowerCase();

// Título do ponto [2.5] — a justificativa do split "carga real × ganho por escala"
// (raciocínio + cálculo que levaram aos números das colunas "Saving Horas Real" /
// "Saving Horas Escalado"). Fatiada para a coluna "Justificativa Saving Escalado e Real".
const TITULO_CARGA_ESCALA = TITULOS_MEMORIAL['2.5'].toLowerCase();

// Extrai o TÍTULO legível de uma linha que seja cabeçalho markdown ("### Título")
// ou rótulo em negrito no início ("**Título:** ..."). Devolve null se não for nenhum.
function tituloDaLinha(linha: string): string | null {
  const header = linha.match(/^\s*#{1,6}\s+(.+?)\s*:?\s*$/);
  if (header) return header[1].trim().toLowerCase();
  const label = linha.match(/^\s*\*\*\s*(.+?)\s*:?\s*\*\*/);
  if (label) return label[1].trim().toLowerCase();
  return null;
}

/**
 * Extrai do memorial a seção "O que mudou após a automação" (ponto [2.4]) — a
 * justificativa de como o tempo/custo liberado foi realocado. É escrita pelo agente
 * tanto como cabeçalho de seção (`### O que mudou após a automação`) quanto, em
 * legados, como rótulo inline (`**O que mudou após a automação:** ...`). Captura o
 * conteúdo até o próximo cabeçalho/rótulo (= novo ponto) ou separador `---` (que
 * antecede o bloco financeiro injetado). Devolve null quando a seção não existe
 * (ex.: projeto sem o gate de economia alta) ou está vazia.
 *
 * Use sobre o memorial JÁ normalizado (normalizarMarcadoresMemorial), para que o
 * código [2.4] já tenha virado o rótulo legível.
 */
export function extrairAlocacaoGanhos(memorial: string | null | undefined): string | null {
  return extrairSecaoMemorial(memorial, TITULO_ALOCACAO_GANHOS);
}

/**
 * Extrai do memorial a seção "Carga real e ganho por escala" (ponto [2.5]) — a
 * justificativa do agente para o split: o cálculo (volume/frequência antes × depois →
 * horas) e os gatilhos que levaram aos números gravados nas colunas "Saving Horas Real"
 * e "Saving Horas Escalado" (inclusive o porquê de a escala ser 0, quando for o caso).
 * Fatiada para a coluna "Justificativa Saving Escalado e Real". Mesma mecânica da
 * "Alocação Ganhos": cabeçalho `### ...` ou rótulo inline `**...:**`, conteúdo até o
 * próximo ponto/seção ou o separador `---`. Devolve null quando a seção não existe
 * (ex.: split não se aplica) ou está vazia.
 *
 * Use sobre o memorial JÁ normalizado (normalizarMarcadoresMemorial).
 */
export function extrairJustificativaCargaEscala(memorial: string | null | undefined): string | null {
  return extrairSecaoMemorial(memorial, TITULO_CARGA_ESCALA);
}

// Títulos dos pontos [1.3] e [1.4] — as duas seções da régua de CRITÉRIO DE PROJETO
// ("Processo alterado" e "Ponteiro movido e onde verificar"). Fatiadas pelo gate
// determinístico do critério (chat.functions.ts) para decidir se o agente de fato as
// escreveu antes de liberar o preview.
const TITULO_PROCESSO_ALTERADO = TITULOS_MEMORIAL['1.3'].toLowerCase();
// PREFIXO (não título exato) — ver extrairPonteiroMovido.
const PREFIXO_PONTEIRO_MOVIDO = 'ponteiro movido';

/**
 * Extrai do memorial a seção "Processo alterado" (ponto [1.3]) — o que mudou na rotina,
 * como era antes, como é agora e a MAGNITUDE. Mesma mecânica das demais extrações
 * (cabeçalho `### ...` ou rótulo inline `**...:**`).
 *
 * Use sobre o memorial JÁ normalizado (normalizarMarcadoresMemorial).
 */
export function extrairProcessoAlterado(memorial: string | null | undefined): string | null {
  return extrairSecaoMemorial(memorial, TITULO_PROCESSO_ALTERADO);
}

/**
 * Extrai do memorial a seção "Ponteiro movido e onde verificar" (ponto [1.4]).
 *
 * ⚠️ Casa por PREFIXO ("ponteiro movido…"), não por título exato: na validação em staging
 * o agente gravou a METADE da seção sob o rótulo curto `**Ponteiro movido:**` (sem o "e
 * onde verificar"). Casar só o título exato devolveria `null` e a meia-seção seria
 * indistinguível da ausência total — precisamos ENXERGÁ-LA para julgar o conteúdo.
 *
 * Use sobre o memorial JÁ normalizado (normalizarMarcadoresMemorial).
 */
export function extrairPonteiroMovido(memorial: string | null | undefined): string | null {
  return extrairSecaoMemorial(memorial, PREFIXO_PONTEIRO_MOVIDO, { prefixo: true });
}

/**
 * Extrai do memorial o "Resumo" (ponto [1.2], Seção 1 — Contexto): o parágrafo em que o
 * agente conta, em prosa, o que o projeto faz e o que ele muda. É mais ABRANGENTE que o
 * `resumo` da análise automática (que julga a submissão), e é ele que a tela de
 * pré-aprovação mostra ao líder — a análise vira só o fallback.
 *
 * Casa o título exato "Resumo": o [1.2] vem antes da Seção 5 ("Resumo do saving") no
 * texto, então a primeira ocorrência é sempre a certa.
 *
 * Use sobre o memorial JÁ normalizado (normalizarMarcadoresMemorial).
 */
export function extrairResumoMemorial(memorial: string | null | undefined): string | null {
  return (
    extrairSecaoMemorial(memorial, TITULOS_MEMORIAL['1.2'].toLowerCase()) ??
    extrairRotuloTextoPuro(memorial, TITULOS_MEMORIAL['1.2'])
  );
}

/**
 * Fallback do resumo para memoriais em que o agente escreveu o rótulo em TEXTO PURO
 * ("Resumo: o projeto audita…"), sem `**negrito**` nem `###` — formato real encontrado
 * na staging (03/08/2026), invisível para o `tituloDaLinha`.
 *
 * Fica FORA do `extrairSecaoMemorial` de propósito: aquele alimenta os gates
 * determinísticos do critério de projeto e da carga×escala, e afrouxar o casamento de
 * título lá mudaria o que aqueles gates enxergam. Aqui o pior caso é um resumo a mais.
 *
 * Para no próximo rótulo do mesmo formato ("Processo alterado:"), num cabeçalho, no
 * separador `---` ou na linha em branco.
 */
function extrairRotuloTextoPuro(memorial: string | null | undefined, titulo: string): string | null {
  if (!memorial) return null;
  const linhas = memorial.split(/\r?\n/);
  const abre = new RegExp(`^\\s*${titulo}\\s*:\\s*(.*)$`, 'i');
  // Outro rótulo curto começando a linha ("Processo alterado:") — sem vírgula/ponto no
  // meio, para não confundir com uma frase do próprio resumo que contenha ":".
  const OUTRO_ROTULO = /^\s*[A-ZÁ-Ú][^:,.]{2,60}:\s/;

  const inicio = linhas.findIndex((l) => abre.test(l));
  if (inicio < 0) return null;

  const partes: string[] = [];
  const primeira = linhas[inicio].match(abre)?.[1]?.trim();
  if (primeira) partes.push(primeira);

  for (let j = inicio + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (!l.trim()) break;
    if (tituloDaLinha(l) !== null) break;
    if (OUTRO_ROTULO.test(l)) break;
    if (/^\s*-{3,}\s*$/.test(l)) break;
    partes.push(l);
  }

  const texto = partes.join('\n').trim();
  return texto || null;
}

// Fatia uma seção do memorial pelo seu título legível (já em minúsculas). Captura o
// conteúdo inline do rótulo (`**Título:** aqui`) + as linhas seguintes, parando no
// próximo ponto/seção ou no separador `---` do bloco financeiro injetado. Base comum
// de extrairAlocacaoGanhos / extrairJustificativaCargaEscala / extrairProcessoAlterado /
// extrairPonteiroMovido. `prefixo: true` casa títulos que COMEÇAM com o texto dado
// (para variantes abreviadas escritas pelo agente).
function extrairSecaoMemorial(
  memorial: string | null | undefined,
  tituloLower: string,
  opts?: { prefixo?: boolean },
): string | null {
  if (!memorial) return null;
  const linhas = memorial.split(/\r?\n/);

  const casa = (t: string | null) =>
    t !== null && (opts?.prefixo ? t.startsWith(tituloLower) : t === tituloLower);

  let inicio = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (casa(tituloDaLinha(linhas[i]))) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) return null;

  const partes: string[] = [];
  // Conteúdo na MESMA linha do rótulo inline ("**Título:** conteúdo aqui").
  const inline = linhas[inicio].match(/^\s*\*\*[^*]+\*\*\s*:?\s*(.*)$/);
  if (inline && inline[1].trim()) partes.push(inline[1].trim());

  // Linhas seguintes, até o próximo ponto/seção ou o separador do bloco financeiro.
  for (let j = inicio + 1; j < linhas.length; j++) {
    const l = linhas[j];
    if (tituloDaLinha(l) !== null) break;
    if (/^\s*-{3,}\s*$/.test(l)) break;
    partes.push(l);
  }

  const texto = partes.join('\n').trim();
  return texto || null;
}
