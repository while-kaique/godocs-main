import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Baixa o chunk da rota no HOVER/foco, não no clique. O ganho aqui não é de bytes:
    // o edge do Godeploy cobra ~750 ms por requisição, então o JS da rota chegava
    // DEPOIS do clique e só então a tela pedia os dados — cascata de ~4 s + ~3 s.
    // Com o preload, o código chega enquanto o dedo ainda está indo ao botão.
    defaultPreload: "intent",
    // 150 ms de intenção antes de disparar: passar o mouse por cima a caminho de outro
    // lugar não vale uma requisição (cada uma custa ~750 ms de edge, e a leitura da
    // planilha do admin tem cota de 60/min COMPARTILHADA com prod).
    defaultPreloadDelay: 150,
  });

  return router;
};
