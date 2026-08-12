/**
 * FAQ — conteúdo inicial e resolução de slug. Módulo **PURO** (sem import de servidor):
 * roda no worker (seed) e no cliente (resolver a rota `/faq/$categoria`).
 *
 * FONTE ÚNICA do texto que entra no ar (`FAQ_SEED`). O seed é **idempotente por slug**:
 * slug ausente → INSERT; slug presente → não toca em título, resumo nem ordem. A única
 * exceção é o **backfill** do `corpo`: categoria que existe com corpo VAZIO recebe o texto
 * do código (é o que faz a coluna nova nascer preenchida em banco que já tinha a categoria).
 * Corpo com texto NUNCA é sobrescrito.
 *
 * ⚠️ Consequência a não esquecer: depois do 1º deploy, editar o texto AQUI não muda o que
 * está em produção — a partir daí o dono do conteúdo é o painel admin. Reimpor o texto do
 * código seria uma decisão nova (rota explícita), nunca efeito colateral do seed.
 * Ver spec-docs/SPEC_FAQ.md (D1, D13).
 */

import { chaveColuna } from '@/lib/coluna-chave';

/**
 * Uma categoria = UM documento. Não há mais nível de "tópico": a parte interna do FAQ é um
 * texto único com títulos e explicações (D13). A tabela `faq_itens` sobrou como LEGADO no
 * schema e não alimenta mais nenhuma tela.
 */
export type FaqCategoria = {
  id: string;
  slug: string;
  titulo: string;
  resumo: string | null;
  /** Markdown leve — ver `src/lib/faq/markdown.ts` para a marcação aceita. */
  corpo: string | null;
  ordem: number;
  arquivado: boolean;
  /** Carimbo da última escrita — vira o "Atualizado em …" no pé do documento (D15). */
  atualizado_em: string | null;
  /** E-mail de quem salvou, ou `seed` quando o texto nasceu com o deploy. */
  atualizado_por: string | null;
  /**
   * A versão imediatamente anterior, para o botão "Voltar" do admin (D14). **1 nível
   * só** — restaurar consome o slot, isto não é histórico. Só vai no payload de admin.
   */
  versao_anterior: FaqVersaoAnterior | null;
};

/** Snapshot do que é editável, com quando/quem — o que o modal de confirmação mostra. */
export type FaqVersaoAnterior = {
  titulo: string;
  resumo: string | null;
  corpo: string | null;
  em: string | null;
  por: string | null;
};

/** O que o seed precisa declarar (sem id/ordem/arquivado — quem grava resolve). */
export type FaqCategoriaSeed = Pick<FaqCategoria, 'slug' | 'titulo' | 'resumo' | 'corpo'>;

/**
 * Chave de comparação de slug: minúsculas, SEM ACENTO, `-`/`_`/espaço colapsados em `_`.
 *
 * ⚠️ Existe pelo mesmo motivo do `chaveColuna` (Sheets): o slug viaja em link colado à
 * mão, em mensagem de Chat e em e-mail. `/faq/tipos-projetos`, `/faq/Tipos_Projetos` e
 * `/faq/tipos projetos` têm de abrir a MESMA página — um 404 aqui é um link morto para
 * quem só queria ler a resposta.
 */
export function chaveSlug(valor: string): string {
  // O "sem acento + minúsculas" vem do `chaveColuna` (módulo PURO, já usado pelo Sheets e
  // pela ficha de triagem) — não redigitamos o range de marcas combinantes aqui.
  return chaveColuna(valor)
    .replace(/[^a-z0-9]+/g, '_') // qualquer separador (espaço, -, /, .) vira _
    .replace(/^_+|_+$/g, '');
}

/** Deriva um slug a partir de um título digitado no painel (fallback quando não vem slug). */
export function slugDeTitulo(titulo: string): string {
  return chaveSlug(titulo).slice(0, 60);
}

/**
 * Acha por slug: EXATO primeiro, normalizado depois — a mesma precedência da resolução de
 * coluna do Sheets. Chave AMBÍGUA (2 slugs que normalizam igual) não decide pelo
 * tolerante: só o exato resolve, para nunca abrir o documento errado.
 */
export function resolverCategoria(
  arvore: FaqCategoria[],
  slug: string | undefined,
): FaqCategoria | undefined {
  if (!slug) return undefined;
  const exato = arvore.find((c) => c.slug === slug);
  if (exato) return exato;
  const alvo = chaveSlug(slug);
  const casam = arvore.filter((c) => chaveSlug(c.slug) === alvo);
  return casam.length === 1 ? casam[0] : undefined;
}

/* ───────────────────────── conteúdo semeado ───────────────────────── */

const DOC_TIPOS = `## Saving operacional

A automação passou a fazer o que uma pessoa fazia à mão, ou eliminou um gasto que a empresa pagava. São duas moedas: **horas humanas** que deixaram de ser gastas e **dinheiro que parou de sair**.

As horas são coletadas por cargo — quanto a rotina consumia antes, quanto consome hoje. Três coisas que a conversa cobra:

- O total de cada cargo **quebrado por atividade**. Número solto não passa.
- Teto de **220h por mês por pessoa** (22 dias úteis). Acima disso é mais de uma pessoa, e o número de pessoas entra na conta.
- A partir de **44h/mês** economizadas, para onde foi o tempo liberado.

Contrato encerrado, licença cancelada e serviço que deixou de ser contratado somam ao ganho. O que a solução consome para rodar — API, SaaS por uso, crédito de LLM — subtrai.

> O mesmo trabalho não conta duas vezes. Se o contrato pagava exatamente aquelas horas, declare só o contrato.

## Receita incremental

Receita que passou a entrar por causa da automação, com uma base de cálculo que outra pessoa consiga conferir sozinha.

A conversa pede o mecanismo (mais contatos atendidos, carrinho recuperado, cobrança que não era feita), o antes × depois na mesma unidade, de onde saiu o número e onde ele é conferido.

> Dinheiro que voltou não é receita nova. Ressarcimento, multa que parou de ser paga e cobrança corrigida são economia — vão em custo evitado, não aqui.

## Projeto especial

Projeto de altíssimo impacto cujo ganho não vira um número em reais que se sustente. A palavra é **atribuível**: o efeito existe, é grande e é visível, mas não há antes × depois em R$ que se defenda sem inventar premissa.

Cabem aqui engajamento nas redes, ganho de qualidade do produto e uma base de conhecimento reorganizada que não economiza uma hora e viabiliza dezenas de automações depois. Internamente, Piapp e Agente Autônomo de Comentários são as referências.

Não cabem três coisas: projeto com ganho mensurável que ninguém mediu ainda (o caminho é levantar o número), projeto que ainda não está rodando, e projeto pequeno que só dá trabalho de calcular.

Marcando **Sim**, você pula as etapas financeiras e o analisador automático, não entra na fila do seu líder e vai direto para a validação humana da equipe de RPA & IA. Continuam obrigatórios a documentação técnica e o campo **Contexto do Projeto Especial**, onde você escreve qual é o impacto, por que ele não vira R$ e o que o projeto destrava.

## O ganho tem de ser real e medido

O GoDocs documenta o que já aconteceu. "Vamos economizar", "a expectativa é" e "quando estiver rodando em todas as lojas" são projeção, não ganho — e não entram, nem como especial. Volte quando o número existir e for medido em algum lugar.

## Na dúvida, escolha "Não"

Se você acha que existe um número e só não sabe como chegar nele, siga como projeto padrão: o agente conduz a coleta. Marcar especial para fugir da conta atrasa o seu projeto, porque a avaliação humana é mais lenta que a automática.`;

const DOC_ACOMPANHAMENTO = `## Pendente

O projeto chegou e está na fila. Duas coisas podem correr em paralelo, e nenhuma depende de você: a **pré-aprovação do seu líder direto**, quando ela se aplica, e a **validação da equipe de RPA & IA**.

Quem tem cargo de coordenação para cima, e todo projeto especial, vai direto para a validação da equipe — sem fila de líder.

## Aprovado

A documentação e o memorial foram validados. O projeto está registrado com o ganho que você documentou.

## Reenvio pendente

A triagem pediu ajuste, e o motivo está no card do projeto, em "Ver o que ajustar".

Abra em **Editar**, corrija o que foi apontado e reenvie — a edição já vem preenchida com tudo, inclusive a conversa com o agente e o memorial. Reenviar reabre a pré-aprovação do líder, porque o parecer anterior foi dado sobre a versão antiga.

## Reprovado

O projeto não passou no critério e o motivo aparece junto do veredito. Antes de reenviar, converse com a equipe de RPA & IA.

## A automação parou de rodar

Marque o projeto como **Descontinuado** em "Meus Projetos". Nada é apagado: o histórico fica e o app para de cobrar regularização. Se ela voltar a rodar, reative — ou edite e reenvie, o que reativa sozinho.`;

export const FAQ_SEED: FaqCategoriaSeed[] = [
  {
    slug: 'tipos_projetos',
    titulo: 'Tipos de Projeto',
    resumo:
      'O que o GoDocs entende por saving operacional, receita incremental e projeto especial — e como escolher na Etapa 2.',
    corpo: DOC_TIPOS,
  },
  {
    slug: 'acompanhamento',
    titulo: 'Acompanhamento e status',
    resumo:
      'O que cada status do seu projeto significa, quem age em cada um e o que você precisa fazer.',
    corpo: DOC_ACOMPANHAMENTO,
  },
];
