/**
 * Filtros da triagem — painel que ABRE, e pílulas do que está ligado.
 *
 * ## Por que deixou de ser uma barra
 * Os recortes eram oito controles soltos em duas faixas, sempre na tela: dois `<select>`
 * de área e pré-status, mais natureza, categorias, período, nota, agente e "autores com
 * 2+". Ocupavam quatro linhas antes do primeiro projeto aparecer, e a pergunta que a
 * triagem faz ("o que estou vendo agora?") não tinha resposta em lugar nenhum — a lista
 * encolhia e o motivo estava espalhado por oito campos.
 *
 * Agora: a barra tem **busca + um botão + as pílulas do que está ligado**. Tudo o mais mora
 * no painel, fechado por padrão. O que está recortando a lista vira texto legível, e cada
 * pílula desliga a própria dimensão.
 *
 * ⚠️ O painel é INLINE (abre empurrando a tela), não um popover: dentro dele há três
 * controles que já usam portal (período, nota, categorias), e popover dentro de popover
 * fecha um ao abrir o outro.
 */
import { useState } from "react";
import { SlidersHorizontal, X, Search, Users, ChevronDown } from "lucide-react";
import { SeletorPeriodo } from "@/components/calendario/calendario";
import { FiltroEstrelas } from "@/components/dashboard/filtro-estrelas";
import { FiltroCategorias } from "@/components/dashboard/filtro-categorias";
import { ROTULO_ESTADO_PARECER } from "@/lib/aprovacoes-parecer";
import {
  FILTROS_VAZIOS,
  TODAS_AS_AREAS,
  TODOS_OS_PARECERES,
  contarFiltrosAtivos,
  descreverFiltrosAtivos,
  limparDimensao,
  type CategoriaFiltroGanho,
  type FiltroAgente,
  type FiltroEspecial,
  type FiltroParecer,
  type FiltrosDashboard,
} from "@/lib/dashboard-filtros";
import type { EstadoParecer } from "@/lib/aprovacoes-parecer";

const AZUL = "var(--go-blue)";

export function BarraFiltros({
  filtros,
  setFiltros,
  busca,
  setBusca,
  areas,
  pareceres,
  categorias,
  contagemAgente,
  hoje,
  ordenarMaisAntigos,
  onOrdenarMaisAntigos,
  buscaRef,
}: {
  filtros: FiltrosDashboard;
  setFiltros: (atualiza: (f: FiltrosDashboard) => FiltrosDashboard) => void;
  busca: string;
  setBusca: (v: string) => void;
  areas: string[];
  pareceres: { estado: EstadoParecer; total: number }[];
  categorias: { categoria: CategoriaFiltroGanho; total: number }[];
  contagemAgente: { sem: number; com: number };
  hoje: string;
  ordenarMaisAntigos: boolean;
  onOrdenarMaisAntigos: (v: boolean) => void;
  buscaRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [aberto, setAberto] = useState(false);
  const ativos = contarFiltrosAtivos(filtros);
  const chips = descreverFiltrosAtivos(filtros);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            placeholder="Buscar por projeto, autor, e-mail, área ou ID   ( / )"
            aria-label="Buscar projetos"
            className="h-10 w-full rounded-full border border-input bg-card pl-9 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{ ["--tw-ring-color" as string]: AZUL }}
          />
          {busca && (
            <button
              type="button"
              onClick={() => {
                setBusca("");
                buscaRef.current?.focus();
              }}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
          className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          style={{
            background: ativos > 0 ? AZUL : "var(--card)",
            color: ativos > 0 ? "#fff" : "var(--foreground)",
            borderColor: ativos > 0 ? AZUL : "var(--border)",
            ["--tw-ring-color" as string]: AZUL,
          }}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filtros
          {ativos > 0 && (
            <span className="rounded-full bg-white/25 px-1.5 text-[11.5px] font-semibold tabular-nums">
              {ativos}
            </span>
          )}
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform motion-reduce:transition-none"
            style={{ transform: aberto ? "rotate(180deg)" : undefined }}
            aria-hidden
          />
        </button>
      </div>

      {/* O que está recortando a lista, em texto, com o X de cada dimensão. */}
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.chave}
              className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[11.5px] font-medium"
              style={{
                borderColor: "rgba(0,89,169,0.35)",
                color: AZUL,
                background: "rgba(0,89,169,0.06)",
              }}
            >
              {c.rotulo}
              <button
                type="button"
                onClick={() => setFiltros((f) => limparDimensao(f, c.chave))}
                aria-label={`Remover o filtro ${c.rotulo}`}
                className="rounded-full p-0.5 transition-colors hover:bg-[rgba(0,89,169,0.15)] focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
                style={{ ["--tw-ring-color" as string]: AZUL }}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setFiltros((f) => ({ ...FILTROS_VAZIOS, status: f.status }))}
            className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            Limpar tudo
          </button>
        </div>
      )}

      {aberto && (
        <div className="mt-3 grid gap-x-6 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Natureza">
            <Segmentado
              valor={filtros.especial}
              opcoes={[
                { valor: "todos", label: "Todos" },
                { valor: "apenas", label: "Especiais" },
                { valor: "sem", label: "Padrão" },
              ]}
              onChange={(v) => setFiltros((f) => ({ ...f, especial: v as FiltroEspecial }))}
            />
          </Campo>

          <Campo rotulo="Categorias de ganho">
            <FiltroCategorias
              selecionadas={filtros.categorias}
              disponiveis={categorias}
              onChange={(proximas: CategoriaFiltroGanho[]) =>
                setFiltros((f) => ({ ...f, categorias: proximas }))
              }
            />
          </Campo>

          <Campo rotulo="Período de envio">
            <SeletorPeriodo
              valor={filtros.periodo}
              maximo={hoje}
              onChange={(periodo) => setFiltros((f) => ({ ...f, periodo }))}
              ordenarMaisAntigos={ordenarMaisAntigos}
              onOrdenarMaisAntigos={onOrdenarMaisAntigos}
            />
          </Campo>

          <Campo rotulo="Nota da triagem">
            <FiltroEstrelas
              min={filtros.estrelasMin}
              max={filtros.estrelasMax}
              onChange={(estrelasMin, estrelasMax) =>
                setFiltros((f) => ({ ...f, estrelasMin, estrelasMax }))
              }
            />
          </Campo>

          <Campo rotulo="Área">
            <select
              aria-label="Filtrar por área"
              value={filtros.area}
              onChange={(e) => setFiltros((f) => ({ ...f, area: e.target.value }))}
              className="h-9 w-full rounded-full border border-input bg-card px-3 text-[12.5px] shadow-sm focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{
                ["--tw-ring-color" as string]: AZUL,
                borderColor: filtros.area !== TODAS_AS_AREAS ? AZUL : undefined,
                color: filtros.area !== TODAS_AS_AREAS ? AZUL : undefined,
                fontWeight: filtros.area !== TODAS_AS_AREAS ? 600 : 400,
              }}
            >
              <option value={TODAS_AS_AREAS}>Todas as áreas</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Pré-aprovação do líder">
            <select
              aria-label="Filtrar pela pré-aprovação do líder"
              value={filtros.parecer}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, parecer: e.target.value as FiltroParecer }))
              }
              className="h-9 w-full rounded-full border border-input bg-card px-3 text-[12.5px] shadow-sm focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{
                ["--tw-ring-color" as string]: AZUL,
                borderColor: filtros.parecer !== TODOS_OS_PARECERES ? AZUL : undefined,
                color: filtros.parecer !== TODOS_OS_PARECERES ? AZUL : undefined,
                fontWeight: filtros.parecer !== TODOS_OS_PARECERES ? 600 : 400,
              }}
            >
              <option value={TODOS_OS_PARECERES}>Qualquer pré-status</option>
              {pareceres.map(({ estado, total }) => (
                <option key={estado} value={estado}>
                  {ROTULO_ESTADO_PARECER[estado]} ({total})
                </option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Análise do agente">
            <select
              aria-label="Filtrar por análise do agente"
              value={filtros.agente}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, agente: e.target.value as FiltroAgente }))
              }
              className="h-9 w-full rounded-full border border-input bg-card px-3 text-[12.5px] shadow-sm focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{
                ["--tw-ring-color" as string]: AZUL,
                borderColor: filtros.agente !== "todos" ? AZUL : undefined,
                color: filtros.agente !== "todos" ? AZUL : undefined,
                fontWeight: filtros.agente !== "todos" ? 600 : 400,
              }}
            >
              <option value="todos">Qualquer</option>
              <option value="sem">Ainda sem análise ({contagemAgente.sem})</option>
              <option value="com">Já analisados ({contagemAgente.com})</option>
            </select>
          </Campo>

          <Campo rotulo="Autores">
            <button
              type="button"
              aria-pressed={filtros.soMultiplos}
              onClick={() => setFiltros((f) => ({ ...f, soMultiplos: !f.soMultiplos }))}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{
                background: filtros.soMultiplos ? AZUL : "var(--card)",
                color: filtros.soMultiplos ? "#fff" : "var(--foreground)",
                borderColor: filtros.soMultiplos ? AZUL : "var(--border)",
                ["--tw-ring-color" as string]: AZUL,
              }}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              Só quem tem 2 ou mais
            </button>
          </Campo>
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

/** Escolha única em botões colados. Estado dito por fundo, peso e `aria-pressed`. */
function Segmentado({
  valor,
  opcoes,
  onChange,
}: {
  valor: string;
  opcoes: { valor: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-full border bg-card p-0.5 shadow-sm">
      {opcoes.map((o) => {
        const ativo = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.valor)}
            className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
            style={{
              background: ativo ? AZUL : "transparent",
              color: ativo ? "#fff" : "var(--muted-foreground)",
              fontWeight: ativo ? 600 : 400,
              ["--tw-ring-color" as string]: AZUL,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
