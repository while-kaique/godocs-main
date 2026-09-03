// Autocomplete do projeto PAI (feature de outro projeto) — hook de busca DEBOUNCED.
//
// Diferente do autocomplete de participantes (lista inteira cacheada e filtrada no
// cliente), aqui a filtragem é no SERVIDOR: GET /api/projetos/buscar?q= lê o espelho da
// planilha e devolve {id, nome, autor}. Debounce para não disparar uma requisição por
// tecla. Falha → lista vazia (o campo segue utilizável, sem sugestões).

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export type ProjetoSugestao = { id: string; nome: string; autor: string };

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/**
 * Busca projetos por nome com debounce. Devolve `{ resultados, loading }`. `q` com menos
 * de 2 caracteres não dispara requisição (devolve []). Cancela por token de geração para
 * uma resposta atrasada não sobrescrever uma busca mais nova.
 */
export function useBuscaProjetos(q: string): { resultados: ProjetoSugestao[]; loading: boolean } {
  const [resultados, setResultados] = useState<ProjetoSugestao[]>([]);
  const [loading, setLoading] = useState(false);
  const geracao = useRef(0);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < MIN_CHARS) {
      setResultados([]);
      setLoading(false);
      return;
    }
    const meu = ++geracao.current;
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch<ProjetoSugestao[]>(`/api/projetos/buscar?q=${encodeURIComponent(termo)}`)
        .then((lista) => {
          if (meu !== geracao.current) return; // resposta velha — ignora
          setResultados(Array.isArray(lista) ? lista : []);
          setLoading(false);
        })
        .catch(() => {
          if (meu !== geracao.current) return;
          setResultados([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  return { resultados, loading };
}
