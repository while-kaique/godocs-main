// FAQ — estado compartilhado pelos 3 níveis de rota (/faq, categoria, tópico).
//
// A árvore é buscada UMA vez, na rota-layout (`routes/faq.tsx`), e descida por contexto:
// sem isso, cada navegação entre categoria e tópico refaria a mesma chamada. `recarregar()`
// existe para o admin ver o efeito da edição inline sem F5.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { FaqCategoria } from "@/lib/faq/conteudo";

type EstadoFaq = {
  categorias: FaqCategoria[];
  /** true = a pessoa é admin e vê os controles de edição. O gate real é server-side. */
  ehAdmin: boolean;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
};

const FaqContexto = createContext<EstadoFaq | null>(null);

export function FaqProvider({ children }: { children: React.ReactNode }) {
  const [categorias, setCategorias] = useState<FaqCategoria[]>([]);
  const [ehAdmin, setEhAdmin] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ categorias: FaqCategoria[] }>("/api/faq");
      setCategorias(r.categorias ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o FAQ.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    // Quem é admin é pergunta separada da do conteúdo: se ela falhar, o FAQ continua
    // legível (só sem os controles de edição).
    apiFetch<{ isAdmin?: boolean } | null>("/api/auth/me")
      .then((u) => setEhAdmin(u?.isAdmin === true))
      .catch(() => setEhAdmin(false));
  }, [carregar]);

  return (
    <FaqContexto.Provider value={{ categorias, ehAdmin, carregando, erro, recarregar: carregar }}>
      {children}
    </FaqContexto.Provider>
  );
}

export function useFaq(): EstadoFaq {
  const ctx = useContext(FaqContexto);
  if (!ctx) throw new Error("useFaq precisa estar dentro do FaqProvider (routes/faq.tsx).");
  return ctx;
}
