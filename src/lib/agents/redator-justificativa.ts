/**
 * REDATOR de justificativa humanizada do time autônomo de avaliação (Frente 2) — PURO.
 *
 * Quando a mesa manda um projeto para `em_validacao`/reenvio, o motivo hoje é um template
 * determinístico e SECO (ex.: o `motivo` de `avaliarPlausibilidadeFTE`/`avaliarFinanceiro`, ou o
 * agregado de `agregarVotos`/`conciliarComCetico`). O Luis quer que a mensagem que o agente
 * RETORNA como justificativa seja: **linguagem humanizada e acolhedora, SEM traços/travessões
 * (hífens de conexão), bem organizada** (o que observamos → por quê, com os números → como
 * corrigir).
 *
 * Este módulo é PURO (sem LLM, sem I/O): monta o PROMPT a partir dos FATOS DETERMINÍSTICOS e
 * oferece o GUARD `semTracos` (o prompt não segura — 3ª lição deste repo: Gostream, ganho
 * projetado, SmartOnline). Quem chama o LLM e aplica o guard é `redator-justificativa.functions.ts`.
 */

import type { LLMMessage } from '@/lib/llm';

/** Um apontamento de um especialista da mesa (rótulo + motivo legível já produzido por ele). */
export type ApontamentoEspecialista = {
  especialista: string;
  motivo: string;
};

/** Fatos DETERMINÍSTICOS da avaliação — a única fonte de números que o redator pode usar. */
export type FatosJustificativa = {
  /** FTE calculado (horas / 220). */
  fte?: number | null;
  /** Horas totais economizadas no mês. */
  horasTotais?: number | null;
  /** Pessoas declaradas no projeto (autor + membros). */
  pessoasDeclaradas?: number | null;
  /** Materialidade mensal em R$ (saving líquido + receita). */
  materialidadeMes?: number | null;
  /** Teto de materialidade acima do qual a decisão é sempre humana. */
  tetoMaterialidade?: number | null;
  /** Cadência do saving (mensal/pontual/trimestral/semestral). */
  tipoSaving?: string | null;
  /** Se o saving é contrafactual ("ninguém fazia"). */
  contrafactual?: boolean | null;
  /** O que cada especialista apontou (fonte dos motivos concretos). */
  apontamentos: ApontamentoEspecialista[];
  /** Caminhos sugeridos de correção (viram os passos numerados da parte 3). */
  caminhosCorrecao?: string[];
};

// ─── semTracos — GUARD determinístico (o prompt não segura) ────────────────────

// Conector: travessão (—, em dash), meia-risca (–, en dash) com QUALQUER espaço ao redor, OU
// hífen ASCII com espaço nos DOIS lados. ⚠️ Em/en dash NUNCA são hífen de palavra, então casam
// mesmo colados; o hífen ASCII só é conector com espaço dos dois lados (senão apagaria "e-mail").
const CONECTOR = /\s*[—–]\s*|\s+-\s+/g;

/**
 * Remove os traços de CONEXÃO entre frases (travessão —, meia-risca – e hífen " - ") trocando-os
 * por vírgula (ou ponto, quando o que segue abre nova oração — inicial maiúscula), **preservando o
 * hífen dentro de palavra** (e-mail, pré-, contra-) e o `R$`. PURA e idempotente. É o que garante o
 * "sem hífen" de verdade — o prompt sozinho não segura.
 */
export function semTracos(texto: string): string {
  if (!texto) return texto;
  let t = texto.replace(CONECTOR, (match: string, offset: number, full: string) => {
    const proximo = full[offset + match.length] ?? '';
    // Nova oração à frente (letra maiúscula, com acento incluído) → ponto; senão vírgula.
    return /[A-ZÀ-Þ]/.test(proximo) ? '. ' : ', ';
  });
  // Limpezas: espaço antes de pontuação, vírgula seguida de ponto, pontuação duplicada, espaços.
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/,\s*\./g, '.');
  t = t.replace(/,\s*,/g, ',');
  t = t.replace(/\.\s*\./g, '.');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

// ─── motivoDeterministico — fallback dash-free ─────────────────────────────────

/**
 * Junta os motivos dos apontamentos num texto determinístico já SEM traços — é o fallback quando
 * o LLM falha/vem vazio (fail-safe do `redigirJustificativa`). PURA.
 */
export function motivoDeterministico(fatos: FatosJustificativa): string {
  const partes = (fatos.apontamentos ?? [])
    .map((a) => (a?.motivo ?? '').trim())
    .filter((m) => m.length > 0);
  const base =
    partes.length > 0
      ? partes.join(' ')
      : 'Enviado para a triagem humana conferir os números do projeto.';
  return semTracos(base);
}

// ─── buildJustificativaPrompt — só os fatos, humano e sem traços ───────────────

/** Número pt-BR curto (vírgula decimal). */
function n1(v: number): string {
  return v.toFixed(1).replace('.', ',');
}
function reais(v: number): string {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
}

/** Monta a lista de FATOS (só o que veio preenchido) para o prompt do LLM. */
function blocoFatos(fatos: FatosJustificativa): string {
  const linhas: string[] = [];
  if (typeof fatos.horasTotais === 'number' && isFinite(fatos.horasTotais)) {
    linhas.push(`- Horas economizadas no mês: ${Math.round(fatos.horasTotais)}h`);
  }
  if (typeof fatos.fte === 'number' && isFinite(fatos.fte)) {
    linhas.push(`- Equivalente em pessoas em tempo integral (FTE): ${n1(fatos.fte)}`);
  }
  if (typeof fatos.pessoasDeclaradas === 'number' && isFinite(fatos.pessoasDeclaradas)) {
    linhas.push(`- Pessoas declaradas no projeto: ${Math.round(fatos.pessoasDeclaradas)}`);
  }
  if (typeof fatos.materialidadeMes === 'number' && isFinite(fatos.materialidadeMes)) {
    linhas.push(`- Materialidade mensal: ${reais(fatos.materialidadeMes)}`);
  }
  if (typeof fatos.tetoMaterialidade === 'number' && isFinite(fatos.tetoMaterialidade)) {
    linhas.push(`- Teto de materialidade (acima disso é sempre decisão humana): ${reais(fatos.tetoMaterialidade)}`);
  }
  if (fatos.tipoSaving) linhas.push(`- Cadência do saving: ${fatos.tipoSaving}`);
  if (typeof fatos.contrafactual === 'boolean') {
    linhas.push(`- Saving contrafactual (ninguém fazia antes): ${fatos.contrafactual ? 'sim' : 'não'}`);
  }
  return linhas.join('\n');
}

/** Monta a lista de apontamentos dos especialistas para o prompt. */
function blocoApontamentos(fatos: FatosJustificativa): string {
  return (fatos.apontamentos ?? [])
    .map((a) => `- [${a.especialista}] ${a.motivo}`)
    .join('\n');
}

export const SYSTEM_PROMPT_REDATOR = `Você redige a justificativa que o autor de um projeto de automação vai LER quando o projeto vai para conferência humana (triagem) no GoDocs do GoGroup.

Objetivo: transformar apontamentos técnicos e secos numa mensagem HUMANA, RESPEITOSA e ACOLHEDORA — o autor caprichou na submissão, então trate a conferência como um cuidado, nunca como acusação.

Estrutura OBRIGATÓRIA em 3 partes:
1) O QUE OBSERVAMOS — 1 a 2 frases calorosas dizendo que o projeto foi recebido e vai passar por uma conferência.
2) POR QUE — explique com os NÚMEROS fornecidos o que chamou atenção. Seja concreto e gentil.
3) COMO CORRIGIR — passos NUMERADOS (1., 2., 3.) e acionáveis.

Regras INVIOLÁVEIS:
- Português do Brasil, com acentuação correta.
- Use APENAS os números e fatos fornecidos. É PROIBIDO inventar qualquer valor, porcentagem, hora ou R$ que não esteja nos fatos.
- NUNCA exponha valor por hora ou R$ por cargo. Só cite a materialidade agregada, se ela estiver nos fatos.
- É PROIBIDO usar travessão (—), meia-risca (–) ou hífen de conexão entre frases (" - "). Use vírgula ou ponto. Hífen dentro de palavra (e-mail, pré-produção) é permitido.
- Tom humano, sem jargão de máquina, sem "prezado(a)" nem assinatura.
- Seja conciso: no máximo uns 3 parágrafos curtos + os passos.`;

/**
 * Monta as mensagens do LLM (system + user) a partir dos FATOS. PURA — não chama LLM. Os números
 * do bloco de fatos são a ÚNICA fonte que o prompt autoriza; o redator é proibido de inventar.
 */
export function buildJustificativaPrompt(fatos: FatosJustificativa): LLMMessage[] {
  const fatosTxt = blocoFatos(fatos) || '- (sem números adicionais)';
  const apontamentosTxt = blocoApontamentos(fatos) || '- (nenhum apontamento específico)';
  const caminhos = (fatos.caminhosCorrecao ?? []).filter(Boolean);
  const caminhosTxt =
    caminhos.length > 0
      ? caminhos.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(sugira passos concretos a partir dos apontamentos acima)';

  const user = `FATOS DO PROJETO (use SÓ estes números, não invente nenhum outro):
${fatosTxt}

O QUE OS ESPECIALISTAS APONTARAM:
${apontamentosTxt}

CAMINHOS DE CORREÇÃO (base para a parte 3, em passos numerados):
${caminhosTxt}

Escreva agora a justificativa nas 3 partes, humana e acolhedora, sem travessão/meia-risca/hífen de conexão.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT_REDATOR },
    { role: 'user', content: user },
  ];
}
