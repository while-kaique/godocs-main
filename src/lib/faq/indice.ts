/**
 * O ÍNDICE do FAQ — slug, título e resumo de cada assunto, sem o corpo.
 *
 * ## Por que é um módulo separado
 * A home pinta a lista de assuntos, e ela precisa aparecer **junto com o resto da página**.
 * Buscar isso da API custa ~750 ms de overhead FIXO do edge, mais o cold start do worker: o
 * bloco entrava com atraso VARIÁVEL, que é pior que atraso constante — a pessoa não aprende a
 * esperar e a página pula embaixo dela.
 *
 * A resposta certa é o dado já estar no bundle. Mas o `conteudo.ts` carrega os documentos
 * INTEIROS em markdown (~9 KB), e a home usa 6 títulos (~600 bytes) — arrastar tudo para a
 * página de entrada, que todo mundo carrega, seria trocar um problema por outro.
 *
 * Então o índice mora aqui e o `FAQ_SEED` o COMPÕE com os corpos. Fonte única continua sendo
 * uma: mudar um título aqui muda nos dois lugares.
 *
 * ⚠️ Isto é o estado INICIAL, não a verdade. O admin edita o FAQ pelo painel, então a home
 * pinta daqui na hora e **corrige com a resposta da API** quando ela chega. Um título recém
 * editado aparece antigo por menos de um segundo; um assunto recém arquivado some no mesmo
 * instante. Era isso ou não mostrar nada por um segundo, e nada é pior.
 */

export type FaqAssunto = { slug: string; titulo: string; resumo: string };

export const FAQ_INDICE: FaqAssunto[] = [
  {
    slug: 'tipos_projetos',
    titulo: 'Tipos de Projeto',
    resumo:
      'O que o GoDocs entende por saving operacional, receita incremental e projeto especial, e como escolher na Etapa 2.',
  },
  {
    slug: 'acompanhamento',
    titulo: 'Acompanhamento e status',
    resumo:
      'O que cada status do seu projeto significa, quem age em cada um e o que você precisa fazer.',
  },
];
