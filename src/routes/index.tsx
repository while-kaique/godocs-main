import { createFileRoute, Link } from "@tanstack/react-router";
import { FilePlus2, PencilLine, RefreshCcw, ShieldCheck } from "lucide-react";

const WEBHOOKS = {
  edit: "https://n8n-study.gogroupgl.com/webhook/edit_workflow",
  resend: "https://n8n-study.gogroupgl.com/webhook/re_workflow",
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hub de Projetos Internos" },
      {
        name: "description",
        content:
          "Plataforma para submissão, edição e reenvio de projetos internos da empresa.",
      },
      { property: "og:title", content: "Hub de Projetos Internos" },
      {
        property: "og:description",
        content:
          "Submeta, edite ou reenvie projetos internos da empresa em poucos cliques.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
              H
            </div>
            <span className="font-semibold tracking-tight">Hub de Projetos</span>
          </div>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <ShieldCheck className="h-4 w-4" />
            Área Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="mb-14 max-w-3xl">
          <span className="mb-3 inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium uppercase tracking-wide text-accent-foreground">
            Plataforma interna
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Cadastre, edite e reenvie projetos internos.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Escolha uma das ações abaixo para iniciar. As submissões são
            registradas e acompanhadas pelos líderes responsáveis de cada área.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <ActionCard
            to="/submeter"
            icon={<FilePlus2 className="h-6 w-6" />}
            title="Submeter projeto"
            description="Cadastre um novo projeto interno com descrição, área, savings e documentação."
            badge="Novo cadastro"
          />
          <ActionCard
            href={WEBHOOKS.edit}
            icon={<PencilLine className="h-6 w-6" />}
            title="Editar projeto"
            description="Selecione um projeto já submetido para ajustar informações antes da análise."
            badge="Em análise"
          />
          <ActionCard
            href={WEBHOOKS.resend}
            icon={<RefreshCcw className="h-6 w-6" />}
            title="Reenviar projeto"
            description="Reenvio parcial ou total de projetos com status Reenvio Pendente após análise."
            badge="Reenvio pendente"
          />
        </section>

        <section className="mt-16 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">Status possíveis:</strong>{" "}
          Em análise · Aprovado · Reenvio Pendente. Líderes e administradores
          acompanham o andamento na área administrativa.
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Hub de Projetos · uso interno
      </footer>
    </div>
  );
}

function ActionCard({
  href,
  to,
  icon,
  title,
  description,
  badge,
}: {
  href?: string;
  to?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  const className =
    "group flex flex-col rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg";
  const inner = (
    <>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <span className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {badge}
      </span>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 flex-1 text-sm text-muted-foreground">{description}</p>
      <span className="mt-4 text-sm font-medium text-primary group-hover:underline">
        Abrir formulário →
      </span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {inner}
    </a>
  );
}
