// Cérebro C — o CONSENSO (T16). Módulo PURO: concilia mérito (A) × estrela (B) e decide a saída.
//
// D13: aprovação autônoma é o alvo; humano é EXCEÇÃO (escape 6–10, divergência que o debate não
// fechou, confiança baixa). D14: raciocínio livre, fecho MEDIDO — quem autoriza a saída a agir sem
// humano é `politicaDeLiberacao`, lendo a acurácia MEDIDA no retroativo por tipo de veredito; a
// confiança do agente é voto, a do SISTEMA é histórico de acerto. D16: escape sempre humano, com
// dossiê de comitê. Fail-closed herdado do agregador da mesa: o consenso nunca fecha um desfecho
// negativo sozinho.
import { confiancaDe, type Confianca, type Contestacao } from '@/lib/estrelas-regua';
import type { SaidaMerito, AuditoriaValor } from '@/lib/avaliacao/cerebro-merito';
import type { SaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';

export type SaidaConsenso = 'aprovar' | 'ajuste' | 'humano';
export type MedicaoVeredito = { acerto: number; erro_grave: number; n: number };
export type AcuraciaMedida = { aprovar?: MedicaoVeredito; ajuste?: MedicaoVeredito };

/** Metas do §11.4 do plano (números propostos; o Luis fixa). */
export const METAS_LIBERACAO = {
  aprovar: { acerto_min: 0.9, erro_grave_max: 0, n_min: 300 },
  ajuste: { acerto_min: 0.85, n_min: 300 },
} as const;

export type Liberacao = { aprovar: boolean; ajuste: boolean; motivos: string[] };

export function politicaDeLiberacao(
  acuracia: AcuraciaMedida | null,
  flags: { liberarAprovar?: boolean; liberarAjuste?: boolean },
): Liberacao {
  const motivos: string[] = [];
  if (!acuracia) {
    return {
      aprovar: false,
      ajuste: false,
      motivos: ['Sem medição de acurácia: nenhum veredito age sozinho até o retroativo medir.'],
    };
  }
  const avalia = (
    chave: 'aprovar' | 'ajuste',
    m: MedicaoVeredito | undefined,
    flag: boolean | undefined,
  ): boolean => {
    if (!m) {
      motivos.push(`${chave}: não medido ainda, segue em sombra.`);
      return false;
    }
    const meta = METAS_LIBERACAO[chave];
    if (m.n < meta.n_min) {
      motivos.push(`${chave}: amostra de ${m.n} abaixo do mínimo de ${meta.n_min}.`);
      return false;
    }
    if (m.acerto < meta.acerto_min) {
      motivos.push(`${chave}: acerto de ${(m.acerto * 100).toFixed(1)}% abaixo da meta de ${meta.acerto_min * 100}%.`);
      return false;
    }
    if (chave === 'aprovar' && m.erro_grave > METAS_LIBERACAO.aprovar.erro_grave_max) {
      motivos.push(`aprovar: ${m.erro_grave} erro grave na amostra, a meta é zero.`);
      return false;
    }
    if (!flag) {
      motivos.push(`${chave}: meta batida, mas a flag de liberação está desligada.`);
      return false;
    }
    motivos.push(`${chave}: liberado (meta batida e flag ligada).`);
    return true;
  };
  const aprovar = avalia('aprovar', acuracia.aprovar, flags.liberarAprovar);
  const ajuste = avalia('ajuste', acuracia.ajuste, flags.liberarAjuste);
  return { aprovar, ajuste, motivos };
}

export type Consenso = {
  saida: SaidaConsenso;
  veredito_merito: 'aprovar' | 'ajuste' | 'humano';
  estrela: number;
  vale_estrela: boolean;
  escape: boolean;
  confianca: Confianca;
  divergencias: string[];
  motivos: string[];
  perguntas_ao_autor: string[];
  valor: AuditoriaValor | null;
  contestacao: Contestacao | null;
  age_sozinho: boolean;
};

const ROTULO_DESQ: Record<string, string> = {
  fora_de_uso: 'fora de uso (parado, descontinuado ou POC)',
  ressubmissao: 'ressubmissão do mesmo escopo já documentado (duplicado)',
};

function frase(s: string): string {
  const t = s.replace(/—|–/g, ',').replace(/ - /g, ', ').trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function conciliar(
  a: SaidaMerito,
  b: SaidaEstrela,
  ctx: { debateFechou: boolean; ceticoRefuta: boolean; liberacao: Liberacao },
): Consenso {
  const divergencias: string[] = [];
  const motivos: string[] = [];

  if (ctx.ceticoRefuta && a.veredito === 'aprovar') {
    divergencias.push(frase('O cético refuta a aprovação do mérito'));
  }
  if (a.veredito === 'aprovar' && b.nota === 0 && b.desqualificador && ROTULO_DESQ[b.desqualificador]) {
    divergencias.push(frase(`O mérito aprova, mas a estrela desqualifica o projeto por ${ROTULO_DESQ[b.desqualificador]}`));
  }

  const confianca = confiancaDe({
    cerebrosConcordam: divergencias.length === 0,
    temEvidenciaCitada: a.sinais.temEvidenciaCitada && b.sinais.temEvidenciaCitada,
    temVizinhos: a.sinais.temVizinhos || b.sinais.temVizinhos,
  });
  const escape = b.escape.indicado && b.escape.valido;

  let saida: SaidaConsenso;
  if (escape) {
    saida = 'humano';
    motivos.push(frase('Escape 6 a 10 indicado com os dois gatilhos citados: a posição na faixa é do comitê humano'));
  } else if (a.veredito === 'humano') {
    saida = 'humano';
    motivos.push(frase('O mérito não conseguiu fechar e pede olhar humano'));
  } else if (!ctx.debateFechou) {
    saida = 'humano';
    motivos.push(frase('O debate entre os especialistas não fechou em duas rodadas'));
  } else if (divergencias.length && a.veredito === 'aprovar') {
    saida = 'humano';
    motivos.push(frase('Mérito e estrela divergem sobre aprovar: vai ao humano'));
  } else if (confianca === 'baixa') {
    saida = 'humano';
    motivos.push(frase('Confiança baixa (falta evidência citada e vizinhos): o consenso não fecha na dúvida'));
  } else if (a.veredito === 'ajuste') {
    saida = 'ajuste';
    motivos.push(frase(`O mérito pede ajuste ao autor com ${a.perguntas_ao_autor.length} pergunta(s)`));
  } else {
    saida = 'aprovar';
    motivos.push(frase(`Mérito aprova e estrela ${b.nota} (${b.criterio_aplicado}) com confiança ${confianca}`));
  }

  if (b.ancora_congelada) {
    motivos.push(frase('O projeto é âncora congelada com nota humana; a estrela do time fica só como registro e contestação'));
  }
  if (saida !== 'humano' && confianca !== 'alta') {
    motivos.push(frase(`Confiança ${confianca}: ${a.sinais.temEvidenciaCitada && b.sinais.temEvidenciaCitada ? 'com' : 'sem'} evidência citada nos dois cérebros`));
  }

  const age_sozinho =
    (saida === 'aprovar' && ctx.liberacao.aprovar) || (saida === 'ajuste' && ctx.liberacao.ajuste);
  if (!age_sozinho && saida !== 'humano') {
    motivos.push(frase(`Saída ${saida} fica em sombra: a liberação para agir sozinho não está autorizada`));
  }

  return {
    saida,
    veredito_merito: a.veredito,
    estrela: b.nota,
    vale_estrela: b.nota >= 1,
    escape,
    confianca,
    divergencias,
    motivos,
    perguntas_ao_autor: a.perguntas_ao_autor,
    valor: a.valor,
    contestacao: b.contestacao,
    age_sozinho,
  };
}
