/**
 * AGLUTINADOR (item 5.3) — o juiz do par "este projeto é uma FEATURE daquele?".
 *
 * O corpus vetorial traz os vizinhos (parecidos NO TEXTO); parecido não é o mesmo que "parte
 * de". Dois dashboards de margem de marcas diferentes são semanticamente irmãos e NÃO devem
 * ser aglutinados — quem separa uma coisa da outra é este julgamento.
 *
 * ⚠️ O "não" é o DEFAULT em todas as camadas: o prompt manda recusar na dúvida, o
 * `aplicarVeredito` (puro) confere o pai contra os candidatos enviados, exige confiança acima
 * do piso e exige justificativa. Falso positivo aqui custa uma fusão errada de dois projetos
 * de gente diferente — o erro mais caro que este agente pode cometer.
 *
 * ⚠️ Ele NUNCA escolhe a DIREÇÃO: recebe pais candidatos já decididos pelo relógio
 * (`escolherDirecao`) e só diz se um deles é o produto do qual o candidato é feature.
 */
import { llmChat } from '@/lib/llm';
import {
  aplicarVeredito,
  type ParCandidato,
  type ProjetoAglutinavel,
  type Sugestao,
  type VereditoAglutinacao,
} from '@/lib/aglutinacao';

const TETO_TEXTO = 500;

function descrever(p: ProjetoAglutinavel): string {
  const d = (p.descricao ?? '').trim().slice(0, TETO_TEXTO);
  return `id: ${p.id}\nnome: ${p.nome}${d ? `\ndescrição: ${d}` : ''}`;
}

export function montarPromptAglutinacao(
  filho: ProjetoAglutinavel,
  pais: ProjetoAglutinavel[],
): string {
  return `Você decide se um projeto é, na verdade, uma FEATURE (parte, módulo, extensão) de um projeto que já existia — e não um projeto próprio.

PROJETO EM ANÁLISE (o mais NOVO):
${descrever(filho)}

PROJETOS ANTERIORES CANDIDATOS A "PRODUTO PAI":
${pais.map(descrever).join('\n\n')}

É FEATURE quando o projeto novo:
- acrescenta uma capacidade DENTRO do produto anterior (nova tela, novo fluxo, nova etapa do MESMO processo);
- é uma versão/evolução do anterior ("v2", "fase 2", "agora também faz X");
- só existe porque o anterior existe (não roda sozinho, não entrega valor sem ele).

NÃO é feature — e este é o erro que você deve evitar:
- fazer a MESMA COISA para outra marca, outra área, outro cliente (dois dashboards de margem, um da Gocase e um da Gobeaute, são projetos IRMÃOS, cada um com seu dono e seu ganho);
- usar a mesma ferramenta, a mesma stack ou resolver dores parecidas;
- ser do mesmo time ou do mesmo autor;
- ser apenas SEMELHANTE. Semelhança foi o que trouxe estes candidatos até aqui — ela já está descontada e não é evidência de nada.

Na dúvida, responda que NÃO é feature. Um "não" errado custa uma revisão; um "sim" errado funde dois projetos de pessoas diferentes e some com o ganho de um deles.

Responda SOMENTE um JSON, sem texto antes ou depois:
{"eh_feature": true|false, "pai_id": "<id EXATO de um dos candidatos, ou null>", "confianca": <0 a 1>, "porque": "<no máximo 25 palavras dizendo o que o novo acrescenta DENTRO do pai>"}`;
}

/** Extrai o veredito de uma resposta que pode vir com cerca de texto. */
export function interpretarVeredito(texto: string): VereditoAglutinacao | null {
  const limpo = String(texto ?? '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const j = JSON.parse(limpo.slice(ini, fim + 1)) as Record<string, unknown>;
    const conf = Number(j.confianca);
    return {
      eh_feature: j.eh_feature === true,
      pai_id: j.pai_id == null ? null : String(j.pai_id).trim() || null,
      confianca: Number.isFinite(conf) ? conf : 0,
      porque: String(j.porque ?? '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Julga UM projeto contra seus candidatos. Nunca lança: falha de proxy → nenhuma sugestão
 * (o silêncio é o default seguro; a corrida em lote não pode morrer por uma chamada).
 */
export async function julgarAglutinacao(
  filho: ProjetoAglutinavel,
  candidatos: ParCandidato[],
  universo: Map<string, ProjetoAglutinavel>,
): Promise<Sugestao | null> {
  const pais = candidatos
    .map((c) => universo.get(c.paiId))
    .filter((p): p is ProjetoAglutinavel => !!p);
  if (pais.length === 0) return null;
  try {
    const resposta = await llmChat([{ role: 'user', content: montarPromptAglutinacao(filho, pais) }], {
      jsonMode: true,
      model: process.env.LLM_MODEL_FAST || undefined,
      reasoningEffort: process.env.LLM_REASONING_EFFORT_FAST || 'low',
      maxTokens: 700,
    });
    return aplicarVeredito(candidatos, interpretarVeredito(resposta));
  } catch {
    return null;
  }
}
