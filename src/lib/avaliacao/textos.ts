// Os TRÊS textos prontos da avaliação (T17). Módulo PURO. O time produz julgamento; quem fala com
// gente é este módulo, em 3 públicos com réguas diferentes:
//  1. justificativa INTERNA (triagem/admin): auditável, pode ter R$;
//  2. texto AO AUTOR: só no ajuste; sem R$ (valor/hora por cargo é escondido do submissor), sem a
//     máquina (agente/LLM/cético/cérebro/consenso), termina em "Para corrigir…" (régua de
//     `mensagens-submissao.ts`), curto;
//  3. dossiê DE COMITÊ (D16): resumo, nota do time, gatilhos de escape com evidência, pares em 6–10
//     lado a lado e a frase "O time lê … acima/abaixo/no nível de …". Pode ter R$.
// Nenhum texto tem travessão (fonte única `semTravessao`).
import { semTravessao } from '@/lib/mesa-parecer';
import type { Consenso } from '@/lib/avaliacao/consenso';
import type { SaidaMerito } from '@/lib/avaliacao/cerebro-merito';
import type { SaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';

/** FONTE ÚNICA da sanitização de R$: "R$ 1.234,56", "R$1234" e "147,40/hora" viram "[valor]". */
export function ocultarValoresMonetarios(texto: string): string {
  return texto
    .replace(/R\$\s?[\d.]+(?:,\d+)?(?:\s*\/\s*hora)?/gi, '[valor]')
    .replace(/\b\d{1,3}(?:\.\d{3})*(?:,\d{2})\s*\/\s*hora\b/gi, '[valor]')
    .replace(/R\$/g, '[valor]');
}

export type ParComite = { nome: string; nota: number; resumo: string };

const ROTULO_SAIDA: Record<Consenso['saida'], string> = {
  aprovar: 'Aprovar',
  ajuste: 'Pedir ajuste',
  humano: 'Encaminhar ao humano',
};
const ROTULO_CONFIANCA: Record<Consenso['confianca'], string> = { alta: 'alta', media: 'média', baixa: 'baixa' };

export function estrelasPorExtenso(n: number): string {
  if (n <= 0) return 'sem estrela';
  return n === 1 ? '1 estrela' : `${n} estrelas`;
}

function limpo(s: string | null | undefined): string {
  return semTravessao(s ?? '').trim();
}

function linhas(...ls: (string | null | undefined | false)[]): string {
  return ls.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).join('\n');
}

export function textoJustificativaInterna(args: {
  projeto: { id: string; nome: string };
  consenso: Consenso;
  merito: SaidaMerito;
  estrela: SaidaEstrela;
}): string {
  const { projeto, consenso: c, merito: a, estrela: b } = args;
  const valor = c.valor ?? a.valor;
  return linhas(
    `Justificativa interna: ${limpo(projeto.nome)} (id ${projeto.id})`,
    `Saída do time: ${ROTULO_SAIDA[c.saida]}. Mérito: ${a.veredito}. Estrela: ${estrelasPorExtenso(c.estrela)}${c.escape ? ' com indicação de escape 6 a 10' : ''}. Confiança ${ROTULO_CONFIANCA[c.confianca]}.`,
    `Critério aplicado: ${limpo(b.criterio_aplicado)}${b.desqualificador ? ` (desqualificador ${b.desqualificador})` : ''}.`,
    b.evidencias.length ? `Evidências da estrela:\n${b.evidencias.map((e) => `- ${limpo(e)}`).join('\n')}` : 'Evidências da estrela: nenhuma citada.',
    `Racional da estrela: ${limpo(b.racional)}`,
    b.promocao.aplicada ? `Promoção aplicada pelo dependente nomeado: ${limpo(b.promocao.dependente)}.` : null,
    b.ancora_congelada ? 'Projeto é âncora congelada (nota humana alta); a estrela do time é só registro.' : null,
    a.julgamentos.length
      ? `Julgamentos do mérito:\n${a.julgamentos
          .map((j) =>
            j.fallback
              ? `- ${j.dimensao}: sem resposta do agente.`
              : `- ${j.dimensao}${j.preocupa ? ' (preocupa)' : ''}: ${limpo(j.argumento)}${j.evidencias.length ? ` Evidências: ${j.evidencias.map(limpo).join('; ')}.` : ''}`,
          )
          .join('\n')}`
      : 'Julgamentos do mérito: nenhum.',
    a.ressalvas.length ? `Ressalvas:\n${a.ressalvas.map((r) => `- ${limpo(r)}`).join('\n')}` : null,
    c.divergencias.length ? `Divergências:\n${c.divergencias.map((d) => `- ${limpo(d)}`).join('\n')}` : 'Divergências: nenhuma.',
    c.motivos.length ? `Motivos:\n${c.motivos.map((m) => `- ${limpo(m)}`).join('\n')}` : null,
    valor
      ? `Auditoria de valor: ${valor.absurdo ? 'valor declarado ABSURDO' : 'valor declarado plausível'}. Valor sugerido: ${valor.valor_sugerido === null ? 'não sugerido' : `R$ ${valor.valor_sugerido.toLocaleString('pt-BR')}`}. ${limpo(valor.justificativa)}`
      : 'Auditoria de valor: não realizada.',
    c.perguntas_ao_autor.length ? `Perguntas ao autor:\n${c.perguntas_ao_autor.map((p) => `- ${limpo(p)}`).join('\n')}` : null,
    c.contestacao ? `Contestação registrada para o comitê: ${limpo(JSON.stringify(c.contestacao))}` : null,
  );
}

const AUTOR_MAX = 1200;

function paraAutor(s: string): string {
  return ocultarValoresMonetarios(limpo(s)).replace(/\s+/g, ' ').trim();
}

export function textoAoAutor(args: { projeto: { nome: string }; consenso: Consenso; merito: SaidaMerito }): string | null {
  const { projeto, consenso: c, merito: a } = args;
  if (c.saida !== 'ajuste') return null;
  const itens = (c.perguntas_ao_autor.length ? c.perguntas_ao_autor : a.perguntas_ao_autor.length ? a.perguntas_ao_autor : c.motivos)
    .map(paraAutor)
    .filter(Boolean);
  const cabeca = `Seu projeto ${paraAutor(projeto.nome)} está em validação e precisa de um ajuste antes de seguir.`;
  const meio = itens.length ? `O que precisamos entender:\n${itens.map((i) => `- ${i}`).join('\n')}` : 'Precisamos de mais detalhe no memorial para confirmar o ganho declarado.';
  const fim = 'Para corrigir: abra o projeto em Meus Projetos, responda aos pontos acima na descrição ou no memorial, anexe a evidência quando houver e reenvie para a triagem.';
  let texto = `${cabeca}\n\n${meio}\n\n${fim}`;
  if (texto.length > AUTOR_MAX) {
    const sobra = texto.length - AUTOR_MAX;
    const cortados = itens.map((i) => (i.length > 160 ? `${i.slice(0, 159)}…` : i));
    texto = `${cabeca}\n\n${`O que precisamos entender:\n${cortados.map((i) => `- ${i}`).join('\n')}`}\n\n${fim}`;
    if (texto.length > AUTOR_MAX) {
      const poucos = cortados.slice(0, Math.max(1, cortados.length - Math.ceil(sobra / 160)));
      texto = `${cabeca}\n\n${`O que precisamos entender:\n${poucos.map((i) => `- ${i}`).join('\n')}`}\n\n${fim}`;
    }
  }
  return texto;
}

export function dossieDeComite(args: {
  projeto: { id: string; nome: string };
  consenso: Consenso;
  merito: SaidaMerito;
  estrela: SaidaEstrela;
  pares: ParComite[];
  resumoProjeto: string;
}): string {
  const { projeto, consenso: c, merito: a, estrela: b, resumoProjeto } = args;
  const pares = [...args.pares].sort((x, y) => y.nota - x.nota);
  const gatilhos = Object.entries(b.escape.evidencias ?? {}).filter(([, v]) => typeof v === 'string' && v.trim());

  let comparacao: string;
  if (!pares.length) {
    comparacao = 'Sem par na faixa para comparar: nenhum projeto já notado foi encontrado como referência.';
  } else {
    const iguais = pares.filter((p) => p.nota === c.estrela);
    const acima = pares.filter((p) => p.nota > c.estrela).sort((x, y) => x.nota - y.nota)[0];
    const abaixo = pares.filter((p) => p.nota < c.estrela).sort((x, y) => y.nota - x.nota)[0];
    const partes: string[] = [];
    if (iguais.length) partes.push(`no nível de ${iguais[0].nome} (${estrelasPorExtenso(iguais[0].nota)})`);
    if (acima) partes.push(`abaixo de ${acima.nome} (${estrelasPorExtenso(acima.nota)})`);
    if (abaixo) partes.push(`acima de ${abaixo.nome} (${estrelasPorExtenso(abaixo.nota)})`);
    comparacao = `O time lê o projeto ${partes.join(', ')} porque ${limpo(b.racional) || 'o critério aplicado foi ' + limpo(b.criterio_aplicado)}`;
    if (!/[.!?]$/.test(comparacao)) comparacao += '.';
  }

  return linhas(
    `Dossiê de comitê: ${limpo(projeto.nome)} (id ${projeto.id})`,
    '',
    `Resumo: ${limpo(resumoProjeto)}`,
    '',
    `Nota do time: ${estrelasPorExtenso(c.estrela)} (${limpo(b.criterio_aplicado)}). Mérito: ${a.veredito}. Confiança ${ROTULO_CONFIANCA[c.confianca]}.`,
    c.escape ? 'Indicação de escape para a faixa 6 a 10: os dois gatilhos foram citados; o comitê define o número por comparação.' : null,
    gatilhos.length ? `Gatilhos de escape e evidências:\n${gatilhos.map(([k, v]) => `- ${k}: ${limpo(v)}`).join('\n')}` : null,
    b.evidencias.length ? `Evidências do critério:\n${b.evidencias.map((e) => `- ${limpo(e)}`).join('\n')}` : null,
    '',
    pares.length ? `Pares já notados (referência):\n${pares.map((p) => `- ${limpo(p.nome)} (${estrelasPorExtenso(p.nota)}): ${limpo(p.resumo)}`).join('\n')}` : null,
    comparacao,
    '',
    c.divergencias.length ? `Divergências:\n${c.divergencias.map((d) => `- ${limpo(d)}`).join('\n')}` : 'Divergências: nenhuma.',
    c.motivos.length ? `Motivo do encaminhamento:\n${c.motivos.map((m) => `- ${limpo(m)}`).join('\n')}` : null,
    a.preocupacoes.length ? `Preocupações do mérito: ${a.preocupacoes.join(', ')}.` : null,
    c.contestacao ? `Contestação: ${limpo(JSON.stringify(c.contestacao))}` : null,
  );
}
