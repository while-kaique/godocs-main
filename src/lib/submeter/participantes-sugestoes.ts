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

async function carregarPessoas(): Promise<SugestaoParticipante[]> {
  if (pessoasCache) return pessoasCache;
  if (!pessoasPromise) {
    pessoasPromise = apiFetch<SugestaoParticipante[]>("/api/participantes/sugestoes")
      .then((lista) => {
        pessoasCache = Array.isArray(lista) ? lista : [];
        return pessoasCache;
      })
      .catch(() => {
        pessoasPromise = null; // permite nova tentativa num próximo mount
        return [];
      });
  }
  return pessoasPromise;
}

/** Carrega a lista de pessoas quando `enabled` vira true (1x por página). */
export function useSugestoesParticipantes(enabled: boolean): SugestaoParticipante[] {
  const [pessoas, setPessoas] = useState<SugestaoParticipante[]>(pessoasCache ?? []);
  useEffect(() => {
    if (!enabled || pessoasCache) return;
    let vivo = true;
    carregarPessoas().then((lista) => { if (vivo) setPessoas(lista); });
    return () => { vivo = false; };
  }, [enabled]);
  return pessoas;
}
