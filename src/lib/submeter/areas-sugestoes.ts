// Lista de áreas/times (Team Guide) para o seletor de "quem sentiria falta" da Etapa 2.
//
// Fonte: GET /api/areas (tabela `areas`, sincronizada da Team Guide pelo cron; com a
// tabela vazia o backend cai na lista hardcoded). Carrega UMA vez por carregamento de
// página, igual ao autocomplete de participantes. Falha → lista vazia e o campo
// oferece o modo "pessoas" (o seletor de time é conveniência, nunca bloqueio).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export type AreaPublica = { id: number | null; nome: string };

let areasCache: AreaPublica[] | null = null;
let areasPromise: Promise<AreaPublica[]> | null = null;

async function carregarAreas(): Promise<AreaPublica[]> {
  if (areasCache) return areasCache;
  if (!areasPromise) {
    areasPromise = apiFetch<AreaPublica[]>("/api/areas")
      .then((lista) => {
        areasCache = Array.isArray(lista) ? lista : [];
        return areasCache;
      })
      .catch((err) => {
        areasPromise = null; // permite nova tentativa no próximo mount
        throw err;
      });
  }
  return areasPromise;
}

/** Aquece a lista sem renderizar nada (chamado no mount da etapa). */
export function prefetchAreas(): void {
  carregarAreas().catch(() => {});
}

export function useAreas(ativo = true): { areas: AreaPublica[]; loading: boolean } {
  const [areas, setAreas] = useState<AreaPublica[]>(areasCache ?? []);
  const [loading, setLoading] = useState(ativo && !areasCache);

  useEffect(() => {
    if (!ativo || areasCache) return;
    let vivo = true;
    setLoading(true);
    carregarAreas()
      .then((lista) => { if (vivo) setAreas(lista); })
      .catch(() => { if (vivo) setAreas([]); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [ativo]);

  return { areas, loading };
}
