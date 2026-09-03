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

const TETO_DESCRICAO = 500;
/**
 * Teto da documentação por projeto. Com 1 filho + até 5 pais, 1.500 × 6 cabe folgado — e a
 * documentação é o que permite reconhecer a feature REBATIZADA, que o nome nunca entrega.
 */
const TETO_DOC = 1500;

function descrever(p: ProjetoAglutinavel): string {
  const d = (p.descricao ?? '').trim().slice(0, TETO_DESCRICAO);
  const doc = (p.documentacao ?? '').trim().slice(0, TETO_DOC);
  return [
    `id: ${p.id}`,
    `nome: ${p.nome}`,
    d ? `descrição: ${d}` : '',
    doc ? `documentação: ${doc}` : '',
  ]
    .filter(Boolean)
    .join('\n');
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

⚠️ DECIDA PELO QUE OS PROJETOS FAZEM (documentação e descrição), NÃO PELO NOME. Nomes parecidos podem ser de projetos independentes, e uma feature pode ter sido rebatizada e não carregar mais o nome do produto. O nome é pista fraca; o que a documentação descreve é a evidência.

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

export type ResultadoJulgamento = {
  sugestao: Sugestao | null;
  /** `null` = o LLM respondeu. Preenchido = a chamada falhou e NADA foi julgado. */
  erro: string | null;
};

/**
 * Julga UM projeto contra seus candidatos. Nunca lança — a corrida em lote não pode morrer
 * por causa de uma chamada.
 *
 * ⚠️ **Falha de chamada NÃO é "não é feature".** O ai-proxy devolve 502 em rajada (aconteceu
 * de verdade em 03/09/2026: 40 julgamentos seguidos, nenhum passou), e se o erro virasse
 * `null` silencioso a varredura terminaria anunciando "nenhuma sugestão" para uma base que
 * nunca foi analisada — a mentira mais cara que este script pode contar. Por isso o erro sobe
 * junto e o relatório o CONTA.
 */
export async function julgarAglutinacao(
  filho: ProjetoAglutinavel,
  candidatos: ParCandidato[],
  universo: Map<string, ProjetoAglutinavel>,
): Promise<ResultadoJulgamento> {
  const pais = candidatos
    .map((c) => universo.get(c.paiId))
    .filter((p): p is ProjetoAglutinavel => !!p);
  if (pais.length === 0) return { sugestao: null, erro: null };
  try {
    const resposta = await llmChat([{ role: 'user', content: montarPromptAglutinacao(filho, pais) }], {
      jsonMode: true,
      model: process.env.LLM_MODEL_FAST || undefined,
      reasoningEffort: process.env.LLM_REASONING_EFFORT_FAST || 'low',
      maxTokens: 700,
    });
    const veredito = interpretarVeredito(resposta);
    // Resposta que chegou mas não é JSON interpretável também é FALHA, não um "não":
    // o modelo pode ter devolvido uma recusa ou um texto solto.
    if (!veredito) return { sugestao: null, erro: 'resposta não interpretável' };
    return { sugestao: aplicarVeredito(candidatos, veredito), erro: null };
  } catch (e) {
    return { sugestao: null, erro: (e as Error)?.message?.slice(0, 120) || 'falha na chamada' };
  }
}
