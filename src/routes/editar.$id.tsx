import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useBloqueioSubmissao } from "@/components/aviso-bloqueio-submissao";
import { SubmeterPageContent } from "./submeter";

export const Route = createFileRoute("/editar/$id")({
  // O título ("Editando · <nome do projeto>") sai de `useTituloPagina` dentro do
  // `SubmeterPageContent`, que é quem tem o nome seedado. ⚠️ NÃO chamar o hook aqui
  // também: numa montagem o efeito do filho roda antes do efeito do pai, e este
  // sobrescreveria o do filho.
  head: () => ({
    meta: [{ name: "description", content: "Edite ou reenvie seu projeto de automação." }],
  }),
  component: EditarPage,
});

function EditarPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  // Só o autor (owner) ou admin RPA edita. Confere antes de abrir o editor; quem só
  // participa é levado à visualização. O gate definitivo é server-side no submit —
  // isto evita carregar o editor à toa e dá o feedback certo.
  const [estado, setEstado] = useState<"checando" | "ok">("checando");
  const bloqueio = useBloqueioSubmissao();

  useEffect(() => {
    let ativo = true;
    // Bloqueio TEMPORÁRIO de submissões (janela determinística): durante a janela o
    // reenvio/edição também para. URL direta para o editor volta à listagem — o gate
    // DURO continua sendo o servidor (`deveRecusarSubmissao`), isto é só a porta do
    // cliente. Fonte única do relógio em `src/lib/bloqueio-submissao.ts`.
    //
    // ⚠️ `bloqueio.bloqueado` (o HOOK), não `estaBloqueado()` cru: o hook já resolve
    // "estou em produção?" — e fora dela a pausa não se aplica, porque a versão nova
    // que o aviso anuncia é exatamente a que se valida no staging (barrar a edição lá
    // tornaria o reenvio impossível de testar). Enquanto o ambiente é desconhecido o
    // hook devolve a régua de produção, então a dúvida erra para o lado de bloquear.
    if (bloqueio.bloqueado) {
      navigate({ to: "/meus-projetos", replace: true });
      return;
    }
    apiFetch<{ podeEditar: boolean }>(`/api/meus-projetos/${id}`)
      .then((p) => {
        if (!ativo) return;
        if (p.podeEditar) setEstado("ok");
        else navigate({ to: "/projeto/$id", params: { id }, replace: true });
      })
      .catch(() => {
        // Sem acesso/erro → manda para a visualização (que mostra o erro apropriado).
        if (ativo) navigate({ to: "/projeto/$id", params: { id }, replace: true });
      });
    return () => {
      ativo = false;
    };
  }, [id, navigate, bloqueio.bloqueado]);

  if (estado === "checando") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: "var(--go-blue)" }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--go-white)" }} />
      </div>
    );
  }

  return <SubmeterPageContent editProjetoId={id} />;
}
