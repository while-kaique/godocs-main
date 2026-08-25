/**
 * "O que cada participante fez" — módulo PURO (sem import de servidor).
 *
 * O texto por pessoa é coletado na Etapa 1 do formulário e mora SÓ no banco
 * (`projetos.membros_contribuicoes`): não existe coluna no Sheets e nunca entra em prompt
 * de IA. Isso cria uma assimetria que este módulo resolve: as duas abas temporárias do
 * admin (`/especiais` e `/aprovacoes-pendentes`) listam do **espelho da planilha**, então
 * o texto não vem na linha — ele chega por um mapa lateral, chaveado pelo ID do projeto,
 * exatamente como as `avaliacoes` da `/especiais` já fazem.
 *
 * ⚠️ Aqui está a régua de EXIBIÇÃO (ordem, rótulo do papel, quem entra na lista). O
 * servidor só entrega as linhas cruas; a tela não redigita nada disso.
 */
import { PAPEIS_PARTICIPANTE } from '@/lib/submeter/constants';

/** Uma pessoa da equipe, com o papel legível e o que ela fez. */
export type ContribuicaoParticipante = {
  email: string;
  /** Rótulo pronto ("Coautor"/"Participante"/"Contribuidor"); `null` = sem papel gravado. */
  papel: string | null;
  /** Texto escrito pelo autor. Sempre não-vazio — quem não tem texto fica fora da lista. */
  texto: string;
};

/** Linha crua do banco (as 4 colunas de participantes, JSON em texto). */
export type LinhaContribuicoes = {
  id: string;
  membros: string | null;
  membros_papeis: string | null;
  membros_contribuicoes: string | null;
};

/**
 * Rótulo legível de um papel interno. Os `value` `coexecutor`/`planejador` são históricos
 * (ver `PAPEIS_PARTICIPANTE`), e os papéis LEGADOS `idealizador`/`referencia_tecnica` de
 * uma feature anterior caem em "Contribuidor" — a mesma regra que o sync do Sheets aplica.
 * Papel desconhecido volta cru (é melhor mostrar o valor do que sumir com a informação).
 */
export function rotuloPapelParticipante(valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  const conhecido = PAPEIS_PARTICIPANTE.find((p) => p.value === v);
  if (conhecido) return conhecido.label;
  if (v === 'idealizador' || v === 'referencia_tecnica') return 'Contribuidor';
  return v;
}

function parseMapa(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseLista(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Constrói `id do projeto → participantes com o que fizeram`, na ordem de `membros`
 * (a ordem em que o autor adicionou as pessoas) e com os avulsos depois. Fica FORA da
 * lista quem não tem texto: o card mostra o que existe, não uma fileira de "—".
 *
 * Projeto sem nada devolvido não entra no mapa — a tela então não desenha o bloco, que é
 * o certo para legado e para tudo submetido antes desta feature.
 */
export function montarContribuicoesPorProjeto(
  linhas: LinhaContribuicoes[],
): Record<string, ContribuicaoParticipante[]> {
  const out: Record<string, ContribuicaoParticipante[]> = {};
  for (const linha of linhas) {
    const contrib = parseMapa(linha.membros_contribuicoes);
    const papeis = parseMapa(linha.membros_papeis);
    const membros = parseLista(linha.membros);
    const comTexto = Object.keys(contrib).filter(
      (email) => String(contrib[email] ?? '').trim() !== '',
    );
    if (comTexto.length === 0) continue;
    const ordenados = [
      ...membros.filter((e) => comTexto.includes(e)),
      ...comTexto.filter((e) => !membros.includes(e)),
    ];
    out[linha.id] = ordenados.map((email) => ({
      email,
      papel: rotuloPapelParticipante(papeis[email] as string | undefined),
      texto: String(contrib[email]).trim(),
    }));
  }
  return out;
}
