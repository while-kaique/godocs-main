// Agente Analisador — análise holística pré-submissão
// Avalia toda a submissão (doc + saving/receita + metadados) com critérios fixos + dinâmicos

import { llmChat } from '@/lib/llm';
import {
  getProjetoById,
  getDocumentacao,
  parseJson,
} from '@/integrations/db/client.server';
import type { ResultadoAnalise, CriterioResult, Complexidade } from './types';

const log = (...args: unknown[]) => console.log('[analyzer]', ...args);
const err = (...args: unknown[]) => console.error('[analyzer]', ...args);

// ─── Critérios hardcoded ────────────────────────────────────────────────────

export const CRITERIOS_HARDCODED = [
  {
    id: 'proposito_claro',
    nome: 'Propósito de negócio claro',
    descricao:
      'A seção "O que faz" descreve com clareza o PROBLEMA de negócio resolvido, quem é o público-alvo e qual o resultado concreto entregue. Não basta descrever o que o código faz tecnicamente — precisa explicar o POR QUÊ.',
  },
  {
    id: 'trigger_definido',
    nome: 'Modo de execução (trigger) especificado',
    descricao:
      'A seção "Execução" contém informação concreta sobre como e quando o projeto é acionado: schedule (com frequência), webhook (com origem), manual (com instruções), evento, etc. Respostas genéricas como "é executado automaticamente" NÃO contam.',
  },
  {
    id: 'dependencias_completas',
    nome: 'Dependências externas listadas',
    descricao:
      'Todos os serviços externos, APIs, credenciais, bancos de dados e integrações de terceiros necessários estão enumerados na seção "Dependências". Cada um com nome claro e descrição do uso.',
  },
  {
    id: 'fluxo_logico',
    nome: 'Fluxo sequencial, completo e coerente',
    descricao:
      'A seção "Fluxo" apresenta a sequência de etapas do início ao fim, sem lacunas evidentes, incluindo ramificações condicionais (IF/ELSE) quando aplicável. Um leitor novo deve conseguir entender o caminho completo da execução.',
  },
  {
    id: 'configuracao_documentada',
    nome: 'Pré-requisitos de setup documentados',
    descricao:
      'A seção "Configurar antes de usar" lista passos concretos: variáveis de ambiente, credenciais a obter, serviços a configurar, permissões necessárias. Se não há nada a configurar, deve estar explicitamente dito.',
  },
  {
    id: 'riscos_especificos',
    nome: 'Riscos e limitações específicos',
    descricao:
      'A seção "Atenção" contém riscos REAIS e ESPECÍFICOS do projeto, não frases genéricas como "pode falhar se a API cair". Deve mencionar cenários concretos: limites de taxa, dados sensíveis, dependência de formato específico, pontos de falha únicos, etc.',
  },
  {
    id: 'saving_coerente',
    nome: 'Memorial de cálculo com lógica sólida',
    descricao:
      'O memorial de saving/receita apresenta uma lógica de cálculo coerente: as horas antes/depois são justificadas com detalhamento da rotina manual, os valores são compatíveis com a complexidade descrita no projeto, e não há extrapolação evidente. REGRA DE REPROVAÇÃO AUTOMÁTICA (0 pontos): se economia_horas_mes = 0, saving_reais = 0 (quando há saving marcado), ou valor de receita incremental = 0 (quando marcou receita), o critério deve receber 0 pontos — um projeto precisa demonstrar ganho concreto para ser aprovado.',
  },
  {
    id: 'ferramenta_compativel',
    nome: 'Ferramenta coerente com o projeto',
    descricao:
      'A ferramenta informada no cadastro (ex: n8n, Python, Power Automate) é coerente com o que está descrito na documentação técnica. O fluxo e as dependências fazem sentido para a ferramenta indicada.',
  },
  {
    id: 'descricao_alinhada',
    nome: 'Descrição breve alinhada com documentação',
    descricao:
      'A descrição breve do projeto é coerente e consistente com o conteúdo completo da documentação técnica e do memorial. Não há contradições nem informações que divergem entre a descrição e os documentos detalhados.',
  },
  {
    id: 'completude_geral',
    nome: 'Submissão completa sem lacunas evidentes',
    descricao:
      'A submissão como um todo está completa: todos os campos obrigatórios preenchidos, sem seções vazias ou com respostas placeholder, e as diferentes partes (doc técnica + memorial) se complementam formando um quadro coerente do projeto.',
  },
] as const;

// ─── System prompt ──────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const criteriosStr = CRITERIOS_HARDCODED.map(
    (c, i) => `${i + 1}. **${c.nome}** (id: ${c.id}): ${c.descricao}`
  ).join('\n');

  return `Você é um analista sênior de qualidade da área de RPA & IA do GoGroup. Sua função é avaliar CRITICAMENTE a submissão de um projeto de automação ANTES de ele ser enviado para triagem humana.

Você receberá TODOS os dados do projeto: metadados (título, área, ferramenta, descrição breve), documentação técnica completa (7 campos), e memorial de saving e/ou receita incremental. Analise TUDO com ceticismo saudável.

## CONTEXTO — FERRAMENTAS INTERNAS DO GOGROUP

As ferramentas abaixo são usadas internamente no GoGroup e são opções válidas no cadastro de projetos. Conhecê-las é essencial para avaliar corretamente o critério de ferramenta:

- **Claude**: Refere-se ao Claude, modelo de IA da Anthropic. No GoGroup, é utilizado como LLM (Large Language Model) para projetos que envolvem inteligência artificial — análise de texto, geração de conteúdo, classificação, extração de dados, agentes conversacionais, etc. Pode ser acessado via API (Anthropic API) ou integrado a fluxos de automação. É uma ferramenta legítima e amplamente usada na empresa.
- **Claude + GoDeploy**: Combinação do Claude (LLM) com o GoDeploy, a plataforma interna de deploy e hospedagem do GoGroup. O GoDeploy é a infraestrutura própria da empresa para hospedar aplicações web (SPAs + Workers/APIs), com suporte a SQLite gerenciado, variáveis de ambiente, cron jobs e edge auth (Google OAuth). Projetos com essa ferramenta são aplicações completas hospedadas no GoDeploy que usam Claude como motor de IA.
- **n8n**: Plataforma de automação de workflows (low-code). Amplamente usada no GoGroup para integrações, ETL, webhooks e orquestração de processos.
- **Python**: Scripts e aplicações em Python — usado para automações, análise de dados, ML, scrapers, etc.
- **Google Apps Script**: Scripts dentro do ecossistema Google (Sheets, Docs, Drive, Gmail).

Quando a ferramenta for "Claude", "Claude + GoDeploy" ou qualquer outra listada acima, ela é VÁLIDA e RECONHECIDA pela empresa. NÃO penalize por "ferramenta desconhecida" ou "sem documentação da ferramenta". Avalie apenas se a ferramenta é COERENTE com o que o projeto faz (ex: um projeto de IA usando Claude faz sentido; um RPA simples de planilha usando Claude pode ser incoerente).

## POSTURA

- Seu objetivo é APROVAR projetos que façam sentido — a plataforma existe para documentar e registrar, não para barrar. Só reprove quando houver falha grave e evidente (incoerência lógica, saving claramente extrapolado, documentação vazia ou sem sentido).
- Avalie a COERÊNCIA entre as partes: a descrição breve bate com a documentação? O saving faz sentido dado o fluxo descrito? A ferramenta é compatível com as dependências?
- Brevidade NÃO é defeito. Um campo curto mas preciso e correto vale tanto quanto um campo longo.
- Na dúvida entre aprovar e reprovar, APROVE — e registre as ressalvas nas recomendações. A triagem humana fará o ajuste fino.
- Reserve a reprovação para casos onde a submissão realmente não se sustenta: saving sem lógica, documentação contraditória, ou informações que não fazem sentido juntas.

## CRITÉRIOS FIXOS (avalie cada um com 0 ou 1 ponto)

${criteriosStr}

## CRITÉRIOS DINÂMICOS

Além dos 10 critérios fixos, gere de 2 a 3 critérios ADICIONAIS específicos para este projeto. Cada critério dinâmico vale **0** (não atendido) ou **1** (atendido) — igual aos critérios fixos.

Baseie seus critérios dinâmicos no que você observa nos dados — exemplos:
- Tratamento de erros e exceções está documentado
- Dados sensíveis (PII, credenciais) são tratados com cuidado
- O escopo do saving não é extrapolado além do razoável
- Há coerência entre a complexidade do fluxo e as horas economizadas
- Se usa serviço externo, o custo está considerado

NÃO invente critérios genéricos. Cada critério dinâmico deve ser relevante para ESTE projeto específico.

## REGRAS DE APROVAÇÃO

O objetivo da plataforma é REGISTRAR e DOCUMENTAR projetos, não barrar. A análise serve para dar feedback construtivo, não para reprovar. Só reprove quando a submissão realmente não se sustenta.

1. Calcule: \`pontuacao_total = soma(pontos_hardcoded) + soma(pontos_dinamicos)\`
2. Calcule: \`pontuacao_maxima = 10 + quantidade_criterios_dinamicos\`
3. Se \`pontuacao_total >= 50% de pontuacao_maxima\` → **"aprovado"** (com recomendações de melhoria se necessário)
4. Se \`pontuacao_total < 50% de pontuacao_maxima\` → **"rejeitado"** (significa que o time de RPA conversará com o responsável para ajustar — NÃO é uma negação do projeto)

Na prática, um projeto só deve ser "rejeitado" se tiver problemas sérios e evidentes: saving sem lógica, documentação vazia/contraditória, ou incoerência grave entre as partes. Um projeto completo com pequenas lacunas deve ser APROVADO com recomendações.

## JUSTIFICATIVA

Escreva a justificativa em português usando markdown estruturado com as seções abaixo. Use bullet points (- ) dentro de cada seção. Seja direto e conciso — **máximo 4 bullets por seção** (priorize os mais relevantes). Cada bullet deve ser uma frase completa, com acentuação correta e letra maiúscula no início.

## Pontos fortes
- (liste os aspectos positivos mais relevantes da submissão, máximo 4 bullets)

## Pontos de atenção
- (liste os problemas encontrados, máximo 4 bullets — omita esta seção se não houver)

## Conclusão
- Uma frase clara explicando o resultado. Se não aprovado, deixe claro que o projeto será revisado junto com o time de RPA para ajustes — não é uma rejeição.

## Recomendações
- (liste ações concretas de melhoria, mesmo se aprovado, máximo 4 bullets)

## RESUMO

Além da justificativa completa, gere um campo "resumo": um texto curto (2-4 frases) com a conclusão principal da análise. Esse resumo é o que o usuário verá na tela. Deve ser claro, direto e explicar o veredito em linguagem simples. Se o resultado for "rejeitado", NÃO use a palavra "rejeitado" nem "reprovado" — diga que a submissão será encaminhada para revisão conjunta com o time de RPA. Use markdown básico (**negrito** para ênfase).

## CLASSIFICAÇÃO DE COMPLEXIDADE

Classifique o projeto em EXATAMENTE um dos 3 níveis, analisando a documentação técnica em conjunto com a descrição breve.

REGRA CENTRAL: o que separa os níveis NÃO é "ter ou não uma LLM/IA". É o **papel** que a IA exerce no processo. Uma LLM que apenas AJUDA a pessoa numa etapa — resume, gera rascunho, extrai, traduz, responde, organiza — sem decidir o rumo do processo é **"automacao"**, NÃO "inteligencia". Usar a ferramenta "Claude" (ou qualquer LLM) por si só NÃO eleva a complexidade.

Os 3 níveis, pela ESSÊNCIA:

- **"automacao"** — gatilho. O processo dispara por um trigger (agendamento, evento, ação manual, abertura de uma tela/formulário/dashboard) e segue um caminho fixo/determinístico. NÃO há IA decidindo o rumo. Inclui tanto projetos sem IA quanto projetos onde a LLM é só uma ferramenta auxiliar dentro de um fluxo conduzido por uma pessoa ou por regras fixas. Ex: RPA que preenche planilha; n8n agendado que move dados; app/dashboard que organiza um cadastro; LLM que resume um documento para a pessoa ler e decidir.
- **"inteligencia"** — julgamento. A IA DECIDE qual caminho/ação tomar com base no conteúdo (faz o julgamento), mas o humano ainda está no loop conduzindo ou executando — tipicamente alguém abre uma tela (dashboard, formulário, chat) e age sobre o que a IA indicou. A inteligência está em a IA ESCOLHER o caminho, não em apenas processar/gerar texto. Ex: IA que classifica e roteia um ticket; IA que decide aprovar/escalar e a pessoa confirma; análise que recomenda a próxima ação para o operador.
- **"autonomia"** — execução. A IA decide o caminho E executa de ponta a ponta, com pouca ou nenhuma intervenção humana. É um agente que age sozinho. Ex: agente (ex.: uma skill .md executada no Claude) que recebe a tarefa, decide e resolve sozinho; pipeline que processa, decide e age sem humano no meio.

ÁRVORE DE DECISÃO (use exatamente esta lógica, nesta ordem):
1. Existe uma IA DECIDINDO o caminho/ação do processo (julgamento sobre o conteúdo)? Se **NÃO** → **"automacao"** — mesmo que o projeto use uma LLM apenas como auxiliar e mesmo que rode sozinho por agendamento.
2. Se **SIM**, o processo age/executa de ponta a ponta com pouca ou nenhuma intervenção humana (ninguém precisa abrir uma tela para conduzir/agir)?
   - Há humano no loop conduzindo (alguém abre tela/dashboard/formulário/chat e executa) → **"inteligencia"**.
   - Roda e age sozinho, sem humano conduzindo (agente autônomo) → **"autonomia"**.

ANTIPADRÃO — ERRO COMUM, NÃO COMETA:
- Projeto sofisticado, abrangente, com MUITAS integrações, painel/dashboard elaborado, ou que "muda bastante o processo / substitui o trabalho manual" NÃO é, por isso, "inteligencia". **Sofisticação de engenharia ≠ inteligência.** Orquestrar dados e ações (puxar de sistemas como Protheus/Metabase/planilhas, notificar pessoas, montar e disparar e-mails) é "automacao" — por mais completo que seja — SE não há uma IA escolhendo o que fazer.
- Se a submissão NÃO menciona NENHUMA IA/LLM/modelo/classificador/ML tomando uma decisão sobre o conteúdo, a complexidade é OBRIGATORIAMENTE "automacao". Na dúvida entre "automacao" e "inteligencia", escolha **"automacao"**.

EXEMPLOS:
- "Painel interno que recebe avisos de planilhas com um clique, puxa nº e status de pedidos do Protheus, notifica aprovadores e monta/envia e-mail aos fornecedores, substituindo controle manual por Excel/Metabase" → **automacao** (orquestra dados e ações; NENHUMA IA decide o caminho).
- "Robô que lê e-mails e CLASSIFICA cada um por assunto usando IA, roteando para a fila certa; um analista trata a fila" → **inteligencia** (a IA decide o roteamento; humano no loop).
- "Agente que recebe o chamado, decide a solução e responde o cliente sozinho" → **autonomia**.

Antes de escolher a complexidade, responda objetivamente: **existe uma IA decidindo o caminho/ação sobre o conteúdo?** Reporte essa resposta no campo booleano "ia_decide_caminho". Se for false, a complexidade DEVE ser "automacao".

Além da classificação, escreva uma justificativa curta (2-3 frases) no campo "complexidade_justificativa" explicando POR QUÊ o projeto foi classificado nesse nível. Cite evidências concretas da documentação (ex: "O projeto usa Claude para classificar tickets automaticamente, decidindo o roteamento — isso configura julgamento ativo da IA"). Se a classificação for "automacao", explique brevemente por que NÃO se enquadra em inteligência.

## FORMATO DE RESPOSTA

Responda APENAS com JSON válido, exatamente neste formato.

IMPORTANTE:
- No campo "criterio", use o **nome legível em português com acentuação correta** (ex: "Propósito de negócio claro"), NÃO o id em snake_case.
- Avalie TODOS os 10 critérios fixos + dinâmicos internamente para calcular a pontuação.
- Mas no JSON de resposta, retorne APENAS os **4 critérios aprovados mais relevantes** e os **4 critérios reprovados mais relevantes** (ou menos, se não houver tantos). O total de critérios retornados deve ser no MÁXIMO 8.
- Priorize os critérios que mais impactam a qualidade da submissão. Critérios óbvios ou triviais (que qualquer submissão atenderia) NÃO precisam aparecer.

{
  "resultado": "aprovado" | "rejeitado",
  "pontuacao_total": <number>,
  "pontuacao_maxima": <number>,
  "justificativa": "<texto detalhado em markdown com seções ## Pontos fortes, ## Pontos de atenção, ## Conclusão, ## Recomendações>",
  "resumo": "<2-4 frases claras resumindo o resultado para o usuário>",
  "ia_decide_caminho": true | false,
  "complexidade": "automacao" | "inteligencia" | "autonomia",
  "complexidade_justificativa": "<2-3 frases explicando por que este nível foi escolhido>",
  "criterios_hardcoded": [
    ...apenas os mais relevantes entre os 10 fixos (max 4 aprovados + max 4 reprovados)...
    {"criterio": "Nome legível do critério", "pontos": 0 | 1, "justificativa": "<explicação>"}
  ],
  "criterios_dinamicos": [
    ...apenas os mais relevantes (max 2-3 no total, contando no limite de 8)...
    {"criterio": "<Nome legível em português>", "pontos": 0 | 1, "justificativa": "<explicação>"}
  ]
}`;
}

// ─── User message (dados do projeto) ────────────────────────────────────────

function buildUserMessage(
  projeto: Record<string, unknown>,
  conteudo: Record<string, unknown>,
): string {
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  const dados: Record<string, unknown> = {
    metadados: {
      titulo: projeto.nome ?? conteudo.titulo ?? '(sem título)',
      descricao_breve: projeto.descricao_breve ?? '(sem descrição)',
      area: projeto.area ?? '(sem área)',
      ferramenta: projeto.ferramenta ?? '(sem ferramenta)',
      escopo: projeto.escopo ?? null,
      responsavel: `${projeto.responsavel_nome} (${projeto.responsavel_email})`,
      tipo_projeto: projeto.tipo_projeto ?? null,
    },
    documentacao_tecnica: {
      o_que_faz: conteudo.o_que_faz ?? '(não preenchido)',
      execucao: conteudo.execucao ?? '(não preenchido)',
      dependencias: conteudo.dependencias ?? '(não preenchido)',
      fluxo: conteudo.fluxo ?? '(não preenchido)',
      configurar_antes: conteudo.configurar_antes ?? '(não preenchido)',
      atencao: conteudo.atencao ?? '(não preenchido)',
    },
  };

  if (saving) {
    dados.memorial_saving = {
      linhas: saving.linhas ?? [],
      economia_horas_mes: saving.economia_horas_mes ?? 0,
      economia_reais_mes: saving.economia_reais_mes ?? 0,
      tipo_saving: saving.tipo_saving ?? null,
      memorial_calculo: saving.memorial_calculo ?? '(sem memorial)',
    };
  }

  if (receita) {
    dados.memorial_receita = {
      tipo_saving: receita.tipo_saving ?? null,
      valor_ganho_mensal: receita.valor_ganho_mensal ?? 0,
      memorial_calculo: receita.memorial_calculo ?? '(sem memorial)',
    };
  }

  return `Analise criticamente a seguinte submissão de projeto de automação:\n\n${JSON.stringify(dados, null, 2)}`;
}

// ─── Função principal ───────────────────────────────────────────────────────

export async function analisarProjeto(projetoId: string): Promise<ResultadoAnalise> {
  log(`Iniciando análise do projeto ${projetoId}`);

  const projeto = await getProjetoById(projetoId);
  if (!projeto) throw new Error('Projeto não encontrado.');

  const docRow = await getDocumentacao(projetoId);
  if (!docRow) throw new Error('Documentação não encontrada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(projeto as unknown as Record<string, unknown>, conteudo);

  log(`Chamando LLM para análise (${userMessage.length} chars de contexto)...`);

  const raw = await llmChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { jsonMode: true, temperature: 0.2, maxTokens: 4096 }
  );

  log(`LLM respondeu (${raw.length} chars)`);

  let resultado: ResultadoAnalise;
  try {
    resultado = JSON.parse(raw) as ResultadoAnalise;
  } catch (parseErr) {
    err('Falha ao parsear resposta da LLM:', parseErr);
    // Tenta extrair JSON de dentro de markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      resultado = JSON.parse(jsonMatch[1].trim()) as ResultadoAnalise;
    } else {
      throw new Error('Resposta da análise não é JSON válido.');
    }
  }

  // Validação básica da estrutura
  if (!resultado.resultado || !['aprovado', 'rejeitado'].includes(resultado.resultado)) {
    throw new Error('Resultado da análise inválido — campo "resultado" ausente ou incorreto.');
  }
  if (!Array.isArray(resultado.criterios_hardcoded)) {
    resultado.criterios_hardcoded = [];
  }
  if (!Array.isArray(resultado.criterios_dinamicos)) {
    resultado.criterios_dinamicos = [];
  }
  if (!resultado.resumo) {
    // Fallback: usa as primeiras 3 frases da justificativa como resumo
    const frases = (resultado.justificativa ?? '').split(/(?<=[.!?])\s+/).slice(0, 3);
    resultado.resumo = frases.join(' ') || 'Análise concluída.';
  }

  // Valida e normaliza complexidade
  const COMPLEXIDADES_VALIDAS: Complexidade[] = ['automacao', 'inteligencia', 'autonomia'];
  if (!resultado.complexidade || !COMPLEXIDADES_VALIDAS.includes(resultado.complexidade)) {
    resultado.complexidade = 'automacao'; // fallback conservador
  }
  // Gate determinístico: sem IA decidindo o caminho, não há "inteligencia" nem
  // "autonomia" — é "automacao", por mais sofisticada que seja a engenharia. O
  // modelo erra ao equiparar abrangência/integrações/dashboard a "inteligência";
  // o booleano (pergunta focada) é bem mais confiável que a escolha entre 3 rótulos.
  if (resultado.ia_decide_caminho === false && resultado.complexidade !== 'automacao') {
    log(`Complexidade rebaixada para 'automacao' (ia_decide_caminho=false; LLM havia sugerido '${resultado.complexidade}')`);
    resultado.complexidade = 'automacao';
  }

  // O LLM avalia todos os critérios internamente mas retorna só os mais relevantes.
  // Usamos pontuacao_total e pontuacao_maxima calculados pelo LLM (que viu todos).
  // Validação básica: garante que os valores existem.
  if (typeof resultado.pontuacao_total !== 'number') resultado.pontuacao_total = 0;
  if (typeof resultado.pontuacao_maxima !== 'number') resultado.pontuacao_maxima = 1;

  log(`Análise concluída: ${resultado.resultado} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  return resultado;
}
