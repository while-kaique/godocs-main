import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getCurrentEntrySrc, isUpdateAvailable } from "@/lib/version-check";

// Faixa "Uma nova versão do GoDocs está disponível" + botão Recarregar.
//
// Por quê: o GoDeploy acumula assets a cada deploy, então uma aba antiga nunca
// dá 404 nem é forçada a atualizar — fica rodando código velho contra o worker
// novo (version skew). Aqui detectamos o skew comparando o entry em execução com
// o `/index.html` atual da borda (ver src/lib/version-check.ts) e OFERECEMOS
// recarregar. Nunca recarrega sozinho: num app de formulário longo, um reload
// automático interromperia a digitação/coleta. A pessoa clica quando quiser.
//
// Identidade: `--go-blue` (aviso de sistema — distinto do lime da staging e do
// vermelho de erro). A11y: role="status" (aviso educado), ícone + texto (nunca só
// cor), foco de teclado visível, sem animação perpétua (respeita quem não quer).

const INTERVALO_MS = 10 * 60 * 1000; // re-checa a cada 10 min
const CREME = "#FBF4EE"; // --go-cream

export function AtualizacaoBanner() {
  const [disponivel, setDisponivel] = useState(false);
  // Entry que ESTE cliente carregou — capturado uma vez no mount.
  const entryAtual = useRef<string | null>(null);

  const verificar = useCallback(async () => {
    if (!entryAtual.current || disponivel) return;
    try {
      // no-store + cachebust: precisa ser o index.html recém-servido, não o cache.
      const res = await fetch(`/index.html?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.text();
      if (isUpdateAvailable(entryAtual.current, html)) setDisponivel(true);
    } catch {
      // Offline / falha de rede — ignora; tenta de novo no próximo ciclo.
    }
  }, [disponivel]);

  useEffect(() => {
    entryAtual.current = getCurrentEntrySrc();
    if (!entryAtual.current) return; // dev ou sem entry hasheado → não faz nada

    void verificar();
    const id = window.setInterval(() => void verificar(), INTERVALO_MS);
    // Re-checa quando a pessoa volta pra aba (o momento mais provável de ter saído
    // um deploy enquanto a aba ficou em segundo plano).
    const onVisible = () => {
      if (document.visibilityState === "visible") void verificar();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [verificar]);

  if (!disponivel) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex w-full items-center gap-3 border-b px-3 py-2 text-[13px] leading-tight sm:px-4"
      style={{
        backgroundColor: "var(--go-blue)",
        borderColor: "rgba(0, 0, 0, 0.2)",
        color: CREME,
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <RefreshCw aria-hidden="true" size={16} strokeWidth={2.5} className="shrink-0" />
      <span className="min-w-0 flex-1 font-medium">
        Uma nova versão do GoDocs está disponível.
        <span className="hidden font-normal opacity-90 sm:inline"> Recarregue para atualizar.</span>
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        // ring lime + offset azul: foco de teclado inconfundível sobre a faixa.
        className="shrink-0 rounded-md px-3 py-1 text-[13px] font-semibold outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--go-lime)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--go-blue)]"
        style={{ backgroundColor: CREME, color: "var(--go-blue)" }}
      >
        Recarregar
      </button>
    </div>
  );
}
