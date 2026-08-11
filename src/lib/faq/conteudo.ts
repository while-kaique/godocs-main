/**
 * FAQ — conteúdo inicial e resolução de slug. Módulo **PURO** (sem import de servidor):
 * roda no worker (seed) e no cliente (resolver a rota `/faq/$categoria/$item`).
 *
 * FONTE ÚNICA do texto que entra no ar (`FAQ_SEED`). O seed é **idempotente por slug**:
 * slug ausente → INSERT; slug presente → não toca em NADA (nem título, nem corpo, nem
 * ordem). ⚠️ Consequência a não esquecer: depois do 1º deploy, editar o texto AQUI não
 * muda o que está em produção — a partir daí o dono do conteúdo é o painel admin. Reimpor
 * o texto do código seria uma decisão nova (rota explícita), nunca efeito colateral do
 * seed. Ver spec-docs/SPEC_FAQ.md (D1).
 */

import { chaveColuna } from '@/lib/coluna-chave';

export type FaqItem = {
  id: string;
  slug: string;
  titulo: string;
  resumo: string | null;
  corpo: string | null;
  ordem: number;
  arquivado: boolean;
};

export type FaqCategoria = {
  id: string;
  slug: string;
  titulo: string;
  resumo: string | null;
  ordem: number;
  arquivado: boolean;
  itens: FaqItem[];
};

/** O que o seed precisa declarar (sem id/arquivado — quem grava resolve). */
export type FaqItemSeed = Pick<FaqItem, 'slug' | 'titulo' | 'resumo' | 'corpo'>;
export type FaqCategoriaSeed = Pick<FaqCategoria, 'slug' | 'titulo' | 'resumo'> & {
  itens: FaqItemSeed[];
};

/**
 * Chave de comparação de slug: minúsculas, SEM ACENTO, `-`/`_`/espaço colapsados em `_`.
 *
 * ⚠️ Existe pelo mesmo motivo do `chaveColuna` (Sheets): o slug viaja em link colado à
 * mão, em mensagem de Chat e em e-mail. `/faq/tipos-projetos/especiais`,
 * `/faq/Tipos_Projetos/Especiais` e `/faq/tipos projetos/especiais` têm de abrir a MESMA
 * página — um 404 aqui é um link morto para quem só queria ler a resposta.
 */
export function chaveSlug(valor: string): string {
  // O "sem acento + minúsculas" vem do `chaveColuna` (módulo PURO, já usado pelo Sheets e
  // pela ficha de triagem) — não redigitamos o range de marcas combinantes aqui.
  return chaveColuna(valor)
    .replace(/[^a-z0-9]+/g, '_') // qualquer separador (espaço, -, /, .) vira _
    .replace(/^_+|_+$/g, '');
}

/** Deriva um slug a partir de um título digitado no painel (Fallback quando não vem slug). */
export function slugDeTitulo(titulo: string): string {
  return chaveSlug(titulo).slice(0, 60);
}

/**
 * Acha por slug: EXATO primeiro, normalizado depois — a mesma precedência da resolução de
 * coluna do Sheets. Chave AMBÍGUA (2 slugs que normalizam igual) não decide pelo
 * tolerante: só o exato resolve, para nunca abrir o tópico errado.
 */
function acharPorSlug<T extends { slug: string }>(itens: T[], slug: string): T | undefined {
  const exato = itens.find((i) => i.slug === slug);
  if (exato) return exato;
  const alvo = chaveSlug(slug);
  const casam = itens.filter((i) => chaveSlug(i.slug) === alvo);
  return casam.length === 1 ? casam[0] : undefined;
}

export function resolverCategoria(
  arvore: FaqCategoria[],
  slug: string | undefined,
): FaqCategoria | undefined {
  if (!slug) return undefined;
  return acharPorSlug(arvore, slug);
}

export function resolverItem(
  categoria: FaqCategoria | undefined,
  slug: string | undefined,
): FaqItem | undefined {
  if (!categoria || !slug) return undefined;
  return acharPorSlug(categoria.itens, slug);
}

/* ───────────────────────── conteúdo semeado ───────────────────────── */

const CORPO_ESPECIAL = `Um projeto especial é um projeto de altíssimo impacto para a empresa cujo ganho não se traduz, hoje, em um número em reais que se sustente — nem como saving operacional (horas humanas ou custos que deixaram de existir), nem como receita incremental atribuível.

A palavra que importa é "atribuível". Não é "eu não calculei", nem "dá trabalho levantar": é que o efeito do projeto existe, é grande e é visível, mas não há um antes × depois em R$ que consiga ser defendido sem inventar premissa. Exemplos do tipo de coisa que cai aqui: um projeto que gera muito engajamento nas redes; um projeto que aumenta vendas sem que se consiga separar o que veio dele; um projeto que melhora a qualidade do produto ou da entrega; uma reestruturação da base de conhecimento da empresa que, por si só, não economiza uma hora, mas viabiliza dezenas de automações depois. Na prática interna, o Piapp e o Agente Autônomo de Comentários são os dois exemplos que a equipe usa como referência.

O que NÃO é projeto especial

• Projeto com ganho mensurável que ninguém mediu ainda. Se existe contrato encerrado, nota que parou de ser paga, horas de gente que deixaram de ser gastas ou um indicador que se move e é conferível, o projeto é de saving ou de receita — e o caminho é levantar o número, não marcar especial.

• Projeto que ainda não está rodando. O GoDocs documenta ganho já realizado: se a automação não está em produção, ou se o ganho é uma projeção para o próximo trimestre, o projeto não entra — nem como especial. Volte quando estiver rodando e medido.

• Projeto pequeno que só é difícil de medir. "Especial" é sobre impacto alto o suficiente para valer uma avaliação humana dedicada, não sobre a dificuldade da conta.

O que muda na sua submissão quando você marca "Sim"

1. Você pula as etapas financeiras: não há memorial de saving nem de receita, e o agente não vai pedir horas por cargo, frequência ou base de cálculo.

2. Você pula o analisador automático: nenhuma classificação de complexidade ou de elegibilidade é gerada para o projeto.

3. A validação passa a ser humana e rigorosa. Alguém da equipe de RPA & IA entra em contato com você para entender e decidir. Não há aprovação automática.

4. O projeto não entra na fila de pré-aprovação do seu líder — sem memorial financeiro, não há o que ele avaliar; vai direto para a validação da equipe de RPA & IA.

O que continua sendo obrigatório

A documentação técnica completa (o que o projeto faz, como roda, dependências, o que observar) e o campo "Contexto do Projeto Especial". Nesse campo, escreva três coisas: (a) qual é o impacto, em termos concretos e verificáveis por outra pessoa; (b) por que ele não se converte em saving ou receita sem inventar premissa; (c) o que esse projeto destrava — o que passou a ser possível por causa dele. Quanto mais concreto, menos idas e voltas na validação.

Na dúvida, escolha "Não"

Se você acha que existe um número e só não sabe como chegar nele, siga como projeto padrão: o agente conduz a coleta e, se no meio do caminho ficar claro que não há ganho mensurável, isso aparece na validação. Marcar especial para evitar a conta atrasa o seu projeto, porque a avaliação humana é mais lenta que a automática.`;

const CORPO_SAVING = `Saving operacional é a economia que a automação gerou de verdade, medida em duas moedas: horas humanas que deixaram de ser gastas e custos externos que deixaram de ser pagos.

Horas humanas

O agente coleta, por cargo, quanto tempo a rotina consumia antes e quanto consome depois. A diferença é o saving de horas. Três coisas que a coleta cobra e vale saber de antemão:

• A composição das horas. O total de um cargo não pode ser um número solto: ele é quebrado por atividade, e as partes somam o total (ex.: "160h = conferência 4h + lançamento 10h + tratamento de erro 146h").

• O teto por pessoa. A base é o tempo útil de trabalho — 22 dias, cerca de 220h/mês por pessoa. Um total maior que isso significa mais de uma pessoa (ou mais de uma loja/unidade), e o número de pessoas entra explicitamente na conta.

• Quando a economia é grande (44h/mês ou mais, no total ou em um cargo), o formulário pede o que mudou na prática depois da automação: para onde foi o tempo liberado — mais entrega, menos custo, menos erro e retrabalho, menos risco e fraude, ou menos prazo.

Custos externos que pararam de ser pagos (custo evitado)

Contrato de terceirizada encerrado, licença cancelada, serviço que deixou de ser contratado por causa da automação. Isso soma ao ganho, e é declarado no formulário com nome, valor e desde quando parou.

⚠️ Atenção à dupla contagem: se o contrato pagava exatamente por aquelas horas, conta só o custo do contrato, não as horas também. É o mesmo trabalho aparecendo em duas moedas.

O que subtrai: o custo do projeto

O que a solução interna consome para rodar — chave de API, SaaS por uso, crédito de LLM — é declarado como custo do projeto e subtrai do ganho. Um projeto cujo custo de operação supera a economia das horas não passa: é isso que o cálculo verifica.

O ganho precisa ser real e medido

O GoDocs documenta o que já aconteceu. "Vamos economizar", "a expectativa é", "quando estiver rodando em todas as lojas" não são saving — são projeção. Se o número ainda não foi medido, o caminho é voltar quando ele existir.`;

const CORPO_RECEITA = `Receita incremental é o aumento de receita que a automação gerou, com uma base de cálculo que outra pessoa consiga conferir sem acreditar em você.

O que a coleta pede

• O que gera a receita: qual é o mecanismo concreto (mais contatos atendidos, recuperação de carrinho, reativação de cliente, cobrança que não era feita).

• Como ela aumenta: o que a automação faz que antes não acontecia.

• Antes × depois: o número anterior e o atual, na mesma unidade.

• A base do cálculo: de onde saiu o valor e onde ele é conferido (relatório, painel, sistema, base de dados).

• Se é recorrente (mensal, trimestral, semestral) ou pontual.

⚠️ Receita não é a mesma coisa que custo evitado

O mesmo dinheiro não pode ser declarado nos dois lugares. Ressarcimento recebido, multa que parou de ser paga e cobrança que passou a ser feita corretamente costumam ser economia, não receita nova. Quando os dois valores se parecem, o formulário pergunta — e a resposta precisa dizer o que distingue um do outro.

O ganho precisa ser real e medido

Conversão estimada, potencial de mercado e projeção para o próximo trimestre não entram, mesmo com a ressalva escrita no memorial. Se o número ainda não foi medido, o projeto volta quando ele existir — ou segue como projeto especial, se o impacto for alto e realmente não houver como atribuir valor.`;

export const FAQ_SEED: FaqCategoriaSeed[] = [
  {
    slug: 'tipos_projetos',
    titulo: 'Tipos de Projeto',
    resumo:
      'O que o GoDocs entende por saving operacional, receita incremental e projeto especial — e como escolher na Etapa 2.',
    itens: [
      {
        slug: 'especiais',
        titulo: 'Projeto Especial',
        resumo:
          'Altíssimo impacto, sem um número em reais que se sustente. O que é, o que não é, e o que muda na sua submissão.',
        corpo: CORPO_ESPECIAL,
      },
      {
        slug: 'saving',
        titulo: 'Saving Operacional',
        resumo:
          'Economia gerada pela automação: horas humanas que deixaram de ser gastas e custos externos que deixaram de ser pagos.',
        corpo: CORPO_SAVING,
      },
      {
        slug: 'receita',
        titulo: 'Receita Incremental',
        resumo:
          'Aumento de receita gerado pela automação, com base de cálculo que outra pessoa consiga conferir.',
        corpo: CORPO_RECEITA,
      },
    ],
  },
  {
    slug: 'acompanhamento',
    titulo: 'Acompanhamento e status',
    resumo:
      'O que cada status do seu projeto significa, quem age em cada um e o que você precisa fazer.',
    itens: [
      {
        slug: 'em-analise',
        titulo: 'Em análise',
        resumo: 'O projeto foi submetido e está na fila de validação. Não há nada a fazer agora.',
        corpo: `O projeto chegou e está na fila. A partir daqui podem acontecer duas coisas em paralelo, e nenhuma delas depende de você:

• A pré-aprovação do seu líder direto, quando ela se aplica. Ele recebe um aviso, abre o projeto e registra o parecer dentro do GoDocs. Quem tem cargo de coordenação para cima, e todo projeto especial, vai direto para a validação da equipe de RPA & IA.

• A validação da equipe de RPA & IA (a triagem), que confere a documentação e os números do memorial.

Enquanto isso, o projeto aparece em "Meus Projetos" como Pendente. Você pode editar e reenviar a qualquer momento — reenviar reabre a pré-aprovação, porque o parecer foi dado sobre a versão anterior.`,
      },
      {
        slug: 'aprovado',
        titulo: 'Aprovado',
        resumo: 'A documentação e o memorial foram validados. O projeto está registrado.',
        corpo: `A validação terminou e o projeto está registrado com o ganho que você documentou.

Se a automação parar de rodar depois disso, marque o projeto como Descontinuado em "Meus Projetos". Isso não apaga nada: preserva o histórico e para de cobrar de você a regularização. Se ela voltar a rodar, reative — ou edite e reenvie, o que reativa sozinho.`,
      },
      {
        slug: 'reenvio-pendente',
        titulo: 'Reenvio pendente',
        resumo: 'A triagem pediu ajuste. O motivo está no card do projeto — corrija e reenvie.',
        corpo: `Alguém da triagem olhou o projeto e pediu ajuste. O motivo aparece no card do projeto em "Meus Projetos" e na página do projeto — clique em "Ver o que ajustar".

O que fazer: abra o projeto em Editar, corrija o que foi apontado e reenvie. A edição já vem preenchida com tudo o que você enviou na primeira vez, incluindo a conversa com o agente e o memorial; você mexe só no que precisa mudar.

Reenviar reabre a pré-aprovação do líder, porque o parecer anterior foi dado sobre a versão antiga. Um projeto reprovado aparece com o veredito e o motivo: nesse caso, o caminho é conversar com a equipe de RPA & IA antes de reenviar.`,
      },
    ],
  },
];
