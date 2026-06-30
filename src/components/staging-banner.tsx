import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";

// Faixa fixa "AMBIENTE DE STAGING".
//
// O bundle do SPA é IDÊNTICO em prod e staging — o cliente descobre o ambiente
// consultando /api/config (que lê `GODOCS_ENV` no worker, em tempo de request).
// Em produção o componente não renderiza nada (env !== 'staging' → null).
//
// Decisão visual: o app inteiro é `--go-blue`; a faixa usa o acento `--go-lime`
// + fita de zona de teste justamente para INTERROMPER a identidade normal e
// deixar inconfundível que este NÃO é o ambiente de produção.

type PublicConfig = { env: "production" | "staging" };

// Tinta quase-preta (puxada pro tom do lime) — alto contraste sobre o lime.
const INK = "#14160a";

export function StagingBanner() {
  const { data } = useQuery<PublicConfig>({
    queryKey: ["public-config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) return { env: "production" } as PublicConfig;
      return (await res.json()) as PublicConfig;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (data?.env !== "staging") return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex h-8 w-full select-none items-stretch overflow-hidden border-b text-[12px] leading-none"
      style={{
        backgroundColor: "var(--go-lime)",
        borderColor: "rgba(20, 22, 10, 0.35)",
        color: INK,
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      {/* Assinatura: fita de zona de teste (só em telas ≥ sm, p/ não comer espaço no mobile) */}
      <span
        aria-hidden="true"
        className="hidden h-full w-9 shrink-0 sm:block"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, rgba(20, 22, 10, 0.9) 0 7px, transparent 7px 14px)",
        }}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <FlaskConical aria-hidden="true" size={15} strokeWidth={2.5} className="shrink-0" />
        <span className="font-bold uppercase tracking-[0.14em]">Staging</span>
        <span aria-hidden="true" className="opacity-50">
          ·
        </span>
        <span className="truncate font-medium opacity-90">
          <span className="hidden sm:inline">
            Ambiente de teste — dados isolados, não afetam a produção.
          </span>
          <span className="sm:hidden">Ambiente de teste</span>
        </span>
      </div>
    </div>
  );
}
