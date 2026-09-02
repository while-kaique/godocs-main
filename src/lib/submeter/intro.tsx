// Tela de APRESENTAÇÃO do formulário — aparece antes da Etapa 1 numa submissão
// nova, e o botão "Ok, entendi" leva ao formulário real.
//
// Por que existe: a premissa nº 1 do GoDocs (só entra automação JÁ em produção,
// com ganho JÁ medido) só aparecia depois — no gate de ganho real × projetado, no
// meio do chat com o agente —, e quem chegava com projeção perdia a submissão
// inteira ali. Dizer isso de cara é mais barato que barrar no fim.
//
// Decisões de forma (regra 11):
// - A tela NÃO é uma etapa do wizard: `STEPS`/`WizardProgress` ficam intocados
//   (uma "etapa 0" apareceria também na edição, que reusa o mesmo componente).
// - A trilha das 3 etapas repete o desenho do `WizardProgress` (círculo azul de
//   36px + trilho de 2,5px), só na vertical: a pessoa reconhece na intro o mesmo
//   stepper que vai ver no topo do formulário nos minutos seguintes.
// - "Entra / não entra" nunca depende só de cor: cada linha tem ícone + rótulo.

import React from "react";
import { CircleCheck, CircleSlash2, ArrowRight } from "lucide-react";
import { PageFrame, PageHeader, PageFooter, BrowserDots } from "./layout";
import { STEPS } from "./constants";
import {
  AvisoBloqueioSubmissao,
  useBloqueioSubmissao,
} from "@/components/aviso-bloqueio-submissao";

// A régua de "isto é projeto?", em forma de pergunta para a própria pessoa.
//
// ⚠️ Estas 3 perguntas são a MESMA régua que o analisador aplica depois e que o
// agente cobra nas seções "Processo alterado" e "Ponteiro movido e onde verificar"
// — a referência é `spec-docs/SPEC_CRITERIOS_PROJETO.md` +
// `docs/criterios-projeto-recorrencia-evidencia.md`. Ao mudar a régua LÁ, mude o
// texto aqui: uma intro que promete um critério diferente do que o agente cobra é
// pior que intro nenhuma. (Não importamos a constante do prompt: a do
// `orchestrator.ts` é redação para LLM, roda no worker e fala em códigos `[1.3]`/
// `[1.4]`, que são roteiro interno e proibidos na tela.)
//
// A 3ª pergunta nomeia onde se confere (relatório/painel/sistema/base) de
// propósito: "dá para ver no sistema" é justamente a resposta vaga que o gate
// recusa, e é onde as pessoas mais empacam.
const CRITERIOS = [
  {
    nome: "Recorrência",
    pergunta: "Roda de novo sem alguém pedir — agendado, por evento ou em uso contínuo?",
  },
  {
    nome: "Contrafactual",
    pergunta: "Se desligar hoje, quem reclama e o que piora?",
  },
  {
    nome: "Rastreabilidade",
    pergunta:
      "Qual indicador se move e onde isso é conferido? Nomeie o relatório, painel, sistema ou base.",
  },
];

// O que cada etapa pede, na ordem do wizard. O RÓTULO não é redigitado aqui —
// sai de `STEPS` (fonte única), para a intro nunca divergir do stepper.
const RESUMO_ETAPAS: Record<number, string> = {
  1: "Confirme quem participou do projeto e anexe a documentação que já existir.",
  2: "Marque o tipo de projeto e os números: horas economizadas, gastos que deixaram de existir e/ou receita.",
  3: "Um chat com IA completa a documentação técnica e escreve o memorial de impacto com você. Traga números reais e onde eles podem ser conferidos.",
};

// O predicado `deveMostrarIntro` mora em `constants.ts`, junto dos outros
// validadores puros do formulário: este arquivo exporta só o componente (a regra
// do fast refresh não deixa misturar).

export function IntroSubmissao({
  onProsseguir,
  demo = false,
}: {
  onProsseguir: () => void;
  // Sandbox `/fluxos` (admin): a intro é só uma TELA a inspecionar. O bloqueio
  // temporário é uma pura função do relógio e travaria o botão dentro da janela,
  // impedindo o dry-run — que nunca envia nada (backend mockado). No demo,
  // ignoramos o bloqueio por completo (sem faixa, botão liberado).
  demo?: boolean;
}) {
  // Foco no topo do conteúdo (não no botão): o leitor de tela começa a ler a
  // apresentação em vez de anunciar "Ok, entendi, botão" antes do texto.
  const inicioRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    inicioRef.current?.focus();
  }, []);
  // Bloqueio temporário de novas submissões (a intro só aparece em submissão nova —
  // exatamente o que a janela pausa). Ver src/lib/bloqueio-submissao.ts. No sandbox
  // (demo) o bloqueio é neutralizado: é uma view dry-run, não uma submissão real.
  const bloqueioReal = useBloqueioSubmissao();
  const bloqueio = demo
    ? { fase: "livre" as const, bloqueado: false, mensagem: null }
    : bloqueioReal;

  return (
    <PageFrame>
      <div className="relative z-[1] mx-auto w-full max-w-[680px] px-[var(--space-5,24px)] py-[var(--space-7,48px)] pb-[var(--space-6,32px)]">
        <PageHeader />

        <div
          className="relative overflow-hidden bg-[var(--go-white)]"
          style={{
            border: "1px solid rgba(0,89,169,0.08)",
            borderRadius: "var(--go-radius-xl)",
            padding: "32px 32px 24px",
            boxShadow: "var(--go-shadow-lg)",
            animation: "go-fade-in-up 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
          }}
        >
          {/* Mesma barra de gradiente do card do wizard. */}
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{
              background:
                "linear-gradient(90deg, var(--go-blue) 0%, var(--go-blue) 60%, var(--go-lime) 100%)",
            }}
          />

          <BrowserDots />

          {/* Azul cheio, não lavado: `rgba(0,89,169,0.55)` dá ~2,6:1 no branco e
              reprova o contraste (regra 11). A hierarquia sai do TAMANHO — 10,5px
              contra os 22px do h2 logo abaixo. */}
          <span
            className="font-semibold uppercase"
            style={{
              fontSize: 10.5,
              letterSpacing: "0.14em",
              color: "var(--go-blue)",
            }}
          >
            Antes de começar
          </span>

          <h2
            ref={inicioRef}
            tabIndex={-1}
            className="mt-1.5 mb-3 font-extrabold leading-tight tracking-tight outline-none"
            style={{ fontSize: 22, color: "var(--go-text-heading)" }}
          >
            Para que serve este formulário
          </h2>

          <p
            className="mb-4"
            style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--go-text-primary)" }}
          >
            O GoDocs é onde o Gogroup documenta suas automações de RPA e IA. Você conta o que a sua
            automação faz e quanto ela já economizou ou gerou; a equipe de RPA &amp; IA valida
            depois.
          </p>

          {/* Entra / não entra: a premissa nº 1 (produção + ganho medido). Fica ACIMA
              das 3 perguntas porque é objetiva — dá para responder sem pensar. */}
          <div
            style={{
              background: "rgba(199,233,253,0.4)",
              border: "1px solid rgba(0,89,169,0.14)",
              borderRadius: "var(--go-radius-md)",
              padding: "12px 14px",
            }}
          >
            <p className="flex items-start gap-2.5" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
              <CircleCheck
                size={16}
                strokeWidth={2.4}
                aria-hidden
                className="mt-[2px] shrink-0"
                style={{ color: "var(--go-blue)" }}
              />
              <span style={{ color: "var(--go-text-primary)" }}>
                <strong style={{ color: "var(--go-blue)", fontWeight: 600 }}>Entra aqui:</strong>{" "}
                automação <strong style={{ fontWeight: 600 }}>já em produção</strong>, com o ganho{" "}
                <strong style={{ fontWeight: 600 }}>já medido</strong>.
              </span>
            </p>
            <p
              className="mt-1.5 flex items-start gap-2.5"
              style={{ fontSize: 12.5, lineHeight: 1.5 }}
            >
              <CircleSlash2
                size={16}
                strokeWidth={2.2}
                aria-hidden
                className="mt-[2px] shrink-0"
                style={{ color: "#64748B" }}
              />
              <span style={{ color: "#475569" }}>
                <strong style={{ fontWeight: 600 }}>Não entra:</strong> ideia, projeto em construção
                ou ganho estimado para o futuro.
              </span>
            </p>
          </div>

          <div className="my-6" style={{ height: 1, background: "rgba(0,89,169,0.08)" }} />

          {/* A régua de "isto é projeto?" — recorrência · contrafactual ·
              rastreabilidade. É a MESMA régua que o analisador aplica depois
              (`SPEC_CRITERIOS_PROJETO.md`, docs/criterios-projeto-recorrencia-evidencia.md),
              e a mais cara de descobrir tarde: quem não tem resposta para a 3ª
              trava na seção "Ponteiro movido e onde verificar", no meio do chat.
              Aqui elas são PERGUNTAS para a pessoa responder a si mesma — não um
              formulário e não uma barreira. */}
          {/* Não repetir o eyebrow "Antes de começar" — o título aqui é a PERGUNTA,
              porque é o que a pessoa tem de fazer com a lista abaixo. */}
          <h3 className="mb-1 font-bold" style={{ fontSize: 15, color: "var(--go-text-heading)" }}>
            Seu projeto responde a estas 3 perguntas?
          </h3>
          <p className="mb-4" style={{ fontSize: 13, lineHeight: 1.55, color: "#475569" }}>
            São as 3 perguntas que a equipe de RPA &amp; IA usa para julgar se algo é projeto. Ter a
            resposta na ponta da língua encurta muito a conversa com o agente na Etapa 3.
          </p>

          {/* Sem numeração: os 3 critérios não são uma sequência (≠ as etapas
              abaixo, onde a ordem é real). O que os separa é o NOME. */}
          <ul className="mb-4 list-none">
            {CRITERIOS.map((c) => (
              <li
                key={c.nome}
                className="mb-3 last:mb-0"
                style={{
                  borderLeft: "2.5px solid var(--go-lime)",
                  paddingLeft: 14,
                }}
              >
                <p
                  className="font-semibold"
                  style={{ fontSize: 13.5, color: "var(--go-blue)", lineHeight: 1.45 }}
                >
                  {c.nome}
                </p>
                <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--go-text-primary)" }}>
                  {c.pergunta}
                </p>
              </li>
            ))}
          </ul>

          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#475569" }}>
            Não travou nada se você ainda não souber alguma: o agente ajuda a montar a resposta, e o
            que ficar em aberto vai para a revisão humana.
          </p>

          <div className="my-6" style={{ height: 1, background: "rgba(0,89,169,0.08)" }} />

          <h3 className="mb-4 font-bold" style={{ fontSize: 15, color: "var(--go-text-heading)" }}>
            Como submeter
          </h3>

          {/* A trilha: o `WizardProgress` na vertical. */}
          <ol className="list-none">
            {STEPS.map((s, idx) => (
              <li
                key={s.id}
                className="flex gap-3.5"
                style={{
                  animation: "go-field-up 0.4s cubic-bezier(0.4, 0, 0.2, 1) both",
                  animationDelay: `${120 + idx * 70}ms`,
                }}
              >
                {/* Coluna do marcador: círculo + trilho até o próximo. */}
                <div className="flex shrink-0 flex-col items-center">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: "var(--go-blue)",
                      color: "var(--go-white)",
                      border: "2.5px solid var(--go-blue)",
                    }}
                    aria-hidden
                  >
                    {s.id}
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div
                      className="flex-1"
                      style={{
                        width: "2.5px",
                        minHeight: 18,
                        background: "rgba(0,89,169,0.14)",
                        borderRadius: 2,
                      }}
                    />
                  )}
                </div>

                <div className={idx < STEPS.length - 1 ? "pb-5" : undefined}>
                  <p
                    className="font-semibold uppercase"
                    style={{
                      fontSize: 10.5,
                      letterSpacing: "0.05em",
                      color: "var(--go-blue)",
                      lineHeight: "20px",
                    }}
                  >
                    Etapa {s.id} &middot; {s.label}
                  </p>
                  <p
                    className="mt-0.5"
                    style={{ fontSize: 14, lineHeight: 1.6, color: "var(--go-text-primary)" }}
                  >
                    {RESUMO_ETAPAS[s.id]}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* Barra de ação — mesma disposição da navegação do wizard: o que avança
              fica à direita. NÃO prometemos "salve como rascunho e continue depois"
              aqui: o rascunho só nasce quando se sobem arquivos na Etapa 2
              (`dispararDocBackground` → `iniciar-submissao`), então na Etapa 1 a
              pessoa procuraria um botão que ainda não existe. */}
          {/* Aviso do bloqueio temporário (prévio ou pausado). */}
          <AvisoBloqueioSubmissao fase={bloqueio.fase} mensagem={bloqueio.mensagem} className="mt-6" />

          <div
            className="mt-7 flex items-center justify-end border-t pt-5"
            style={{ borderColor: "rgba(0,89,169,0.08)" }}
          >
            <button
              type="button"
              className="go-btn-next"
              onClick={onProsseguir}
              disabled={bloqueio.bloqueado}
              aria-disabled={bloqueio.bloqueado}
              title={bloqueio.bloqueado ? "As submissões estão pausadas no momento." : undefined}
              style={
                bloqueio.bloqueado ? { opacity: 0.5, cursor: "not-allowed" } : undefined
              }
            >
              Ok, entendi
              <ArrowRight
                size={15}
                strokeWidth={2.6}
                aria-hidden
                className="ml-1.5 inline align-[-2px]"
              />
            </button>
          </div>
        </div>

        <PageFooter />
      </div>
    </PageFrame>
  );
}
