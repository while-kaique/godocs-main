// /faq/$categoria/$item — endereço LEGADO. O FAQ teve um nível de tópico por categoria
// (`/faq/tipos_projetos/especiais`); hoje o assunto é um documento único (SPEC_FAQ D13).
//
// ⚠️ A rota continua existindo só para redirecionar: esses links foram colados em Google
// Chat, e-mail e no formulário, e um 404 aqui é um link morto para quem só queria ler a
// resposta. O redirect acontece ANTES de renderizar (`beforeLoad`), então não pisca tela.

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/faq/$categoria/$item")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/faq/$categoria",
      params: { categoria: params.categoria },
      replace: true,
    });
  },
});
