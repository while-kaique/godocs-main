// Agente Analisador — análise holística pré-submissão
// Avalia toda a submissão (doc + saving/receita + metadados) com critérios fixos + dinâmicos

import { llmChat } from '@/lib/llm';
import {
  getProjetoById,
  getDocumentacao,
  getDocMessage,
  parseJson,
} from '@/integrations/db/client.server';
import type {
  ResultadoAnalise,
  CriterioResult,
  Complexidade,
  ClassificacaoAvaliacao,
} from './types';
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

Classifique o projeto em EXATAMENTE um dos 3 níveis: "automacao", "inteligencia" ou "autonomia". A classificação NÃO depende de quão sofisticado, abrangente ou impactante é o projeto — depende de DUAS propriedades do TRABALHO que a automação faz. Responda as duas perguntas abaixo SOBRE O TRABALHO (não sobre como o projeto parece) e siga a árvore.

**PERGUNTA A — JULGAMENTO (separa automação ↔ inteligência):** para produzir sua saída, o projeto usa IA como FUNCIONALIDADE — precisa interpretar algo aberto/ambíguo que nenhuma regra fixa escrita de antemão resolveria (gera texto, classifica conteúdo livre, transcreve, extrai sentido com LLM, recomenda)? Ou segue um caminho DETERMINÍSTICO (regras, if-else, árvore de lógica, por mais complexa que seja)?
- O campo "tem_ia_como_funcionalidade" dos metadados é a resposta do USUÁRIO e tem PRECEDÊNCIA: **true** = usa IA como funcionalidade; **false** = determinístico (sem IA como feature); **null** (submissão antiga) = infira da documentação.
- IA usada só para CONSTRUIR/desenvolver o projeto (Claude Code) ou para HOSPEDAR (GoDeploy) NÃO conta — só conta IA que roda DENTRO da automação, em tempo de execução.

**PERGUNTA B — FECHAMENTO DO CICLO (define a AUTONOMIA e SOBREPÕE a Pergunta A):** quando o projeto termina, o caso está CONCLUÍDO — ele decidiu E executou a AÇÃO consequente final que um humano tomaria, atuando sobre o objeto do processo, sem um humano confirmar? Ou ele entregou um INSUMO (informação, relatório, alerta, recomendação, fila) que ainda EXIGE um humano decidir e agir?
- Concluiu o caso sozinho (tomou a ação) → **"autonomia"** — INDEPENDENTE de usar IA ou não (a decisão por trás pode ser IA OU árvore de lógica determinística).
- Entregou um insumo para um humano decidir → fica no nível da Pergunta A.

ÁRVORE DE DECISÃO (use EXATAMENTE esta ordem — a AÇÃO vem primeiro e tem precedência sobre a IA):
1. O projeto EXECUTA uma ação consequente na última ponta, sozinho (muda o estado do mundo / atua sobre o objeto do processo sem um humano confirmar)? → **"autonomia"** (com OU sem IA). Reporte acao_autonoma=true.
2. Senão: usa IA como FUNCIONALIDADE (gera/classifica/extrai/transcreve/recomenda) e um humano age sobre o output? → **"inteligencia"**. Reporte acao_autonoma=false.
3. Senão: → **"automacao"** (determinístico que entrega informação/output, ou ação trivial/fixa). Reporte acao_autonoma=false.

DEFINIÇÃO DOS 3 NÍVEIS:
- **"automacao"** — dispara por trigger e segue caminho DETERMINÍSTICO (mesmo com decisões/if-else). Chega até a etapa de INFORMAÇÃO/output: extrai, trata, centraliza, calcula, mostra, alerta, recomenda — e ENTREGA para um humano decidir/agir. NÃO usa IA como funcionalidade E NÃO toma a ação consequente sozinho. (Ex.: RPA que preenche planilha; dashboard de margem; n8n que move dados; alerta por regra.)
- **"inteligencia"** — usa IA como FUNCIONALIDADE (julgamento não-trivial: gera/classifica/extrai/recomenda como parte do que entrega) — mas o HUMANO ainda conduz: abre a tela/fila/chat e age sobre o resultado. (Ex.: IA que gera documentação; IA que classifica e roteia tickets e um analista trata a fila.)
- **"autonomia"** — toma a AÇÃO consequente na última ponta, sozinho, com pouca ou nenhuma intervenção humana. A decisão por trás pode ser IA OU lógica determinística. (Ex.: agente que recebe o chamado, decide e RESPONDE o cliente sozinho; sistema que detecta a queda de margem e TIRA os cupons do produto automaticamente — mesmo por regra, sem IA.)

CONCEITO-CHAVE — "ação consequente na última ponta": o sistema atua sobre o OBJETO do processo / muda o estado do mundo sem um humano confirmar.
- É ação consequente (→ autonomia): tira/aplica cupom, ajusta preço, move estoque; responde o cliente / fecha o chamado; o PRÓPRIO sistema aprova ou reprova um pagamento/pedido sozinho como decisão final (NÃO um humano clicando "aprovar" numa tela); posta/envia/dispara algo que tem EFEITO no negócio.
- NÃO é ação consequente (→ no máximo automação/inteligência): gerar dashboard/relatório/planilha; alerta/notificação/e-mail INFORMATIVO; recomendação/ranking/classificação que vira FILA para alguém tratar.

QUATRO TESTES PARA OS CASOS DIFÍCEIS (decisivos — use-os):
1. **Write como DECISÃO × write como PERSISTÊNCIA:** gravar num sistema (planilha, banco, ERP) só ELEVA para autonomia se o registro É a DECISÃO/desfecho de negócio (ex.: lançar a aprovação que LIBERA o pedido). Se é só ARMAZENAR um dado do fluxo (log, cache, "salvar o resultado", atualizar um status intermediário) → é persistência/MEIO, NÃO eleva.
2. **RESOLVE × AVISA (mesma mensagem, função diferente):** responder o cliente e FECHAR o chamado é ação (autonomia); mandar um e-mail/alerta que AVISA um humano para ele resolver NÃO é (automação) — embora ambos "enviem mensagem". O que conta é se a mensagem É o desfecho ou só passa a bola.
3. **Confirmação ANTES × override DEPOIS:** se um humano confirma/aprova ANTES de cada ação ser executada → NÃO é autonomia (inteligência se houver IA, senão automação). Se o sistema TOMA a ação por padrão e um humano apenas audita / pode reverter depois (exceções) → É autonomia.
4. **QUEM dispara a ação — humano × sistema (o falso-positivo mais comum):** se a "ação" (aprovar, mudar status, criar/editar registro) é feita por um HUMANO operando a ferramenta (clica "aprovar", muda o status numa tela, preenche um formulário), o sistema apenas REGISTRA a decisão da pessoa → automação (ou inteligência se houver IA), **NÃO autonomia**. Autonomia exige que o PRÓPRIO SISTEMA decida e execute a ação a partir do seu trigger, sem um humano acionando cada uma. ⚠️ App / CRUD / plataforma de aprovação ou gestão (fila de aprovações, mudança de status por clique, cadastro) é o caso CLÁSSICO de falso-positivo: "atualiza o status" por ação humana ≠ ação autônoma.

NÃO CLASSIFIQUE POR ESTES SINAIS (red herrings — ignore deliberadamente):
- **"roda sozinho / 24/7 / por trigger"** → é OPERAÇÃO (o degrau da automação), NÃO a ação que fecha o ciclo. Um coletor que roda 24/7 e carrega um painel é AUTOMAÇÃO, por mais "sozinho" que opere.
- **"usa IA / foi feito com Claude"** → só importa se a IA faz julgamento em runtime (Pergunta A); NUNCA define autonomia.
- **"eliminou trabalho humano / alto impacto / muitas integrações / engenharia sofisticada"** → é SAVING/engenharia, não a natureza do trabalho. Um dashboard que ANTES era feito por muita gente e hoje por ninguém continua AUTOMAÇÃO se para na informação (o "não tem mais humano" se refere a PRODUZIR o output, não a TOMAR a ação).
- **"tem decisão / if-else"** → decisão DETERMINÍSTICA não eleva nada — "a decisão até uma automação pode dar".

ANTIPADRÕES — ERROS COMUNS, NÃO COMETA:
- **"Automatizou até a última ponta do dashboard" ≠ autonomia.** A "última ponta" relevante é a TOMADA DE AÇÃO consequente, não o fim do pipeline de dados. Um dashboard não toma decisão E ação.
- IA que só gera output para um humano agir = **"inteligencia"**, NUNCA "autonomia".
- **A ferramenta NÃO define o nível.** Plataforma/CRUD/dashboard/relatório/alerta-por-regra feita com Claude+GoDeploy, que AO RODAR não usa IA e não toma ação consequente automática = **"automacao"**, por mais impactante que seja.
- Decisão por IA NÃO é pré-requisito de autonomia, mas também não é atalho: um sistema 100% determinístico que age sozinho na ponta É autonomia; um sistema cheio de IA que só informa NÃO é.

EXEMPLOS:
- "Dashboard de margem diária que aponta os produtos que derrubam a margem; um humano decide e age" → **automacao** (chega à informação; não tira cupom sozinho).
- "O mesmo, mas que TIRA os cupons do produto automaticamente ao detectar a queda" → **autonomia** (ação consequente na ponta, mesmo por regra, sem IA).
- "Painel que puxa pedidos do Protheus, notifica aprovadores e monta/envia e-mail ao fornecedor" → **automacao** (orquestra dados e INFORMA; NENHUMA IA como funcionalidade; a ação final, aprovar, é humana).
- "n8n que puxa os fluxos e gera documentação por IA; humano consulta" → **inteligencia** (IA gera o conteúdo como funcionalidade; humano no loop).
- "Robô que CLASSIFICA tickets por IA e roteia para a fila certa; um analista trata a fila" → **inteligencia** (IA classifica como feature; a ação é humana).
- "Agente que recebe o chamado, decide e RESPONDE o cliente sozinho" → **autonomia**.
- "RPA determinístico que, ao detectar a condição X, APROVA o pedido sozinho no ERP (sem IA)" → **autonomia** (ação consequente automática que é a DECISÃO final, mesmo sem IA).

Reporte DOIS campos booleanos, além da complexidade:
- **"usa_ia"** (Pergunta A) — a automação, quando EXECUTA, usa IA em algum passo (gera/classifica/extrai/transcreve/decide com IA — não as ferramentas usadas para construí-la)? true = usa IA no runtime; false = determinística, mesmo se construída com Claude. Se false, a complexidade NÃO pode ser "inteligencia" (será "automacao" ou, se tomar a ação consequente, "autonomia"). Se true, é pelo menos "inteligencia" (a não ser que tome a ação → "autonomia").
- **"acao_autonoma"** (Pergunta B / passo 1 da árvore) — o projeto toma a AÇÃO consequente na última ponta sozinho, sem um humano confirmar (fecha o caso e age sobre o objeto do processo)? true = fecha o caso e age; false = entrega insumo para um humano decidir/agir. Só classifique "autonomia" quando acao_autonoma=true.

Escreva também "complexidade_justificativa" (2-3 frases) citando evidência concreta da documentação. Para **"autonomia"**, a justificativa DEVE nomear a AÇÃO consequente específica que o sistema toma sozinho (ex.: "remove o cupom no e-commerce automaticamente ao detectar a queda de margem"); se não houver uma ação concreta nomeável, NÃO é autonomia. Para **"automacao"**, explique por que NÃO é inteligência (sem IA no runtime) nem autonomia (para na informação).

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

## RÉGUA DE CRITÉRIO DE PROJETO ("isto é um projeto?") — CLASSIFICAÇÃO OBRIGATÓRIA

Além do veredito de qualidade acima, você deve julgar a **ELEGIBILIDADE** da submissão: isto é um **projeto de automação** ou é uma **peça única sem evidência**? Este julgamento é INDEPENDENTE da pontuação e usa 3 critérios:

1. **RECORRÊNCIA** — a solução **roda de novo** sem alguém pedir (agendada, por evento, em uso contínuo) ou é reusada de forma sistemática? Uma entrega feita UMA vez, sob encomenda, que ninguém executa novamente, NÃO tem recorrência. ⚠️ Projeto **PONTUAL legítimo** existe (uma migração/limpeza de base que rodou uma vez e resolveu um problema real e mensurável) — o que reprova é a peça única **sem efeito duradouro nem evidência**.
2. **CONTRAFACTUAL** — se **desligar hoje**, algo **piora de forma perceptível** e alguém **reclama**? O autor respondeu no formulário QUEM sentiria falta (\`contrafactual_afetados\` — pessoas específicas ou um time/área inteiro, escolhidos na Team Guide). ⚠️ O formulário **NÃO pergunta mais O QUE piora**: esse efeito você extrai da **documentação e do memorial** (o processo que voltaria a ser manual, o que atrasaria, o que voltaria a dar erro) — não cobre nem cite um campo de formulário para isso. "Ninguém reclamaria" / "nada mudaria" é sinal FORTE de que não é projeto; um time inteiro nomeado é sinal forte a favor. Lista de afetados vazia **e** nada na documentação indicando quem depende da automação → contrafactual NÃO sustentado.
3. **RASTREABILIDADE** — existe um **indicador nomeado** que mudou, verificável em um **relatório, sistema ou base** que se possa abrir e conferir? Isso NÃO vem do formulário: quem coleta é o AGENTE, na seção **"Ponteiro movido e onde verificar"** do memorial (qual ponteiro — custo/receita/KPI — e onde conferir), junto da seção **"Processo alterado"** (o que mudou e quanto). Seção ausente (submissão antiga) ou registrando que o autor não sabe onde conferir → rastreabilidade NÃO comprovada, o que puxa para **zona_cinzenta** — não para reprovação automática. Os campos \`ponteiro_movido\`/\`ponteiro_evidencia\` só existem em submissões da época em que a pergunta ficava no formulário; quando vierem preenchidos, valem como resposta do autor.
   ⚠️ **O próprio entregável NÃO conta como indicador.** "Dá pra conferir no slide", "o arquivo gerado está lá", "o material do evento mostra o resultado" provam apenas que a **peça foi produzida** — provam a existência do artefato, não que um ponteiro se moveu. Indicador é uma **métrica** (horas de trabalho · custo · taxa de erro/retrabalho · prazo/SLA · receita) que se abra **hoje** num relatório, sistema ou base nomeados e que se possa comparar **antes × depois**. Quando a **única evidência** oferecida é o entregável produzido (o slide, o arquivo, o material), a rastreabilidade **não está comprovada** — trate-a como ausente.
   ⚠️ **Contrato/serviço externo ENCERRADO é indicador nomeado.** Quando \`memorial_saving.custo_evitado_reais\` > 0 e \`custo_evitado_itens\` nomeia o serviço que deixou de ser pago (ex.: "Equipe terceirizada — R$ 3.600/mês"), a rastreabilidade está comprovada pelo eixo **custo**: o contrato/nota que parou é conferível e já é um antes × depois. Não rebaixe por faltar painel ou KPI — nesse caso o custo É o ponteiro.

**O impacto NÃO precisa ser receita.** Vale qualquer ganho recorrente e verificável desta taxonomia: **horas** de trabalho humano · **custo** (headcount, hora extra, contrato/licença) · **erro** (taxa de falha, retrabalho) · **fraude/risco** evitado · **prazo/SLA** (tempo de ciclo) · **receita**. Um projeto que só reduz erro, sem tocar em R$, é projeto legítimo.

⚠️ **SIMPLICIDADE NÃO REPROVA.** Projeto simples, pequeno ou feito em pouco tempo é BEM-VINDO — a plataforma existe para registrar automações do dia a dia. O que reprova é **falta de recorrência** + **falta de evidência**, nunca o tamanho, a sofisticação ou o valor baixo. Um script de 20 linhas que roda todo dia e economiza 2h/mês é **claro_sim**.

EXEMPLOS-ÂNCORA (calibração):
- "Nuvem de palavras gerada uma vez a partir de respostas de uma pesquisa, para uma apresentação" → **claro_nao** (não roda de novo, ninguém reclama se sumir, nenhum indicador verificável). Foi aprendizado/artefato, não projeto. Segue **claro_nao** **mesmo que** o autor diga que "o resultado dá pra ver no slide" ou que o material da apresentação comprova a entrega: isso mostra que a peça foi feita, não que um ponteiro mudou.
- "Cronômetro/planilha feita para medir uma atividade numa ocasião" → **claro_nao** (peça única, sem indicador).
- "Robô que fecha a conciliação todo dia 1º e derrubou o retrabalho do time" → **claro_sim** (recorrente; se desligar, o fechamento atrasa; verificável no relatório de conciliação).
- "Automação em produção há 3 meses, o autor descreve o ganho, mas não sabe dizer onde conferir" → **zona_cinzenta** (recorrência sim, rastreabilidade não).

REGRAS DA CLASSIFICAÇÃO:
- **"claro_sim"** — os 3 critérios se sustentam (ou 2 se sustentam e o terceiro é claramente inferível da documentação).
- **"claro_nao"** — falha **evidente** em recorrência **E** em rastreabilidade/contrafactual: é peça única sem efeito duradouro nem indicador. Use com PARCIMÔNIA — só quando a submissão não se sustenta como projeto.
- **"claro_nao" — o par que reprova, declarado:** quando a **recorrência** falha (a entrega rodou uma vez, sob encomenda, é peça única e ninguém a executa de novo) **E** o **contrafactual** é negado (o autor indica — na conversa ou na documentação — que nada piora, ninguém reclama ou ninguém pediu de novo), a classificação é **claro_nao** — **sem buscar salvação** numa evidência de que o entregável existiu (o slide, o arquivo, o material). Os dois critérios que sustentam "isto é um projeto" falharam juntos; a rastreabilidade do artefato não os repõe.
- **"zona_cinzenta"** — qualquer dúvida razoável, incluindo: falta só a rastreabilidade; o autor respondeu "nenhum / ainda não sei" no ponteiro mas descreve um ganho plausível; a evidência é vaga. **Na dúvida entre claro_nao e zona_cinzenta, escolha SEMPRE zona_cinzenta** (a triagem humana decide) — com UMA **exceção** declarada: isso **não se aplica** quando recorrência e contrafactual falham **juntos** (o par acima), caso em que a classificação correta é **claro_nao**.
- **A justificativa é OBRIGATÓRIA em TODOS os casos**, inclusive "claro_sim": 2 a 4 frases dizendo **qual critério passou e qual falhou, e por quê**, citando o que o autor respondeu. Nunca escreva algo genérico como "atende aos critérios".
- Em **"claro_nao"**, escreva também \`motivo_reprovacao\`: um texto **legível pelo AUTOR** (ele vai ver), respeitoso e concreto, dizendo o que faltou e o que ele pode fazer (ex.: "Esta entrega foi executada uma única vez e não há um indicador verificável de mudança. Se a rotina passar a rodar de forma recorrente — ou se você puder apontar o relatório onde o ganho aparece — submeta novamente."). SEM motivo, a reprovação é rebaixada automaticamente para zona cinzenta.
- Projeto marcado como **ESPECIAL** nunca é reprovado por esta régua (a rota especial existe exatamente para impacto real de difícil mensuração) — classifique-o como "zona_cinzenta" e explique.

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
  "acao_autonoma": true | false,
  "complexidade": "automacao" | "inteligencia" | "autonomia",
  "complexidade_justificativa": "<2-3 frases explicando por que este nível foi escolhido>",
  "classificacao_avaliacao": "claro_sim" | "claro_nao" | "zona_cinzenta",
  "classificacao_justificativa": "<OBRIGATÓRIO em todos os casos: 2-4 frases dizendo qual critério (recorrência/contrafactual/rastreabilidade) passou ou falhou e por quê>",
  "motivo_reprovacao": "<só quando classificacao_avaliacao='claro_nao': texto legível PELO AUTOR dizendo o que faltou e o que fazer; nos outros casos, null>",
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

export function buildUserMessage(
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
      // ─── Critério de projeto (régua de elegibilidade) ───────────────────
      // Contrafactual: resposta determinística da Etapa 2 (quem sentiria falta — pessoas
      // ou times da Team Guide). Não barra a submissão, mas é sinal FORTE. null =
      // submissão anterior à feature → infira da documentação, não penalize. ⚠️ O "o que
      // piora" saiu do formulário (03/08/2026) e NÃO volta aqui: o efeito de desligar o
      // analisador extrai da doc/memorial. A RASTREABILIDADE vem do memorial (seção
      // "Ponteiro movido e onde verificar", escrita pelo agente), não daqui;
      // ponteiro_movido/ponteiro_evidencia são LEGADO (só existem em submissões da época
      // da pergunta no formulário).
      contrafactual_afetados: projeto.contrafactual_afetados ?? null,
      // ⚠️ Os LEGADO só entram quando REALMENTE preenchidos. Mandá-los sempre (como
      // `null`) fazia o analisador ler "ponteiro movido não preenchido" e rebaixar a
      // rastreabilidade de TODA submissão nova — nada escreve essas colunas desde
      // 03/08/2026, então o campo vazio era um sinal FALSO, não uma ausência de dado.
      // (caso real: "Bot de Faturamento V2", 05/08/2026 — zona cinzenta citando
      // literalmente "sem ponteiro movido preenchido", com o memorial preenchido.)
      ...(projeto.ponteiro_movido ? { ponteiro_movido: projeto.ponteiro_movido } : {}),
      ...(projeto.ponteiro_evidencia ? { ponteiro_evidencia: projeto.ponteiro_evidencia } : {}),
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
      // Itens NOMEADOS do custo evitado (mesma forma do custo_projeto_itens abaixo).
      // O total sozinho é um número solto; é o nome do contrato/serviço encerrado que
      // sustenta a RASTREABILIDADE pelo eixo custo (ver régua de critério, item 3).
      custo_evitado_itens: parseJson(projeto.custo_evitado_itens as string | null) ?? [],
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

// ─── Normalização determinística da complexidade (dois eixos) ────────────────

/**
 * Aplica as invariantes da matriz de complexidade (SPEC_COMPLEXIDADE_NIVEIS.md, §4.1)
 * sobre a sugestão do LLM. Dois eixos independentes:
 *   • Eixo IA (automacao ↔ inteligencia): a resposta EXPLÍCITA do usuário
 *     (tem_ia_como_funcionalidade) tem PRECEDÊNCIA sobre a inferência do LLM (usa_ia).
 *   • Eixo AÇÃO (→ autonomia): autonomia EXIGE ação consequente na última ponta
 *     (acao_autonoma) e SOBREPÕE o eixo IA — pode haver autonomia SEM IA (D1).
 *
 * Pura e determinística (testável). Só CORRIGE para o que é seguro:
 *   - rebaixa uma autonomia quando acao_autonoma é EXPLICITAMENTE false (freio
 *     anti-falso-autonomia do dashboard);
 *   - força automacao quando não há IA (preserva a régua do PR #94);
 *   - eleva automacao→inteligencia quando há IA.
 * NUNCA força-promove a autonomia (evitar o falso-positivo do dashboard) e NUNCA
 * rebaixa uma autonomia legítima por falta de IA (D1).
 */
export function normalizarComplexidade(input: {
  complexidade?: Complexidade | string | null;
  usa_ia?: boolean;
  acao_autonoma?: boolean | null;
  tem_ia_como_funcionalidade?: boolean | null;
}): { complexidade: Complexidade; usa_ia: boolean | undefined; ajuste: string | null } {
  const VALIDAS: Complexidade[] = ['automacao', 'inteligencia', 'autonomia'];
  let complexidade: Complexidade = VALIDAS.includes(input.complexidade as Complexidade)
    ? (input.complexidade as Complexidade)
    : 'automacao'; // fallback conservador
  let usa_ia = input.usa_ia;
  const { acao_autonoma, tem_ia_como_funcionalidade: temIa } = input;

  // IA EFETIVA: a resposta explícita do usuário vence a inferência do LLM; null → LLM.
  const iaEfetiva: boolean | undefined =
    temIa === true ? true : temIa === false ? false : usa_ia;

  let ajuste: string | null = null;

  // ── Eixo AÇÃO (precedência sobre IA — D1) ──
  // Freio anti-falso-autonomia: sem ação consequente, autonomia é impossível. Só
  // rebaixa com sinal EXPLÍCITO false; null/undefined → confia no LLM. NÃO promove
  // a autonomia por sinal determinístico (evita o falso-positivo do dashboard).
  if (complexidade === 'autonomia' && acao_autonoma === false) {
    complexidade = iaEfetiva === true ? 'inteligencia' : 'automacao';
    ajuste = `autonomia rebaixada para '${complexidade}' (acao_autonoma=false)`;
  }

  // ── Eixo IA (só mexe em automacao ↔ inteligencia; NUNCA toca autonomia — D1) ──
  if (complexidade !== 'autonomia') {
    if (iaEfetiva === false && complexidade !== 'automacao') {
      complexidade = 'automacao';
      ajuste = `rebaixada para 'automacao' (sem IA como funcionalidade)`;
    } else if (iaEfetiva === true && complexidade === 'automacao') {
      complexidade = 'inteligencia';
      ajuste = `elevada para 'inteligencia' (IA como funcionalidade)`;
    }
  }

  // Reflete a IA efetiva no usa_ia retornado (a resposta do usuário vence).
  if (temIa === true) usa_ia = true;
  else if (temIa === false) usa_ia = false;

  return { complexidade, usa_ia, ajuste };
}

// ─── Normalização determinística da classificação de elegibilidade ───────────

/** Teto de materialidade (R$/mês) acima do qual a decisão é sempre humana. */
export const TETO_MATERIALIDADE_CLASSIFICACAO = 5000;

const CLASSIFICACOES_VALIDAS: ClassificacaoAvaliacao[] = ['claro_sim', 'claro_nao', 'zona_cinzenta'];

// Texto usado quando o LLM não devolve justificativa. A coluna "Classificação" NUNCA
// pode ficar sem texto (decisão D4) — e o rótulo já é prefixado na célula do Sheets,
// então o fallback não o repete.
const JUSTIFICATIVA_FALLBACK: Record<ClassificacaoAvaliacao, string> = {
  claro_sim:
    'O analisador não detalhou a justificativa desta classificação; nenhum impedimento de recorrência, contrafactual ou rastreabilidade foi apontado na análise.',
  claro_nao:
    'O analisador não detalhou a justificativa desta classificação; ver o motivo da reprovação registrado para este projeto.',
  zona_cinzenta:
    'O analisador não detalhou a justificativa desta classificação, então a submissão foi encaminhada para a triagem humana decidir sobre os critérios de recorrência, contrafactual e rastreabilidade.',
};

/**
 * Aplica as invariantes da régua de critério de projeto sobre a sugestão do LLM.
 * PURA e determinística (testável isolada) — espelho de `normalizarComplexidade`.
 *
 * Invariantes (todas rebaixam para 'zona_cinzenta', o desfecho conservador = decisão
 * humana; NUNCA promovem uma reprovação):
 *   1. `claro_nao` SEM motivo não-vazio → nunca se reprova sem explicar ao autor;
 *   2. projeto ESPECIAL → nunca reprova automático (a rota especial existe justamente
 *      para impacto real de difícil mensuração e não pode ser atropelada por esta régua);
 *   3. materialidade > R$ 5k/mês → decisão humana (mesma régua que já força em_validacao);
 *   4. valor ausente/inválido → fallback conservador.
 * E a justificativa é SEMPRE preenchida (fallback determinístico), porque a coluna
 * "Classificação" nunca pode ficar sem texto.
 *
 * ⚠️ Os guards 2 e 3 agem APENAS sobre `claro_nao` — um projeto claramente elegível não
 * é rebaixado por ser especial nem por valer muito (o gate de materialidade age no
 * STATUS, em analisarProjetoFn, não na régua de elegibilidade).
 */
export function normalizarClassificacao(input: {
  classificacao?: ClassificacaoAvaliacao | string | null;
  justificativa?: string | null;
  motivo?: string | null;
  especial?: boolean | null;
  materialidade?: number | null;
  tetoMaterialidade?: number;
}): {
  classificacao: ClassificacaoAvaliacao;
  justificativa: string;
  motivo: string | null;
  ajuste: string | null;
} {
  const bruto = (input.classificacao ?? '').toString().trim().toLowerCase();
  let classificacao: ClassificacaoAvaliacao = CLASSIFICACOES_VALIDAS.includes(
    bruto as ClassificacaoAvaliacao,
  )
    ? (bruto as ClassificacaoAvaliacao)
    : 'zona_cinzenta'; // fallback conservador (nunca reprova por engano)

  const motivoLimpo = (input.motivo ?? '').trim();
  const teto = input.tetoMaterialidade ?? TETO_MATERIALIDADE_CLASSIFICACAO;
  let ajuste: string | null = null;

  if (classificacao === 'claro_nao') {
    if (!motivoLimpo) {
      classificacao = 'zona_cinzenta';
      ajuste = "reprovação sem motivo → rebaixada para 'zona_cinzenta' (nunca reprova sem explicar)";
    } else if (input.especial) {
      classificacao = 'zona_cinzenta';
      ajuste = "projeto especial → 'zona_cinzenta' (especial nunca reprova automático)";
    } else if ((input.materialidade ?? 0) > teto) {
      classificacao = 'zona_cinzenta';
      ajuste = `materialidade acima de R$ ${teto}/mês → 'zona_cinzenta' (decisão humana)`;
    }
  }

  // O motivo só existe na reprovação — não vaza texto de reprovação para projeto aprovado.
  const motivo = classificacao === 'claro_nao' ? motivoLimpo : null;

  const justificativa = (input.justificativa ?? '').trim() || JUSTIFICATIVA_FALLBACK[classificacao];

  return { classificacao, justificativa, motivo, ajuste };
}

// ─── Precedência de status (interno × coluna Status do Sheets) ───────────────

export type StatusSheet = 'Pendente' | 'Reprovado' | 'Reenvio Pendente';

/**
 * Decide o status INTERNO (SQLite/dashboard) e o rótulo da coluna "Status" do Sheets a
 * partir da classificação de elegibilidade + os gates que já existiam. PURA.
 *
 * Precedência (de cima para baixo):
 *   1. `claro_nao`      → rejeitado / **"Reprovado"** — VENCE o veredito de pontuação e é a
 *      ÚNICA exceção à regra TEMPORÁRIA que grava "Pendente" para todo o resto (D1).
 *      (Combinações impossíveis — especial ou materialidade alta — já foram rebaixadas
 *      por normalizarClassificacao; a ordem aqui é defesa em profundidade.)
 *   2. projeto especial → em_validacao / "Pendente" (validação 100% humana);
 *   3. `zona_cinzenta`  → em_validacao / "Pendente";
 *   4. materialidade > teto → em_validacao / "Pendente";
 *   5. senão → o veredito do analisador (aprovado → "Pendente" pela regra TEMPORÁRIA;
 *      rejeitado → "Reenvio Pendente").
 */
export function decidirStatusSubmissao(input: {
  classificacao?: ClassificacaoAvaliacao | string | null;
  ehEspecial: boolean;
  materialidade: number;
  vereditoAprovado: boolean;
  tetoMaterialidade?: number;
}): { status: 'aprovado' | 'rejeitado' | 'em_validacao'; statusSheet: StatusSheet } {
  const teto = input.tetoMaterialidade ?? TETO_MATERIALIDADE_CLASSIFICACAO;
  const classificacao = (input.classificacao ?? '').toString().trim().toLowerCase();

  if (classificacao === 'claro_nao' && !input.ehEspecial) {
    return { status: 'rejeitado', statusSheet: 'Reprovado' };
  }
  if (input.ehEspecial) return { status: 'em_validacao', statusSheet: 'Pendente' };
  if (classificacao === 'zona_cinzenta') return { status: 'em_validacao', statusSheet: 'Pendente' };
  if (input.materialidade > teto) return { status: 'em_validacao', statusSheet: 'Pendente' };
  return input.vereditoAprovado
    ? { status: 'aprovado', statusSheet: 'Pendente' } // TEMPORÁRIO: aprovado vai "Pendente"
    : { status: 'rejeitado', statusSheet: 'Reenvio Pendente' };
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

  // Valida e normaliza a complexidade aplicando as invariantes dos dois eixos
  // (ação > IA — ver normalizarComplexidade e SPEC_COMPLEXIDADE_NIVEIS.md). A
  // resposta explícita do usuário (tem_ia_como_funcionalidade, lida do conteudo
  // persistido) tem precedência sobre o usa_ia inferido pelo LLM; a autonomia
  // exige acao_autonoma e sobrepõe o eixo de IA (pode ser autonomia sem IA — D1).
  const sugestaoLLM = resultado.complexidade;
  const norm = normalizarComplexidade({
    complexidade: resultado.complexidade,
    usa_ia: resultado.usa_ia,
    acao_autonoma: resultado.acao_autonoma,
    tem_ia_como_funcionalidade: (conteudo as Record<string, unknown>)
      .tem_ia_como_funcionalidade as boolean | null | undefined,
  });
  if (norm.ajuste) log(`Complexidade normalizada: ${norm.ajuste} (LLM havia sugerido '${sugestaoLLM}')`);
  resultado.complexidade = norm.complexidade;
  resultado.usa_ia = norm.usa_ia;

  // Normaliza a classificação de elegibilidade ("isto é projeto?") aplicando as
  // invariantes da régua: nunca reprova sem motivo, especial nunca reprova automático,
  // materialidade alta vira decisão humana e a justificativa NUNCA fica vazia.
  const savingConteudo = conteudo.saving as Record<string, unknown> | undefined;
  const receitaConteudo = conteudo.receita as Record<string, unknown> | undefined;
  const materialidade =
    ((savingConteudo?.economia_reais_mes as number) ?? 0) +
    ((receitaConteudo?.valor_ganho_mensal as number) ?? 0);
  const classif = normalizarClassificacao({
    classificacao: resultado.classificacao_avaliacao,
    justificativa: resultado.classificacao_justificativa,
    motivo: resultado.motivo_reprovacao,
    especial: projeto.especial === 1,
    materialidade,
  });
  if (classif.ajuste) {
    log(
      `Classificação normalizada: ${classif.ajuste} (LLM havia sugerido '${resultado.classificacao_avaliacao}')`,
    );
  }
  resultado.classificacao_avaliacao = classif.classificacao;
  resultado.classificacao_justificativa = classif.justificativa;
  resultado.motivo_reprovacao = classif.motivo;

  // O LLM avalia todos os critérios internamente mas retorna só os mais relevantes.
  // Usamos pontuacao_total e pontuacao_maxima calculados pelo LLM (que viu todos).
  // Validação básica: garante que os valores existem.
  if (typeof resultado.pontuacao_total !== 'number') resultado.pontuacao_total = 0;
  if (typeof resultado.pontuacao_maxima !== 'number') resultado.pontuacao_maxima = 1;

  log(`Análise concluída: ${resultado.resultado} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade}, classificacao=${resultado.classificacao_avaliacao})`);

  return resultado;
}
