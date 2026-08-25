/**
 * Corpus + recuperação vetorial ("RAG") do agente classificador de especiais — módulo PURO.
 *
 * A MEMÓRIA do agente são os especiais JÁ decididos: os que a triagem notou à mão (coluna
 * "Estrelas" = verdade) e os que o lote da força-tarefa / o próprio agente recomendaram. Cada um
 * carrega uma `leitura` que ANCORA a nota em projetos reais ("mesma faixa de Godash", "Âncora
 * direta: Regularizações = 1"). Ao classificar um especial novo, recuperamos os vizinhos
 * semânticos e os damos ao LLM como exemplos calibrados pela curva real.
 *
 * ⚠️ **O rótulo preferido é a NOTA HUMANA, não a recomendação do próprio agente.** Aprender
 * majoritariamente das próprias saídas é como o classificador deriva (feedback loop) — a nota de
 * gente é o chão que impede isso. `estrela_recomendada` só entra quando não há nota humana.
 *
 * Puro de propósito: a recuperação é testável com um corpus fixo, sem tocar embeddings nem banco.
 */
import { cosseno } from '@/lib/embeddings';

/** Um item da memória: um especial já avaliado, com seu vetor e seu rótulo. */
export type ExemplarEspecial = {
  projeto_id: string;
  nome: string | null;
  area: string | null;
  /** Nota gravada pela triagem (coluna "Estrelas"). É a VERDADE — vence a recomendada. */
  estrela_humana: number | null;
  /** Nota que o lote/agente recomendou (usada só quando não há nota humana). */
  estrela_recomendada: number | null;
  /** A leitura que justifica a nota — o que ensina o LLM a posicionar. */
  leitura: string | null;
  vetor: number[];
};

export type Vizinho = ExemplarEspecial & {
  /** Cosseno com o projeto-alvo (0..1). */
  similaridade: number;
  /** A nota que vale como exemplo (humana se houver, senão recomendada). */
  estrela_efetiva: number;
  /** De onde veio o rótulo — para a leitura e para os testes. */
  fonte_rotulo: 'humana' | 'recomendada';
};

/** Piso de similaridade: abaixo disso o "vizinho" não fala do mesmo assunto e só faria ruído. */
export const PISO_SIMILARIDADE = 0.2;

/** Quantos vizinhos entram no prompt por padrão. Poucos e bons > muitos e diluídos. */
export const K_VIZINHOS = 6;

/**
 * O rótulo que vale como exemplo: nota humana quando existe, senão a recomendada. Devolve `null`
 * quando o exemplar não tem rótulo nenhum (não serve de exemplo).
 */
export function rotuloExemplar(
  ex: ExemplarEspecial,
): { estrela: number; fonte: 'humana' | 'recomendada' } | null {
  if (ex.estrela_humana != null) return { estrela: ex.estrela_humana, fonte: 'humana' };
  if (ex.estrela_recomendada != null)
    return { estrela: ex.estrela_recomendada, fonte: 'recomendada' };
  return null;
}

/**
 * Seleciona os K vizinhos mais próximos do vetor-alvo, acima do piso, ordenados por similaridade.
 * Ignora o próprio projeto (um especial editado não é vizinho de si mesmo) e exemplares sem rótulo.
 */
export function selecionarVizinhos(
  alvoVetor: number[],
  corpus: ExemplarEspecial[],
  opts: { k?: number; piso?: number; excluirId?: string } = {},
): Vizinho[] {
  const k = opts.k ?? K_VIZINHOS;
  const piso = opts.piso ?? PISO_SIMILARIDADE;
  const vizinhos: Vizinho[] = [];
  for (const ex of corpus) {
    if (opts.excluirId && ex.projeto_id === opts.excluirId) continue;
    const rotulo = rotuloExemplar(ex);
    if (!rotulo) continue;
    const sim = cosseno(alvoVetor, ex.vetor);
    if (sim < piso) continue;
    vizinhos.push({
      ...ex,
      similaridade: sim,
      estrela_efetiva: rotulo.estrela,
      fonte_rotulo: rotulo.fonte,
    });
  }
  vizinhos.sort((a, b) => b.similaridade - a.similaridade);
  return vizinhos.slice(0, k);
}

// ─── Texto semântico (o que vira embedding) ────────────────────────────────────

/** Os campos de um projeto que compõem a "impressão semântica" para o embedding. */
export type EntradaSemantica = {
  nome?: string | null;
  area?: string | null;
  ferramenta?: string | null;
  tipos?: string | null;
  contexto_especial?: string | null;
  descricao?: string | null;
  memorial?: string | null;
  doc?: string | null;
};

/**
 * Monta o texto que representa o projeto para o embedding. Ordem = do mais discriminante (área,
 * escopo) para o mais volumoso (memorial/doc), porque o teto de caracteres corta o fim.
 */
export function textoParaEmbedding(e: EntradaSemantica): string {
  const partes: string[] = [];
  if (e.nome) partes.push(`Projeto: ${e.nome}`);
  if (e.area) partes.push(`Área: ${e.area}`);
  if (e.ferramenta) partes.push(`Ferramenta: ${e.ferramenta}`);
  if (e.tipos) partes.push(`Tipo: ${e.tipos}`);
  if (e.contexto_especial) partes.push(`Por que é especial: ${e.contexto_especial}`);
  if (e.descricao) partes.push(`Descrição: ${e.descricao}`);
  if (e.memorial) partes.push(`Memorial:\n${e.memorial}`);
  else if (e.doc) partes.push(`Documentação:\n${e.doc}`);
  return partes.join('\n').trim();
}

/**
 * Hash estável e barato do texto embeddado — para só re-gerar o vetor quando o texto muda (o
 * embedding custa dinheiro). Não precisa ser criptográfico; precisa mudar quando o conteúdo muda.
 */
export function hashTexto(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) {
    h = ((h << 5) + h) ^ texto.charCodeAt(i);
  }
  // >>> 0 para inteiro sem sinal; base36 encurta.
  return (h >>> 0).toString(36) + ':' + texto.length.toString(36);
}

// ─── Bloco few-shot para o prompt ──────────────────────────────────────────────

/**
 * Renderiza os vizinhos como exemplos para o prompt. Cada linha: nota + nome + área + a leitura
 * que a justifica. A leitura é o que ensina o "por que não sobe" — mais valiosa que a nota nua.
 */
export function montarBlocoFewShot(vizinhos: Vizinho[]): string {
  if (vizinhos.length === 0) {
    return 'Nenhum projeto especial parecido já avaliado — posicione só pela régua e pela curva.';
  }
  const linhas = vizinhos.map((v) => {
    const nota = `${v.estrela_efetiva} ${v.estrela_efetiva === 1 ? 'estrela' : 'estrelas'}`;
    const proc = v.fonte_rotulo === 'humana' ? 'nota da triagem' : 'recomendação anterior';
    const area = v.area ? ` · ${v.area}` : '';
    const leitura = v.leitura ? ` — ${v.leitura}` : '';
    return `• «${v.nome ?? v.projeto_id}»${area} → ${nota} (${proc})${leitura}`;
  });
  return linhas.join('\n');
}
