// Autocomplete de participantes — filtro puro (testável) + hook de carregamento.
//
// A lista completa vem de GET /api/participantes/sugestoes (TeamGuide, ~440
// pessoas) UMA vez por sessão de página; cada letra digitada filtra localmente.
// Falha no fetch → lista vazia e o campo segue aceitando e-mail digitado (o
// autocomplete é conveniência, nunca bloqueio).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export type SugestaoParticipante = { nome: string; email: string; cargo: string | null };

// Range de marcas diacríticas combinantes (remove acentos após NFD).
const DIACRITICS = /[̀-ͯ]/g;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(DIACRITICS, "").trim();

/**
 * Filtra a lista pelo texto digitado (sem acento/caixa), casando por nome OU
 * e-mail — cada palavra da busca precisa aparecer em algum dos dois. Exclui
 * quem já foi adicionado. Ordena por relevância: e-mail que começa pela busca,
 * depois nome que começa, depois demais ocorrências (ordem alfabética estável).
 */
export function filtrarSugestoes(
  pessoas: SugestaoParticipante[],
  busca: string,
  jaAdicionados: string[],
): SugestaoParticipante[] {
  const q = norm(busca);
  if (!q) return [];
  const termos = q.split(/\s+/).filter(Boolean);
  const adicionados = new Set(jaAdicionados.map((e) => e.toLowerCase()));

  const rank = (p: SugestaoParticipante): number | null => {
    const nome = norm(p.nome);
    const email = p.email; // já minúsculo e sem acento
    const casaTudo = termos.every((t) => nome.includes(t) || email.includes(t));
    if (!casaTudo) return null;
    if (email.startsWith(termos[0])) return 0;
    if (nome.startsWith(termos[0]) || nome.split(/\s+/).some((w) => w.startsWith(termos[0]))) return 1;
    return 2;
  };

  return pessoas
    .filter((p) => !adicionados.has(p.email))
    .map((p) => ({ p, r: rank(p) }))
    .filter((x): x is { p: SugestaoParticipante; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

// Cache de módulo: 1 fetch por carregamento da página (o form monta/desmonta steps).
let pessoasCache: SugestaoParticipante[] | null = null;
let pessoasPromise: Promise<SugestaoParticipante[]> | null = null;

// GET com RETRY curto. O endpoint às vezes cai num erro TRANSITÓRIO de infra do
// Godeploy no cold start ("Internal error while starting up Durable Object storage
// caused object to be reset") que devolve 502 em QUALQUER rota de API — não é o
// handler (esta rota nem toca o env.DB). Como recupera em 1-2 tentativas, re-tentamos
// no cliente com backoff curto antes de desistir; assim a lista aparece sozinha.
async function buscarSugestoesComRetry(): Promise<SugestaoParticipante[]> {
  const MAX = 3;
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= MAX; tentativa++) {
    try {
      const lista = await apiFetch<SugestaoParticipante[]>("/api/participantes/sugestoes");
      return Array.isArray(lista) ? lista : [];
    } catch (err) {
      ultimoErro = err;
      if (tentativa < MAX) await new Promise((r) => setTimeout(r, 400 * tentativa));
    }
  }
  throw ultimoErro;
}

async function carregarPessoas(): Promise<SugestaoParticipante[]> {
  if (pessoasCache) return pessoasCache;
  if (!pessoasPromise) {
    pessoasPromise = buscarSugestoesComRetry()
      .then((lista) => {
        pessoasCache = lista;
        return pessoasCache;
      })
      .catch(() => {
        pessoasPromise = null; // esgotou os retries → permite nova tentativa num próximo mount
        return [];
      });
  }
  return pessoasPromise;
}

/**
 * Aquece a lista ANTES de o usuário precisar dela (ex.: ao montar a Etapa 1, antes
 * de marcar "em equipe"). Fire-and-forget: só dispara o fetch para o cache já estar
 * pronto quando o autocomplete abrir — a lista da TeamGuide costuma levar ~1s no
 * cold start do worker. Idempotente (reusa o cache/promise de módulo).
 */
export function prefetchSugestoesParticipantes(): void {
  void carregarPessoas();
}

/**
 * Carrega a lista de pessoas quando `enabled` vira true (1x por página) e informa se
 * ainda está carregando — para o autocomplete mostrar um "buscando…" sutil em vez de
 * parecer que não há sugestões. Se o prefetch já encheu o cache, entrega na hora.
 */
export function useSugestoesParticipantes(
  enabled: boolean,
): { pessoas: SugestaoParticipante[]; loading: boolean } {
  const [pessoas, setPessoas] = useState<SugestaoParticipante[]>(pessoasCache ?? []);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // Cache já pronto (fetch anterior ou prefetch): entrega e não mostra "carregando".
    if (pessoasCache) { setPessoas(pessoasCache); return; }
    let vivo = true;
    setLoading(true);
    carregarPessoas().then((lista) => {
      if (!vivo) return;
      setPessoas(lista);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [enabled]);
  return { pessoas, loading };
}
