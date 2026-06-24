// Agente Analisador — análise holística pré-submissão
// Avalia toda a submissão (doc + saving/receita + metadados) com critérios fixos + dinâmicos

import { llmChat } from '@/lib/llm';
import {
  getProjetoById,
  getDocumentacao,
  getDocMessage,
  parseJson,
} from '@/integrations/db/client.server';
import type { ResultadoAnalise, CriterioResult, Complexidade } from './types';
import { detectarAiProxy } from './extractor';

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
      'O memorial de saving/receita apresenta uma lógica de cálculo coerente: as horas antes/depois são justificadas com detalhamento da rotina manual, os valores são compatíveis com a complexidade descrita no projeto, e não há extrapolação evidente. REGRA DE REPROVAÇÃO AUTOMÁTICA (0 pontos): (1) se economia_horas_mes = 0 ou saving_reais = 0 quando há saving marcado; (2) se valor de receita incremental = 0 quando marcou receita; (3) CLASSIFICAÇÃO ERRADA: se o memorial de RECEITA INCREMENTAL descreve economia operacional (horas economizadas, custo/hora, minutos por tarefa, custo laboral reduzido) — isso é saving disfarçado de receita, configurando incoerência de classificação que deve ser apontada. RECONCILIAÇÃO FINANCEIRA (NÃO é divergência): economia_reais_mes é o valor LÍQUIDO = (R$ das horas, soma das linhas) + custo_evitado_reais − custo_externo_mensal. Portanto é NORMAL e ESPERADO que economia_reais_mes seja diferente da soma das linhas quando há custo_evitado_reais > 0 ou custo_externo_mensal > 0. NUNCA aponte essa diferença como "total consolidado divergente da soma por linha" ou inconsistência do memorial — ela é exatamente o custo evitado somado / custo externo subtraído.',
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

- **Claude**: modelo de IA da Anthropic. ATENÇÃO: no GoGroup o Claude é MUITAS VEZES usado só para **construir** o projeto (Claude Code — escrever o código), o que **NÃO** é IA como funcionalidade. Em outros casos ele roda **em tempo de execução** (LLM que gera/classifica/extrai/decide durante a automação) — aí sim é funcionalidade. A presença de "Claude" como ferramenta, por si só, NÃO indica IA no processo.
- **Claude + GoDeploy**: o app foi **construído** com Claude (Claude Code) e **hospedado** no GoDeploy (infra interna: SPAs+Workers/APIs, SQLite, cron, edge auth). Isso descreve **construção + hospedagem** — NÃO implica que a automação use IA ao rodar. Muitos são CRUDs/dashboards/plataformas **determinísticas** apenas hospedadas no GoDeploy.
- **n8n**: Plataforma de automação de workflows (low-code). Amplamente usada no GoGroup para integrações, ETL, webhooks e orquestração de processos.
- **Python**: Scripts e aplicações em Python — usado para automações, análise de dados, ML, scrapers, etc.
- **Google Apps Script**: Scripts dentro do ecossistema Google (Sheets, Docs, Drive, Gmail).

Quando a ferramenta for "Claude", "Claude + GoDeploy" ou qualquer outra listada acima, ela é VÁLIDA e RECONHECIDA pela empresa. NÃO penalize por "ferramenta desconhecida".

⚠️ **A FERRAMENTA NÃO DEFINE A COMPLEXIDADE.** Para classificar a complexidade, avalie **SOMENTE a automação em si**: quando ela **EXECUTA**, usa IA em algum passo do processo (gera texto, classifica, extrai com LLM, decide o rumo, resolve uma condicional com IA)? As ferramentas usadas para **construir/hospedar** (Claude Code, GoDeploy) **NÃO contam** — IA para desenvolver ≠ IA na execução. Um projeto com ferramenta "Claude + GoDeploy" que, ao rodar, só faz CRUD/dashboards/alertas por regra (sem IA no fluxo) é **automacao**.

## POSTURA

- Seu objetivo é APROVAR projetos que façam sentido — a plataforma existe para documentar e registrar, não para barrar. Só reprove quando houver falha grave e evidente (incoerência lógica, saving claramente extrapolado, documentação vazia ou sem sentido).
- Avalie a COERÊNCIA entre as partes: a descrição breve bate com a documentação? O saving faz sentido dado o fluxo descrito? A ferramenta é compatível com as dependências?
- Brevidade NÃO é defeito. Um campo curto mas preciso e correto vale tanto quanto um campo longo.
- Na dúvida entre aprovar e reprovar, APROVE — e registre as ressalvas nas recomendações. A triagem humana fará o ajuste fino.
- Reserve a reprovação para casos onde a submissão realmente não se sustenta: saving sem lógica, documentação contraditória, ou informações que não fazem sentido juntas.
- Considere SEMPRE o campo \`documentacao_enviada_usuario\` (texto extraído dos arquivos que a pessoa anexou) — é a fonte mais rica sobre o que o projeto realmente faz.

## AVALIAÇÃO DE PROJETO ESPECIAL (só quando metadados.marcado_como_especial = true)

Projeto ESPECIAL legítimo = **altíssimo impacto** para a empresa, MAS **não diretamente ligado a um ganho de receita ou redução de custos OBJETIVAMENTE mensurável** (ex.: engajamento, qualidade do produto/entrega, estratégia, fundação para outros projetos). Esses NÃO passam por memorial de saving/receita — vão direto para validação humana.

Julgue CRITICAMENTE, cruzando descrição + \`contexto_especial\` (a justificativa que a pessoa deu) + \`documentacao_enviada_usuario\`, se o projeto **realmente se enquadra como especial** OU se é uma **automação/projeto PADRÃO mal rotulado** (ex.: um RPA simples, uma notificação, uma movimentação de dados, um relatório automático — coisas com saving/receita mensurável que deveriam seguir o fluxo padrão). MUITA gente marca "especial" pra pular a etapa de impacto — seja cético.

- Declare seu VEREDITO de forma explícita no \`resumo\` e na \`justificativa\`: ou "**Enquadra-se como especial** porque \<motivo do alto impacto + por que a mensuração é difícil>", ou "**NÃO parece especial** — é uma automação padrão que \<gera saving/receita mensurável / é simples>; recomendo reclassificar como saving e/ou receita."
- Para projetos marcados como especiais NÃO há memorial de saving/receita — **NÃO penalize** a ausência dele (o critério "Memorial de cálculo" não se aplica; avalie pela doc técnica + contexto + arquivos).
- O resultado (aprovado/rejeitado) e a pontuação são secundários para especiais (a decisão é humana) — o foco é a CLASSIFICAÇÃO de complexidade + o PARECER sobre a legitimidade do "especial".

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

REGRA CENTRAL — DOIS CRITÉRIOS INDEPENDENTES que determinam o nível:

**Critério A — IA como funcionalidade:** O projeto usa IA como parte do que ENTREGA (mesmo que secundário — gera texto, classifica, transcreve, extrai dados com LLM, recomenda, etc.)? Isso é diferente de ter sido construído com ajuda de IA.
- Se o campo "tem_ia_como_funcionalidade" dos metadados for **true**, o projeto tem IA como funcionalidade — a complexidade mínima é **"inteligencia"** (nunca "automacao").
- Se for **false**, NÃO há IA como funcionalidade — a complexidade é **"automacao"** independentemente de qualquer outro fator.
- Se for **null** (submissão antiga, não foi perguntado), infira pela documentação técnica.

**Critério B — papel da IA no processo (para projetos com IA como funcionalidade):** A IA apenas entrega um resultado que o humano usa, ou ela decide o rumo e age autonomamente?

Os 3 níveis, pela ESSÊNCIA:

- **"automacao"** — processo determinístico. Dispara por trigger e segue caminho fixo/determinístico. NÃO há IA como funcionalidade do produto (ou a IA foi usada apenas para construir/auxiliar o desenvolvimento, não como feature). Ex: RPA que preenche planilha; n8n agendado que move dados; app/dashboard que organiza cadastro.
- **"inteligencia"** — a IA é uma funcionalidade do produto. Gera, classifica, extrai, transcreve ou recomenda como parte do que o projeto ENTREGA — mas o humano ainda conduz o processo (abre a tela, age sobre o resultado). Ex: automação que gera documentação por IA; IA que classifica e roteia tickets (analista trata a fila); extração inteligente de dados que uma pessoa revisa.
- **"autonomia"** — a IA decide o caminho E executa de ponta a ponta, com pouca ou nenhuma intervenção humana. É um agente que age sozinho. Ex: agente que recebe tarefa, decide e resolve sozinho; pipeline que processa, decide e age sem humano no meio.

ÁRVORE DE DECISÃO (use exatamente esta lógica, nesta ordem):
1. **tem_ia_como_funcionalidade = false** (ou documentação deixa claro que não há IA como feature)? → **"automacao"** — fim.
2. **tem_ia_como_funcionalidade = true** (ou documentação indica IA como feature)? → pelo menos **"inteligencia"**. Agora avalie:
   - A IA age/executa de ponta a ponta com pouca ou nenhuma intervenção humana? → **"autonomia"**.
   - Há humano no loop conduzindo (alguém abre tela/dashboard/formulário/chat e age sobre o resultado)? → **"inteligencia"**.

ANTIPADRÃO — ERRO COMUM, NÃO COMETA:
- Projeto sofisticado, abrangente, com MUITAS integrações ou painel elaborado NÃO é, por isso, "inteligencia". **Sofisticação de engenharia ≠ inteligência.** Orquestrar dados e ações (puxar de sistemas, notificar, montar e-mails) é "automacao" SE não há IA como funcionalidade do produto.
- **A ferramenta NÃO define o nível.** Claude Code e GoDeploy são, na maioria dos casos, as ferramentas usadas para **construir e hospedar** o projeto — NÃO IA no processo. Ferramenta "Claude"/"Claude + GoDeploy" NÃO eleva para "inteligencia" por si só.
- IA usada APENAS para construir/desenvolver o projeto ("usei o Claude para escrever o código", "hospedei no GoDeploy") NÃO conta. Só conta se a IA roda **dentro da automação, em tempo de execução**.
- Plataforma/CRUD/dashboards/relatórios/alertas-por-regra que, AO RODAR, NÃO usa IA em nenhum passo do fluxo = **automacao**, mesmo que tenha sido feita com Claude+GoDeploy e seja de alto impacto. (Ex.: sistema de gestão que centraliza dados, mostra dashboards e dispara alertas determinísticos de mudança de risco — sem LLM no fluxo — é automacao.)

EXEMPLOS:
- "Painel interno que recebe avisos de planilhas com um clique, puxa nº e status de pedidos do Protheus, notifica aprovadores e monta/envia e-mail aos fornecedores" → **automacao** (orquestra dados e ações; NENHUMA IA como funcionalidade).
- "n8n que puxa todos os fluxos e gera documentação simples por IA" → **inteligencia** (IA gera o conteúdo como funcionalidade; humano consulta o resultado).
- "Robô que lê e-mails e CLASSIFICA cada um por assunto usando IA, roteando para a fila certa; um analista trata a fila" → **inteligencia** (IA classifica como feature; humano no loop).
- "Agente que recebe o chamado, decide a solução e responde o cliente sozinho" → **autonomia**.

Antes de escolher a complexidade, responda objetivamente: **a AUTOMAÇÃO, quando EXECUTA, usa IA em algum passo do processo?** (gera/classifica/extrai/transcreve/decide/resolve condicional com IA — não as ferramentas usadas para construí-la). Reporte no campo booleano "usa_ia" (true = a automação usa IA ao rodar; false = não usa IA na execução, mesmo que tenha sido construída com Claude). Se for false, a complexidade DEVE ser "automacao". Se for true, é pelo menos "inteligencia".

Além da classificação, escreva uma justificativa curta (2-3 frases) no campo "complexidade_justificativa" explicando POR QUÊ o projeto foi classificado nesse nível. Cite evidências concretas da documentação (ex: "O projeto usa Claude para classificar tickets automaticamente, decidindo o roteamento — isso configura julgamento ativo da IA"). Se a classificação for "automacao", explique brevemente por que NÃO se enquadra em inteligência.

## CUSTOS DO PROJETO (cross-check declaração × documentação)

O formulário coleta os "custos do projeto" — serviços externos PAGOS que a solução consome para rodar (chave de API da OpenAI, ElevenLabs, um SaaS por uso). Eles chegam em memorial_saving.custo_projeto_itens (lista declarada) e custo_projeto_reais (total mensalizado, que ABATE o ganho). Compare a declaração com os serviços pagos que aparecem em documentacao_enviada_usuario / dependencias:
- Se a doc menciona um serviço externo claramente PAGO (ex.: ElevenLabs, OpenAI por uso, Twilio) que NÃO está na lista declarada, aponte em "Pontos de atenção"/Recomendações que o custo pode estar subestimado.
- Se a pessoa declarou um custo que não tem respaldo na doc, sinalize para conferência.
- Não invente valores nem altere o cálculo — apenas registre a divergência qualitativamente (o valor é determinístico, vem do formulário). Quando declaração e doc batem, não comente.

## AI PROXY (governança de custo)

Os metadados trazem "usa_ai_proxy_declarado" (resposta do formulário: 'sim'/'nao'/null) e "ai_proxy_detectado_na_doc" (booleano: o gateway interno ai-proxy.gogroupbr.com foi encontrado no material enviado). Compare os dois e, **se houver divergência**, registre-a em UMA frase nas Observações/resumo (NÃO altere o resultado nem a complexidade por causa disso):
- detectado=true mas declarado='nao' (ou null): o código usa o AI Proxy mas o autor não declarou — aponte para conferência.
- detectado=false mas declarado='sim': o autor declarou usar o AI Proxy mas não há evidência na doc — aponte para conferência.
- Se o projeto usa IA na execução ("usa_ia"=true) mas NÃO passa pelo AI Proxy (declarado='nao' e detectado=false), registre que vale orientar a migração para o proxy interno (economia de custo). Quando declaração e detecção batem, não comente.

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
  "usa_ia": true | false,
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
  docTexto?: string | null,
): string {
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;
  const ehEspecial = projeto.especial === 1 || projeto.especial === true;

  const dados: Record<string, unknown> = {
    metadados: {
      titulo: projeto.nome ?? conteudo.titulo ?? '(sem título)',
      descricao_breve: projeto.descricao_breve ?? '(sem descrição)',
      area: projeto.area ?? '(sem área)',
      ferramenta: projeto.ferramenta ?? '(sem ferramenta)',
      escopo: projeto.escopo ?? null,
      responsavel: `${projeto.responsavel_nome} (${projeto.responsavel_email})`,
      tipo_projeto: projeto.tipo_projeto ?? null,
      // Marcado pelo usuário como "projeto especial" (alto impacto, difícil
      // mensuração). O analisador deve JULGAR se isso se sustenta (ver prompt).
      marcado_como_especial: ehEspecial,
      contexto_especial: projeto.contexto_especial ?? null,
      // Resposta explícita do usuário sobre uso de IA como funcionalidade.
      // true  → projeto tem IA como feature (mesmo secundária) — considere ao menos "inteligencia".
      // false → sem IA como funcionalidade, processo puramente determinístico.
      // null  → não foi perguntado (submissão antiga); infira pela documentação.
      tem_ia_como_funcionalidade: conteudo.tem_ia_como_funcionalidade ?? null,
      // Governança de IA: o usuário DECLAROU no formulário se usa o AI Proxy interno
      // ('sim'/'nao'/null) e nós DETECTAMOS o uso do gateway (ai-proxy.gogroupbr.com)
      // na doc enviada. Se há detecção mas a declaração foi 'nao' (ou vice-versa),
      // sinalize a divergência nas Observações (não bloqueia).
      usa_ai_proxy_declarado: projeto.usa_ai_proxy ?? null,
      ai_proxy_detectado_na_doc: detectarAiProxy(docTexto),
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

  // Texto extraído dos arquivos que a pessoa enviou (capado p/ não estourar o
  // contexto). É a fonte mais rica — sobretudo p/ especial, que não passa pelo chat.
  const docUser = (docTexto ?? '').trim();
  if (docUser) {
    dados.documentacao_enviada_usuario =
      docUser.length > 40000 ? `${docUser.slice(0, 40000)}\n…[texto truncado]` : docUser;
  }

  if (saving) {
    dados.memorial_saving = {
      linhas: saving.linhas ?? [],
      economia_horas_mes: saving.economia_horas_mes ?? 0,
      // economia_reais_mes é o LÍQUIDO = R$ das horas (soma das linhas) + custo_evitado_reais
      // − custo_externo_mensal. Enviamos as parcelas para o analisador reconciliar e NÃO
      // confundir a diferença (horas × líquido) com uma inconsistência do memorial.
      economia_reais_mes: saving.economia_reais_mes ?? 0,
      custo_evitado_reais: saving.custo_evitado_reais ?? 0,
      custo_evitado_tipo: saving.custo_evitado_tipo ?? null,
      custo_externo_mensal: saving.custo_externo_mensal ?? 0,
      // Custos do projeto DECLARADOS no formulário (serviços externos pagos que a
      // solução consome). Total mensalizado que ABATE + a lista de itens, para o
      // analisador cruzar com os serviços pagos que aparecem na doc enviada.
      custo_projeto_reais: saving.custo_projeto_reais ?? 0,
      custo_projeto_itens: parseJson(projeto.custo_projeto_itens as string | null) ?? [],
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

  // Texto extraído dos arquivos enviados (role 'doc') — alimenta a análise com o
  // material original da pessoa (essencial p/ especial, que não passa pelo chat).
  const docMsg = await getDocMessage(projetoId);

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(
    projeto as unknown as Record<string, unknown>,
    conteudo,
    docMsg?.content ?? null,
  );

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
  // Gate determinístico: o campo tem_ia_como_funcionalidade (resposta explícita
  // do usuário no chat) tem precedência sobre o usa_ia inferido pelo LLM.
  // IA usada só para construir/desenvolver (ex: Claude Code) NÃO conta.
  const temIaComoFuncionalidade = (conteudo as Record<string, unknown>).tem_ia_como_funcionalidade;
  if (temIaComoFuncionalidade === true && resultado.complexidade === 'automacao') {
    log(`Complexidade elevada para 'inteligencia' (tem_ia_como_funcionalidade=true; LLM havia sugerido 'automacao')`);
    resultado.complexidade = 'inteligencia';
    resultado.usa_ia = true;
  } else if (temIaComoFuncionalidade === false && resultado.complexidade !== 'automacao') {
    log(`Complexidade rebaixada para 'automacao' (tem_ia_como_funcionalidade=false; LLM havia sugerido '${resultado.complexidade}')`);
    resultado.complexidade = 'automacao';
    resultado.usa_ia = false;
  } else if (resultado.usa_ia === false && resultado.complexidade !== 'automacao') {
    log(`Complexidade rebaixada para 'automacao' (usa_ia=false; LLM havia sugerido '${resultado.complexidade}')`);
    resultado.complexidade = 'automacao';
  } else if (resultado.usa_ia === true && resultado.complexidade === 'automacao') {
    log(`Complexidade elevada para 'inteligencia' (usa_ia=true; LLM havia sugerido 'automacao')`);
    resultado.complexidade = 'inteligencia';
  }

  // O LLM avalia todos os critérios internamente mas retorna só os mais relevantes.
  // Usamos pontuacao_total e pontuacao_maxima calculados pelo LLM (que viu todos).
  // Validação básica: garante que os valores existem.
  if (typeof resultado.pontuacao_total !== 'number') resultado.pontuacao_total = 0;
  if (typeof resultado.pontuacao_maxima !== 'number') resultado.pontuacao_maxima = 1;

  log(`Análise concluída: ${resultado.resultado} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  return resultado;
}
