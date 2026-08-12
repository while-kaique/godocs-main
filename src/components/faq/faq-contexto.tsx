// FAQ — estado compartilhado pelas rotas (/faq e /faq/$categoria).
//
// O conteúdo é buscado UMA vez, na rota-layout (`routes/faq.tsx`), e descido por contexto:
// sem isso, cada navegação entre o índice e um assunto refaria a mesma chamada.
// `recarregar()` existe para o admin ver o efeito da edição inline sem F5.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { FaqCategoria } from "@/lib/faq/conteudo";

type EstadoFaq = {
  categorias: FaqCategoria[];
  /** true = a pessoa é admin. O gate real é server-side (`requireAdmin`). */
  ehAdmin: boolean;
  /** Admin pediu para ver a página como um usuário comum a vê. */
  verComoUsuario: boolean;
  setVerComoUsuario: (valor: boolean) => void;
  /**
   * O que decide se os controles de edição PINTAM. Sai daqui, e não de `ehAdmin`, para o
   * botão "Ver como usuário" ter um único interruptor — se cada tela combinasse as duas
   * flags, uma delas esqueceria e o modo de visualização mostraria um botão de admin.
   */
  podeEditar: boolean;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
};

const FaqContexto = createContext<EstadoFaq | null>(null);

export function FaqProvider({ children }: { children: React.ReactNode }) {
  const [categorias, setCategorias] = useState<FaqCategoria[]>([]);
  const [ehAdmin, setEhAdmin] = useState(false);
  const [verComoUsuario, setVerComoUsuario] = useState(false);
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
    <FaqContexto.Provider
      value={{
        categorias,
        ehAdmin,
        verComoUsuario,
        setVerComoUsuario,
        podeEditar: ehAdmin && !verComoUsuario,
        carregando,
        erro,
        recarregar: carregar,
      }}
    >
      {children}
    </FaqContexto.Provider>
  );
}

export function useFaq(): EstadoFaq {
  const ctx = useContext(FaqContexto);
  if (!ctx) throw new Error("useFaq precisa estar dentro do FaqProvider (routes/faq.tsx).");
  return ctx;
}
