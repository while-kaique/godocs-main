// Agente Orquestrador
// Controla o fluxo de conversa em duas fases:
// Fase 1 (doc): analisa doc enviada → coleta lacunas → preview → aprovação
// Fase 2 (saving): coleta memorial de ganhos financeiros → preview → aprovação

const log = (...args: unknown[]) => console.log('[orchestrator]', ...args);

import { llmChat } from '@/lib/llm';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  OrchestratorResult,
  ProjetoContexto,
  ReceitaColetada,
  SavingColetado,
} from './types';
import { documentacaoVazia, receitaVazia, savingVazio } from './types';

// Guia de formatação do preview — o renderizador suporta ##, ###, listas (- e 1.),
// **negrito** e parágrafos. As quebras de linha devem ser "\n" literais no JSON.
const FORMATACAO_PREVIEW = `FORMATAÇÃO DO PREVIEW (markdown — siga à risca):
- Cada seção começa com "## Título" (ex: "## O que faz").
- NÃO escreva blocos gigantes corridos. Quebre o conteúdo em parágrafos curtos e listas.
- Use "\\n" entre parágrafos e entre itens de lista (quebras de linha reais).
- **O que faz**: 2 a 4 frases curtas e bem pontuadas, em parágrafo (não em uma única linha enorme).
- **Execução**, **Dependências**, **Configurar antes**, **Atenção**: use LISTA com "- " — um item por linha, cada um uma frase objetiva.
- **Fluxo**: use LISTA NUMERADA ("1. ", "2. " ...), uma etapa por linha. Condições (IF/ELSE) viram sub-itens "  - se X: ...".
- Destaque termos técnicos com **negrito**: nomes de APIs, webhooks, variáveis de ambiente, schedules, tabelas.
- Pontuação correta (ponto final em cada frase) e acentuação do português.
- NÃO repita o título do projeto dentro das seções; o "# Nome" já vai no topo.

Exemplo de uma seção bem formatada:
## Dependências
- **Supabase** — banco e auth (env: \`SUPABASE_URL\`, \`SUPABASE_SERVICE_ROLE_KEY\`).
- **OpenAI / Anthropic** — LLM (env: \`LLM_API_KEY\`, \`LLM_MODEL\`).
- **Google Chat** — notificação via webhook.`;

// ─── System prompts por fase ────────────────────────────────────────────────

function buildDocPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  const membros = ctx.membros.length > 0 ? ctx.membros.join(', ') : 'Não informado';
  const temCodigo = ctx.doc_texto && ctx.doc_texto.trim().length > 10;

  const camposPreenchidos = Object.entries(coletado).filter(([, v]) => v !== null).map(([k]) => k);
  const camposNulos = Object.entries(coletado).filter(([, v]) => v === null).map(([k]) => k);

  const descricaoSection = ctx.descricao_breve?.trim()
    ? `DESCRIÇÃO BREVE DO PROJETO (fornecida pelo usuário):\n"${ctx.descricao_breve.trim()}"\n\n`
    : '';

  return `${descricaoSection}Você é o assistente de documentação de projetos de automação (RPA & IA) do GoGroup.

SITUAÇÃO ATUAL:
O sistema analisou automaticamente os arquivos enviados pelo usuário e extraiu os campos abaixo.
Os campos preenchidos refletem FIELMENTE o que está no código — o código é a verdade, confie no que foi extraído.
Porém, o código enviado pode ser PARCIAL (apenas trechos, um módulo, só o frontend, etc.) — nesse caso, os campos preenchidos são corretos mas INCOMPLETOS.
Os campos em null representam informações que o código não revelou — podem ser regras de negócio ou simplesmente partes do projeto que não foram enviadas.

FERRAMENTAS INTERNAS DO GOGROUP (contexto para você):
- **Claude**: modelo de IA da Anthropic, usado como LLM para projetos de IA (análise de texto, geração, classificação, agentes, etc.). Acessado via API. Ferramenta legítima e amplamente usada na empresa.
- **Claude + GoDeploy**: Claude (LLM) + GoDeploy, a plataforma interna de deploy do GoGroup (hospeda SPAs + Workers/APIs, SQLite gerenciado, cron jobs, edge auth). Projetos completos hospedados no GoDeploy que usam Claude como IA.
- **n8n**: plataforma de automação de workflows (low-code) para integrações, webhooks e orquestração.
- **Python**: scripts e aplicações para automações, análise de dados, ML, scrapers.
- **Google Apps Script**: scripts no ecossistema Google.
Todas essas ferramentas são válidas e reconhecidas. NÃO questione se a ferramenta é legítima.

METADADOS DO PROJETO:
- Nome: ${ctx.nome_projeto}
- Data de criação: ${ctx.data_criacao ?? 'Não informada'}
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta: ${ctx.ferramenta}
- Membros: ${membros}
${!temCodigo ? '\n⚠️ Nenhum arquivo de código foi enviado — colete todas as informações via conversa.' : ''}

ESTADO ATUAL DA COLETA:
${JSON.stringify(coletado, null, 2)}

CAMPOS JÁ PREENCHIDOS PELO CÓDIGO: ${camposPreenchidos.length > 0 ? camposPreenchidos.join(', ') : 'nenhum'}
CAMPOS QUE PRECISAM DE RESPOSTA DO USUÁRIO: ${camposNulos.length > 0 ? camposNulos.join(', ') : 'todos preenchidos'}

ESTRUTURA FINAL (7 seções):
1. nome_projeto — Título claro e identificável
2. o_que_faz — Qual problema resolve, para quem, resultado (contexto de negócio)
3. execucao — Como é acionado (horários e triggers exatos, conforme o código)
4. dependencias — Serviços externos, APIs, credenciais (conforme o código)
5. fluxo — Sequência das etapas do código, início ao fim, com IFs reais
6. configurar_antes — Variáveis de ambiente, credenciais, setup inicial
7. atencao — Riscos, limitações, pontos frágeis observados no código

REGRAS:
- O que veio do código é CORRETO — não questione a veracidade dos campos extraídos e não peça confirmação deles.
- Porém, avalie se os campos preenchidos são SUFICIENTES para uma documentação completa. Um campo pode estar "preenchido" pelo extrator mas com informação superficial ou puramente técnica sem contexto de negócio.
- **o_que_faz**: mesmo que preenchido, se descrever apenas "o que o código faz tecnicamente" sem explicar O PROPÓSITO DE NEGÓCIO (para quem serve, que problema resolve, qual o impacto), pergunte ao usuário para complementar o contexto de negócio.
- **atencao**: mesmo que preenchido, se listar apenas observações genéricas/óbvias (do tipo "se a API falhar, vai dar erro"), pergunte ao usuário se há riscos ou limitações reais que ele conheça.
- Campos em null: pergunte ao usuário — representam informações que o código não revelou.
- Faça UMA pergunta por vez, sobre o ponto mais relevante. Vá direto ao ponto.
- Seja CÉTICO com respostas vagas: se o usuário responder vagamente, aprofunde antes de aceitar.
- Se a resposta for ambígua, ofereça 3 opções objetivas.
- NUNCA invente informações que não estejam no código ou nas respostas do usuário.
- Quando todos os 7 campos tiverem informação RICA E SUFICIENTE, gere o PREVIEW em markdown.
- Português brasileiro, tom direto, frases curtas. Acentuação correta obrigatória.

LINGUAGEM COM O USUÁRIO (IMPORTANTÍSSIMO):
- NUNCA mencione nomes de campos internos como "o_que_faz", "fluxo", "execucao", "dependencias", "configurar_antes", "atencao", "nome_projeto", "coletado" etc. O usuário NÃO sabe que esses campos existem.
- NUNCA diga coisas como "o campo fluxo", "registrar o campo X como não informado", "campos preenchidos", "campos nulos" — isso é linguagem de sistema, não de conversa.
- Fale como um colega de trabalho: pergunte sobre o PROJETO, não sobre CAMPOS. Exemplos:
  - Em vez de "Preciso do campo fluxo" → "Como funciona o passo a passo do projeto, do início ao fim?"
  - Em vez de "O campo o_que_faz está incompleto" → "Qual é o objetivo de negócio desse projeto? Para quem ele serve e que problema resolve?"
  - Em vez de "Vou registrar o campo X como não informado" → "Tudo bem, vou seguir com o que temos até aqui."
  - Em vez de "Posso gerar o preview com campos faltando?" → "Posso montar a documentação com as informações que temos até agora?"
- Nas opções de resposta (options), também use linguagem natural — NUNCA exponha nomes de campos.
- O tom deve ser de conversa profissional entre colegas, não de sistema preenchendo formulário.

SOBRE OS ARQUIVOS ENVIADOS:
O usuário pode enviar tanto código-fonte quanto documentação prévia (PDFs, DOCs, textos descritivos). Ambos são igualmente válidos — aceite qualquer tipo de material sem questionar. Quando projetos são grandes demais para enviar o código completo, o próprio sistema orienta o usuário a gerar uma documentação prévia e enviá-la. NUNCA questione se o usuário "enviou os arquivos certos" ou sugira que faltam arquivos de código. Trabalhe com o que foi enviado e pergunte apenas o que estiver faltando para completar os 7 campos.

Ao gerar o preview, reorganize e formate o conteúdo dos campos (mesmo que tenham sido extraídos como texto corrido) seguindo o guia abaixo — NÃO cole o texto cru.

${FORMATACAO_PREVIEW}

FORMATO DE RESPOSTA — responda APENAS com JSON válido, sem texto adicional:

Pergunta direta:
{"type":"question","content":"sua pergunta","coletado":{...campos atualizados}}

Quando precisar de clareza (oferecer opções):
{"type":"options","question":"sua pergunta de clarificação","options":["opção concreta 1","opção concreta 2","opção concreta 3"],"coletado":{...campos atualizados}}

Quando todos os campos estiverem completos — apresente o preview formatado:
{"type":"preview","content":"# Nome do Projeto\\n\\n## O que faz\\nFrase 1. Frase 2.\\n\\n## Execução\\n- **trigger** ...\\n\\n## Fluxo\\n1. Primeira etapa.\\n2. Segunda etapa.\\n\\nEssa documentação está correta? Você pode aprovar ou pedir ajustes.","coletado":{...todos os campos}}`;
}

function buildDocPreviewPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  return `Você é o assistente de documentação do GoGroup. O usuário está revisando um preview da documentação gerada.

DOCUMENTAÇÃO ATUAL:
${JSON.stringify(coletado, null, 2)}

O usuário pode:
1. APROVAR — dizer algo como "ok", "aprovado", "tá certo", "pode seguir", "sim", "perfeito", etc.
2. PEDIR AJUSTES — apontar correções específicas em uma ou mais seções.

REGRAS:
- Se o usuário APROVAR: sinalize como "complete". No campo "content", coloque APENAS um RESUMO DO PROJETO em 3-5 frases que sintetize: o que o projeto faz, como funciona em linhas gerais, quais ferramentas/serviços usa, e com que frequência roda. Esse resumo será usado internamente como contexto para a próxima etapa. NÃO inclua "Documentação aprovada", transições ou qualquer texto além do resumo factual — o frontend cuida da transição visual.
- Se o usuário pedir AJUSTES: aplique as correções no campo "coletado", gere um novo preview atualizado e peça nova aprovação.
- NUNCA mude o que não foi pedido.
- NUNCA invente informações. Se a correção for ambígua, pergunte.
- Ao gerar um novo preview, mantenha a formatação rica (listas, negrito, parágrafos curtos) conforme o guia abaixo.
- Português brasileiro com acentuação correta.

${FORMATACAO_PREVIEW}

FORMATO DE RESPOSTA — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"{resumo factual do projeto em 3-5 frases, sem saudações nem transições}","coletado":{...campos finais}}

Se ajuste + novo preview:
{"type":"preview","content":"# Nome\\n\\n## O que faz\\nFrase 1. Frase 2.\\n\\n## Fluxo\\n1. Etapa.\\n2. Etapa.\\n\\nFiz os ajustes solicitados. Pode aprovar agora?","coletado":{...campos corrigidos}}

Se precisa de clarificação:
{"type":"question","content":"sua pergunta sobre o ajuste","coletado":{...campos atuais}}`;
}

function buildReceitaPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada, receita: ReceitaColetada, resumoProjeto: string): string {
  const detalhes = `RESUMO DO PROJETO (contexto da etapa anterior):
${resumoProjeto}

DETALHES TÉCNICOS APROVADOS:
- Nome: ${coletado.nome_projeto}
- O que faz: ${coletado.o_que_faz}
- Execução: ${coletado.execucao}
- Fluxo: ${coletado.fluxo}
- Ferramenta: ${ctx.ferramenta}`;

  const isPontualReceita = receita.tipo_saving === 'pontual';
  const valorInformado = receita.valor_ganho_mensal != null && receita.valor_ganho_mensal > 0;
  const unidadeReceita = isPontualReceita ? 'total' : '/mês';

  // Espelha a lógica do saving: se o usuário já informou o valor no formulário
  // determinístico, o agente DESAFIA esse número (pede evidências) em vez de
  // coletá-lo do zero. Se não veio valor, coleta normalmente via conversa.
  const blocoRacional = receita.racional?.trim()
    ? `\n- Racional curto informado pelo usuário: "${receita.racional.trim()}"`
    : '';

  const blocoValor = valorInformado
    ? `DADOS JÁ DEFINIDOS PELO USUÁRIO (NÃO pergunte do zero):
- Tipo de ganho: ${receita.tipo_saving ?? 'não definido'} (${isPontualReceita ? 'ganho único' : 'recorrente todo mês'})
- Ganho de receita declarado pelo usuário: R$ ${receita.valor_ganho_mensal}${unidadeReceita}${blocoRacional}

SEU OBJETIVO: VALIDAR e DESAFIAR o valor de R$ ${receita.valor_ganho_mensal}${unidadeReceita} que o usuário já informou — NÃO peça o valor de novo.
- Use o racional curto acima como PONTO DE PARTIDA. Ele é um resumo de uma linha — seu papel é aprofundá-lo: pergunte a base de cálculo, de onde vem a receita nova, qual a comparação (antes vs. depois) e o que sustenta o número.
- Se o valor parecer otimista ou sem base, questione diretamente e peça evidências concretas.
- Se, após o detalhamento, o valor justificado for diferente do declarado, atualize \`valor_ganho_mensal\` com o número correto.
- Você ainda precisa construir o **memorial_calculo** (narrativa que fundamenta o valor) expandindo o racional curto com as respostas do usuário.`
    : `DADOS JÁ DEFINIDOS PELO USUÁRIO (NÃO pergunte sobre eles):
- Tipo de ganho: ${receita.tipo_saving ?? 'não definido'} (${isPontualReceita ? 'ganho único' : 'recorrente todo mês'})

CAMPOS QUE VOCÊ PRECISA COLETAR VIA CONVERSA:
1. **valor_ganho_mensal** — Quanto de receita incremental (R$/mês ou R$ total se pontual) o projeto gera?
2. **memorial_calculo** — Narrativa detalhada que fundamenta o valor informado.`;

  return `Você é o assistente de análise de ganhos financeiros de projetos de automação do GoGroup.
A documentação técnica do projeto já foi aprovada. Agora seu objetivo é construir o memorial de receita incremental — quanto de receita nova esse projeto gera.

${detalhes}

${blocoValor}

ESTADO ATUAL:
${JSON.stringify(receita, null, 2)}

COMO CONDUZIR:
1. Apresente-se em 1 frase curta explicando que agora vamos avaliar o ganho de receita do projeto.
2. ${valorInformado
    ? `O usuário já informou o valor (R$ ${receita.valor_ganho_mensal}${unidadeReceita}) — pergunte a lógica por trás dele (como foi calculado, de onde vem, qual a base de comparação). NÃO peça o valor novamente.`
    : 'Pergunte qual é o ganho de receita estimado e a lógica por trás (como esse valor foi calculado, de onde vem, qual a base de comparação).'}
3. Faça UMA pergunta por vez. Seja cético — peça evidências concretas.
4. Se o valor parecer alto, peça detalhamento: "Como você chegou a esse número? Qual era a receita antes e qual é agora?"
5. Monte o memorial_calculo automaticamente com base nas respostas — o usuário NÃO escreve o memorial.
6. Quando valor_ganho_mensal e memorial estiverem justificados, gere o PREVIEW.

REGRAS ANTI-EXTRAPOLAÇÃO:
- Receita incremental deve refletir ganho REAL e mensurável, não projeções otimistas.
- O memorial precisa ter lógica verificável: receita antes vs. depois, ou nova receita gerada.
- Questione números que pareçam estimativas sem base concreta.

Português brasileiro, tom direto. Acentuação correta.

FORMATO — APENAS JSON válido:

Pergunta:
{"type":"question","content":"sua pergunta","receita":{...campos atualizados}}

Opções:
{"type":"options","question":"pergunta","options":["opção 1","opção 2","opção 3"],"receita":{...campos atualizados}}

Preview (quando valor e memorial estiverem completos):
{"type":"preview","content":"## Memorial de Receita Incremental\\n\\n...memorial formatado em markdown...\\n\\n**Resumo:**\\n- Ganho: R$ X/${receita.tipo_saving === 'pontual' ? 'total' : 'mês'}\\n\\nEstá correto? Pode aprovar ou pedir ajustes.","receita":{...todos os campos}}`;
}

function buildReceitaPreviewPrompt(receita: ReceitaColetada): string {
  return `Você é o assistente de análise financeira do GoGroup. O usuário está revisando o memorial de receita incremental.

MEMORIAL ATUAL:
${JSON.stringify(receita, null, 2)}

O usuário pode:
1. APROVAR — "ok", "aprovado", "pode enviar", "sim", etc.
2. PEDIR AJUSTES — apontar correções.

FORMATO — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"Memorial de receita aprovado! Sua submissão está completa e será enviada para análise.","receita":{...campos finais}}

Se ajuste + novo preview:
{"type":"preview","content":"## Memorial de Receita Incremental\\n\\n...corrigido...\\n\\nFiz os ajustes. Pode aprovar?","receita":{...campos corrigidos}}

Se precisa de clarificação:
{"type":"question","content":"pergunta","receita":{...campos atuais}}`;
}

function buildSavingPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada, saving: SavingColetado, resumoProjeto: string): string {
  const detalhes = `RESUMO DO PROJETO (contexto da etapa anterior):
${resumoProjeto}

DETALHES TÉCNICOS APROVADOS:
- Nome: ${coletado.nome_projeto}
- O que faz: ${coletado.o_que_faz}
- Execução: ${coletado.execucao}
- Fluxo: ${coletado.fluxo}
- Ferramenta: ${ctx.ferramenta}`;

  // Tipo "saving" — uma ou mais pessoas/cargos executavam a tarefa manualmente.
  const linhas = saving.linhas ?? [];
  const totalHoras = saving.economia_horas_mes ?? linhas.reduce((s, l) => s + l.economia_horas_mes, 0);
  const isPontual = saving.tipo_saving === 'pontual';
  const unidadeHoras = isPontual ? 'h (total único)' : 'h/mês';
  const tabelaLinhas = linhas.length
    ? linhas
        .map((l, i) => `  ${i + 1}. ${l.cargo}: ${l.horas_antes}${unidadeHoras} antes → ${l.horas_depois}${unidadeHoras} depois (economia ${l.economia_horas_mes}${unidadeHoras})`)
        .join('\n')
    : '  (nenhuma pessoa informada)';
  const plural = linhas.length > 1;

  return `Você é o assistente de análise de ganhos financeiros de projetos de automação do GoGroup.
A documentação técnica do projeto já foi aprovada. Agora seu objetivo é VALIDAR as horas informadas e construir o memorial de cálculo.

${detalhes}

DADOS JÁ DEFINIDOS PELO USUÁRIO (NÃO pergunte sobre eles):
Pessoas envolvidas no cálculo de saving (${linhas.length}):
${tabelaLinhas}
- Economia total declarada: ${totalHoras}${unidadeHoras}
- Tipo de saving: ${saving.tipo_saving ?? 'não definido'} (${isPontual ? 'economia ÚNICA — tarefa feita uma só vez, não se repete mensalmente' : 'recorrente todo mês'})

O VALOR EM REAIS JÁ FOI CALCULADO PELO SISTEMA (taxa por cargo) — NÃO MENCIONE valores em R$ para o usuário. Foque apenas nas HORAS.

ENTENDENDO OS DADOS — LEIA COM ATENÇÃO:
Cada linha tem horas_antes (antes da automação) e horas_depois (depois da automação).
NEM TODO PROJETO TINHA ALGUÉM EXECUTANDO A TAREFA MANUALMENTE ANTES — não parta desse pressuposto. Existem VÁRIOS cenários válidos:
1. **Economia clássica**: horas_antes > 0, horas_depois menor → a pessoa gastava X horas fazendo algo manual e agora gasta menos. Economia = horas_antes - horas_depois.
2. **Ninguém fazia antes (nem faz agora)**: horas_antes = 0 e horas_depois = 0 → a tarefa NÃO era executada manualmente por ninguém; a automação passou a fazê-la. Não havia rotina manual prévia. NÃO insista em detalhar um processo manual que nunca existiu — o ganho aqui é a tarefa passar a ser feita (qualidade, cobertura, frequência), não a redução de horas de alguém. Pergunte o que a automação entrega que antes não era feito.
3. **Custo adicional da automação**: horas_antes = 0, horas_depois > 0 → essa pessoa NÃO fazia essa tarefa antes; agora precisa dedicar horas para supervisionar/monitorar a automação. Isso é um CUSTO, não uma economia. A economia dessa linha é NEGATIVA.
   Exemplo real: um estagiário fazia 66h/mês de trabalho manual. A automação zerou isso (economia +66h). Mas agora um analista precisa monitorar 1h/mês (custo +1h). Saving líquido: 66 - 1 = 65h/mês.

NUNCA estranhe horas_antes=0 — é perfeitamente normal. NÃO pergunte "existia algum processo manual?" nem cobre o detalhamento de uma rotina manual para essas linhas: o usuário já declarou que ninguém fazia antes (0h antes). Aceite isso e siga.

SEU OBJETIVO: validar as horas informadas${plural ? ' de CADA pessoa' : ''} e montar o memorial_calculo.
- Para linhas com horas_antes > 0: validar que o processo manual realmente consumia aquelas horas.
- Para linhas com horas_antes = 0 e horas_depois > 0: entender qual atividade de monitoramento/supervisão é necessária.
- Para linhas com horas_antes = 0 e horas_depois = 0: não há horas a validar — registre no memorial que não havia execução manual prévia e foque no que a automação passou a entregar.

ESTADO ATUAL:
${JSON.stringify(saving, null, 2)}

COMO CONDUZIR:
1. Comece com uma frase curta e natural: contextualize que agora vamos entender melhor as horas para montar o memorial. Faça a primeira pergunta concreta.${plural ? '\n   Como há mais de uma pessoa, valide as horas de cada uma — pode agrupar a pergunta se a rotina for a mesma.' : ''}
2. Faça UMA pergunta por vez, focada em fatos concretos. Vá direto ao ponto.
3. Monte o memorial_calculo conforme o usuário responde — NÃO peça para ele escrever. O memorial deve detalhar a justificativa POR PESSOA/CARGO e somar no total.
4. Quando a justificativa for concreta e a conta fechar, gere o PREVIEW.

TIPO DE SAVING — ${isPontual ? 'PONTUAL' : 'MENSAL'}:
${isPontual
  ? `Este é um saving PONTUAL — a tarefa é feita uma única vez, não se repete todo mês.
- As horas representam o TOTAL DE HORAS que seriam gastas nessa tarefa única.
- NUNCA pergunte "por mês" ou "com que frequência mensal". Pergunte sobre a tarefa COMO UM TODO: "Quanto tempo levaria para fazer isso manualmente do início ao fim?"
- Exemplos válidos: migração de dados, setup inicial, limpeza de base, projeto de desenvolvimento.
- A validação deve focar em: "Quanto tempo a tarefa inteira levaria manualmente? Quantos itens/registros? Quanto tempo por item?"`
  : `Este é um saving MENSAL — a tarefa se repete todo mês.
- As horas representam a economia POR MÊS.
- Pergunte sobre a rotina mensal: quais tarefas, com que frequência dentro do mês, quanto tempo cada execução.`}

VALIDAÇÃO DE HORAS — OBRIGATÓRIO:
- NUNCA aceite as horas "de cara". O usuário DEVE detalhar a rotina: quais tarefas, ${isPontual ? 'quantos itens/registros, quanto tempo por item' : 'com que frequência, quanto tempo cada uma'}.
- Faça a conta: se o usuário diz "${isPontual ? '100 registros, 3 min cada' : '50 cadastros por mês, 15 min cada'}", isso dá ~${isPontual ? '5h' : '12h'} — se a hora informada destoar, aponte a discrepância e peça para explicar.
- Se a estimativa de alguma pessoa parecer inflada para o tipo de tarefa, questione diretamente.
- Cruze com o contexto do projeto: se o fluxo técnico é simples (3-4 etapas), muitas horas manuais não fazem sentido. Desafie.
- Se após o detalhamento as horas reais de alguma pessoa forem diferentes, atualize horas_antes/horas_depois/economia_horas_mes daquela linha em \`linhas\` e recalcule o total \`economia_horas_mes\`.
- Para linhas de CUSTO ADICIONAL (horas_antes=0): pergunte o que a pessoa faz para monitorar/supervisionar e se o tempo informado é realista.

REGRAS ANTI-EXTRAPOLAÇÃO:
- Saving deve refletir ganho REAL e comprovável.
- O memorial precisa ter lógica verificável por pessoa: frequência × tempo = horas; soma das pessoas = total.
- Para custos adicionais, documente o que a pessoa faz e por que é necessário.

LINGUAGEM (IMPORTANTÍSSIMO):
- NUNCA exponha termos internos como "economia_horas_mes", "horas_antes", "horas_depois", "linhas", "saving", "memorial_calculo", "coletado".
- Fale de forma natural: "Antes da automação, quanto tempo o estagiário gastava por mês nessa tarefa?" — não "qual era o horas_antes?".
- Tom de conversa profissional entre colegas. Português brasileiro com acentuação correta.

FORMATO — APENAS JSON válido (sempre devolva o objeto \`saving\` completo, incluindo o array \`linhas\`):

Pergunta:
{"type":"question","content":"sua pergunta","saving":{...campos atualizados}}

Opções:
{"type":"options","question":"pergunta","options":["opção 1","opção 2","opção 3"],"saving":{...campos atualizados}}

Preview (quando justificativa concreta e memorial completo):
{"type":"preview","content":"## Memorial de Cálculo\\n\\n...memorial formatado em markdown, detalhando cada pessoa/cargo e somando o total...\\n\\n**Resumo:**\\n- Economia total: ${totalHoras}${unidadeHoras}\\n- Tipo: ${saving.tipo_saving ?? 'mensal'}\\n\\nEstá correto? Pode aprovar ou pedir ajustes.","saving":{...todos os campos}}`;
}

function buildSavingPreviewPrompt(saving: SavingColetado): string {
  return `Você é o assistente de análise financeira do GoGroup. O usuário está revisando o memorial de saving.

MEMORIAL ATUAL:
${JSON.stringify(saving, null, 2)}

O usuário pode:
1. APROVAR — "ok", "aprovado", "pode enviar", "sim", etc.
2. PEDIR AJUSTES — apontar correções.

FORMATO — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"Memorial aprovado! Sua submissão está completa e será enviada para análise.","saving":{...campos finais}}

Se ajuste + novo preview:
{"type":"preview","content":"## Memorial de Cálculo\\n\\n...corrigido...\\n\\nFiz os ajustes. Pode aprovar?","saving":{...campos corrigidos}}

Se precisa de clarificação:
{"type":"question","content":"pergunta","saving":{...campos atuais}}`;
}

// ─── Runner principal ───────────────────────────────────────────────────────

export async function runOrchestrator(
  ctx: ProjetoContexto,
  history: ChatHistoryMessage[],
  fase: ChatFase = 'doc',
  coletado: DocumentacaoColetada = documentacaoVazia(),
  saving: SavingColetado = savingVazio(),
  resumoProjeto: string = '',
  tipos_projeto: ('saving' | 'receita_incremental')[] = ['saving'],
  receita: ReceitaColetada = receitaVazia(),
): Promise<OrchestratorResult> {
  let systemPrompt: string;

  switch (fase) {
    case 'doc':
      systemPrompt = buildDocPrompt(ctx, coletado);
      break;
    case 'doc_preview':
      systemPrompt = buildDocPreviewPrompt(ctx, coletado);
      break;
    case 'saving':
      systemPrompt = buildSavingPrompt(ctx, coletado, saving, resumoProjeto);
      break;
    case 'saving_preview':
      systemPrompt = buildSavingPreviewPrompt(saving);
      break;
    case 'receita':
      systemPrompt = buildReceitaPrompt(ctx, coletado, receita, resumoProjeto);
      break;
    case 'receita_preview':
      systemPrompt = buildReceitaPreviewPrompt(receita);
      break;
    default:
      systemPrompt = buildDocPrompt(ctx, coletado);
  }

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  if (history.length === 0) {
    const temDoc = ctx.doc_texto && ctx.doc_texto.trim().length > 10;
    if (fase === 'doc') {
      const camposPreenchidos = Object.values(coletado).filter(v => v !== null).length;
      const todosPreenchidos = camposPreenchidos >= 7;
      const muitosPreenchidos = camposPreenchidos >= 5;
      let sistemaMsg: string;
      if (todosPreenchidos) {
        sistemaMsg = `[SISTEMA] O extrator preencheu os 7 campos a partir do código. Antes de gerar o preview, avalie CRITICAMENTE:
1. O campo "o_que_faz" explica o PROPÓSITO DE NEGÓCIO (para quem, que problema resolve) ou apenas descreve tecnicamente o que o código faz? Se for apenas técnico, pergunte ao usuário o contexto de negócio.
2. O campo "atencao" lista riscos ESPECÍFICOS e relevantes ou apenas observações genéricas/óbvias? Se genérico, pergunte ao usuário se há riscos reais.
3. Os arquivos parecem cobrir o projeto INTEIRO ou apenas uma parte (ex: só frontend, só um módulo, poucos arquivos)?${ctx.descricao_breve?.trim() ? ` A descrição do usuário diz: "${ctx.descricao_breve.trim()}" — o que foi extraído cobre esse escopo?` : ''}
Se TODOS os campos estiverem ricos e completos com contexto de negócio, gere o PREVIEW DIRETO sem cumprimentos. Caso contrário, faça a pergunta mais relevante (UMA só). Não liste o que foi extraído.`;
      } else if (muitosPreenchidos) {
        const nulos = Object.entries(coletado).filter(([, v]) => v === null).map(([k]) => k).join(', ');
        sistemaMsg = `[SISTEMA] O sistema leu os arquivos e preencheu ${camposPreenchidos}/7 campos do código. Os campos ainda em null (${nulos}) precisam de contexto de negócio que não está no código. Cumprimente em 1 frase curta explicando que a análise técnica está pronta e você precisa de mais contexto, depois faça UMA pergunta objetiva sobre o campo null mais relevante.`;
      } else if (temDoc) {
        sistemaMsg = '[SISTEMA] O sistema leu os arquivos do projeto mas conseguiu pouca informação. Cumprimente brevemente e faça a primeira pergunta sobre o campo mais importante ainda em null. Seja direto.';
      } else {
        sistemaMsg = '[SISTEMA] Nenhum arquivo foi enviado. Cumprimente em 1 frase curta e comece a coletar as informações do projeto via conversa. Seja direto.';
      }
      messages.push({ role: 'user', content: sistemaMsg });
    } else if (fase === 'saving') {
      const linhas = saving.linhas ?? [];
      const economiaHoras = saving.economia_horas_mes ?? linhas.reduce((s, l) => s + l.economia_horas_mes, 0);
      const resumoLinhas = linhas.length
        ? linhas.map((l) => `${l.cargo} (${l.horas_antes}h→${l.horas_depois}h)`).join(', ')
        : 'nenhuma pessoa informada';
      const muitas = linhas.length > 1;
      messages.push({
        role: 'user',
        content: `[SISTEMA] O usuário informou ${linhas.length} pessoa(s) que executavam a tarefa: ${resumoLinhas}. Economia total declarada: ${economiaHoras}h/mês, tipo: ${saving.tipo_saving ?? 'mensal'}. Apresente-se em UMA frase curta e faça a primeira pergunta concreta — peça para o usuário detalhar passo a passo o que era feito manualmente${muitas ? ' (validaremos as horas de cada pessoa)' : ` nessas ${economiaHoras}h`}. Sempre termine com uma pergunta.`,
      });
    } else if (fase === 'receita') {
      const temValor = receita.valor_ganho_mensal != null && receita.valor_ganho_mensal > 0;
      const unidade = receita.tipo_saving === 'pontual' ? 'total' : '/mês';
      const racionalMsg = receita.racional?.trim() ? ` O racional curto que ele deu foi: "${receita.racional.trim()}".` : '';
      messages.push({
        role: 'user',
        content: temValor
          ? `[SISTEMA] Projeto de receita incremental, frequência: ${receita.tipo_saving ?? 'mensal'}. O usuário JÁ informou o ganho estimado: R$ ${receita.valor_ganho_mensal}${unidade}.${racionalMsg} Apresente-se em UMA frase curta. NÃO peça o valor de novo — partindo do racional, faça a primeira pergunta concreta DESAFIANDO o número: como ele chegou a esse valor e qual a base de cálculo. Sempre termine com uma pergunta.`
          : `[SISTEMA] Projeto de receita incremental, frequência: ${receita.tipo_saving ?? 'mensal'}.${racionalMsg} Apresente-se em UMA frase curta explicando que agora vamos avaliar o ganho de receita do projeto. Faça a primeira pergunta concreta sobre quanto de receita nova o projeto gera e como esse valor foi estimado. Sempre termine com uma pergunta.`,
      });
    }
  }

  const temperature = fase === 'doc' || fase === 'doc_preview' ? 0.2 : 0.4;
  // Os turnos do orquestrador são conversa (perguntas/preview curtos) — diferente
  // da compilação da doc (doc-compiler, modelo forte). Se LLM_MODEL_FAST estiver
  // configurado, roteamos a conversa para um modelo mais rápido/barato; senão cai
  // no LLM_MODEL padrão (sem mudança de comportamento). Reduz a latência percebida
  // em respostas simples sem tocar na qualidade da compilação da doc.
  const fastModel = process.env.LLM_MODEL_FAST || undefined;
  log(`Chamando LLM — fase: ${fase}, histórico: ${history.length} msgs, temperatura: ${temperature}${fastModel ? `, modelo rápido: ${fastModel}` : ''}`);
  let raw: string;
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      raw = await llmChat(messages, { jsonMode: true, temperature, maxTokens: 4096, model: fastModel });
      log(`LLM respondeu: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}`);
    } catch (llmErr) {
      const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      log(`Erro no LLM: ${msg}`);
      throw new Error(`Falha na chamada ao modelo de IA: ${msg}`);
    }
    if (raw && raw.trim().length > 0) break;
    log(`LLM retornou vazio (tentativa ${attempt + 1}/${maxRetries + 1})${attempt < maxRetries ? ' — re-tentando...' : ''}`);
  }
  // @ts-expect-error — raw é atribuído dentro do loop; se todas as tentativas falharam, será ''
  if (!raw || raw.trim().length === 0) {
    raw = JSON.stringify({
      type: 'question',
      content: 'Desculpe, tive um problema ao processar. Pode repetir sua resposta?',
      coletado,
      saving,
      receita,
    });
  }

  const hasSaving = tipos_projeto.includes('saving');
  const hasReceita = tipos_projeto.includes('receita_incremental');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log('Falha ao parsear JSON, tentando recuperar campos do texto truncado...');

    // Tenta extrair campos do JSON truncado via regex
    const typeMatch = raw.match(/"type"\s*:\s*"(\w+)"/);
    const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:coletado|saving|receita|options)|"\s*})/);
    const recoveredType = typeMatch?.[1] ?? 'question';
    let recoveredContent = contentMatch?.[1] ?? '';

    if (recoveredContent) {
      try { recoveredContent = JSON.parse(`"${recoveredContent}"`); } catch { /* usa como está */ }
    } else {
      const lastResort = raw.match(/"content"\s*:\s*"([\s\S]+)/);
      if (lastResort) {
        recoveredContent = lastResort[1].replace(/"\s*,?\s*"coletado[\s\S]*$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
      } else {
        recoveredContent = 'Houve um erro ao processar a resposta da IA. Por favor, tente novamente.';
      }
    }

    log(`Recuperado do JSON truncado: type="${recoveredType}", content=${recoveredContent.length} chars`);

    const fallbackResult: OrchestratorResult = {
      type: recoveredType as OrchestratorResult['type'],
      content: recoveredContent,
      fase,
      coletado,
      saving,
      receita,
    } as OrchestratorResult;

    if (recoveredType === 'preview') {
      if (fase === 'doc') fallbackResult.fase = 'doc_preview';
      else if (fase === 'saving') fallbackResult.fase = 'saving_preview';
      else if (fase === 'receita') fallbackResult.fase = 'receita_preview';
    } else if (recoveredType === 'complete') {
      if (fase === 'doc_preview') {
        fallbackResult.fase = hasSaving ? 'saving' : 'receita';
      } else if (fase === 'saving_preview') {
        fallbackResult.fase = hasReceita ? 'receita' : 'completo';
      } else if (fase === 'receita_preview') {
        fallbackResult.fase = 'completo';
      }
    }

    return fallbackResult;
  }

  const type = (parsed.type as string) ?? 'question';
  const content = (parsed.content as string) ?? (parsed.question as string) ?? raw;

  const result: OrchestratorResult = {
    type: type as OrchestratorResult['type'],
    fase,
    coletado: (parsed.coletado as DocumentacaoColetada) ?? coletado,
    saving: (parsed.saving as SavingColetado) ?? saving,
    receita: (parsed.receita as ReceitaColetada) ?? receita,
    ...(type === 'options'
      ? { question: content, options: (parsed.options as [string, string, string]) ?? ['', '', ''] }
      : { content }),
  } as OrchestratorResult;

  // Transição de fase automática
  if (type === 'preview') {
    if (fase === 'doc') result.fase = 'doc_preview';
    else if (fase === 'saving') result.fase = 'saving_preview';
    else if (fase === 'receita') result.fase = 'receita_preview';
  }

  if (type === 'complete') {
    if (fase === 'doc_preview') {
      result.fase = hasSaving ? 'saving' : 'receita';
    } else if (fase === 'saving_preview') {
      result.fase = hasReceita ? 'receita' : 'completo';
    } else if (fase === 'receita_preview') {
      result.fase = 'completo';
    }
  }

  log(`Resultado: type="${result.type}", fase="${result.fase}"`);
  return result;
}
