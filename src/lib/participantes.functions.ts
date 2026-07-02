// Sugestões de participantes — lista de pessoas da TeamGuide para o autocomplete
// do campo "E-mails dos participantes" (etapa 1 do formulário).
//
// A TeamGuide devolve a base inteira numa chamada (~440 pessoas), então o filtro
// por letra digitada acontece no FRONTEND; aqui só servimos a lista, com cache em
// memória (TTL) para não bater na TeamGuide a cada abertura do formulário. Se a
// TeamGuide falhar, devolvemos lista vazia — o campo continua aceitando e-mail
// digitado livremente (degradação suave, nunca bloqueia a submissão).

import { listarPessoasTeamGuide, type PessoaTeamGuide } from '@/lib/areas/teamguide.server';

const log = (...args: unknown[]) => console.log('[participantes.functions]', ...args);

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — quadro de funcionários muda devagar

let cache: { pessoas: PessoaTeamGuide[]; em: number } | null = null;

/** Lista de pessoas para o autocomplete de participantes (cache 10 min). */
export async function getSugestoesParticipantes(): Promise<PessoaTeamGuide[]> {
  if (cache && Date.now() - cache.em < CACHE_TTL_MS) return cache.pessoas;
  try {
    const pessoas = await listarPessoasTeamGuide();
    cache = { pessoas, em: Date.now() };
    return pessoas;
  } catch (err) {
    log('Falha ao listar pessoas da TeamGuide:', err instanceof Error ? err.message : err);
    // Cache expirado ainda é melhor que nada enquanto a TeamGuide não volta.
    return cache?.pessoas ?? [];
  }
}
