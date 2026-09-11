/**
 * Detalhe de um projeto em overlay — a ficha de triagem.
 *
 * Mostra a linha INTEIRA da planilha (é isso que o validador precisa ver sem sair da
 * tela) agrupada por assunto, e é onde o status é decidido. Os grupos abaixo listam as
 * colunas por NOME: se uma coluna nova aparecer na planilha e não estiver em nenhum
 * grupo, ela cai em "Outras colunas" — nunca desaparece.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  ExternalLink,
  Save,
  History,
  FileText,
  Star,
  RotateCcw,
  ThumbsDown,
  Bot,
  ChevronDown,
  AlertTriangle,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { rotuloNotaAgente } from '@/lib/estrelas-regua';
import { ReguaEstrela, verboDaNota } from '@/components/dashboard/regua-estrela';
import { StatusBadge } from '@/components/status-badge';
import { ParecerLiderPainel } from '@/components/dashboard/parecer-lider';
import { apiFetch } from '@/lib/api-client';
import { obterDetalhe, invalidarDetalhe } from '@/lib/dashboard-detalhe-cache';
import { fmtDataBR } from '@/lib/format-date';
import {
  COLUNA_ESTADO_LIDER,
  COLUNA_JUSTIFICATIVA_LIDER,
  interpretarParecerLider,
} from '@/lib/aprovacoes-parecer';
import { chaveColuna } from '@/lib/coluna-chave';
import { rotuloColuna } from '@/lib/coluna-rotulo';
import {
  rotuloVeredito,
  rotuloEstadoDeliberacao,
  rotuloResultadoRetroativo,
  rotuloGrau,
  grauConfianca,
  aparenciaConfianca,
  aparenciaGrauTexto,
} from '@/lib/avaliacao-sombra-rotulos';
import { partirParecerMesa, ROTULO_CURTO_DIMENSAO } from '@/lib/mesa-parecer';
import {
  DiscordanciaForm,
  type DadosDiscordancia,
} from '@/components/dashboard/discordancia-form';
import type { ContribuicaoParticipante } from '@/lib/participantes-contribuicoes';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-admin.functions';

// Os status graváveis são replicados aqui (não importados de `.functions.ts`) para o
// bundle do cliente não arrastar o módulo server-only. O servidor valida de novo.
const STATUS_OPCOES = [
  'Pendente',
  'Em validação',
  'Aprovado',
  'Reenvio Pendente',
  'Reprovado',
  'Descontinuado',
] as const;

type HistoricoEntrada =
  | {
      tipo: 'status';
      status_anterior: string | null;
      status_novo: string;
      observacoes: string | null;
      admin_email: string;
      created_at: string | null;
    }
  | {
      tipo: 'reenvio';
      edicao: number;
      submetido_por: string | null;
      created_at: string | null;
    };

type AvaliacaoSombra = {
  mesa: {
    veredito: string;
    confianca: number | null;
    divergencia: boolean;
    aplicar: boolean;
    motivo: string | null;
  } | null;
  /**
   * O parecer dos QUATRO agentes, com o argumento de cada um — inclusive de quem NÃO preocupou.
   * ⚠️ É isto que a tela exibe agora. O `mesa.motivo` só carrega a objeção de quem preocupou NA
   * ÚLTIMA rodada, e por isso o painel mostrava 4 porquês numa abertura e 2 na seguinte.
   * `[]` em avaliação antiga (gravada antes de o argumento ser persistido) → cai no `motivo`.
   */
  especialistas?: { dimensao: string; preocupa: boolean; argumento: string; confianca: number | null }[];
  /**
   * A ESTRELA sugerida pelo classificador de 1 agente. `null` = ninguém rodou aqui ainda.
   * ⚠️ É esta que o botão roda: o time completo (30 chamadas) não cabe num clique — em prod o
   * `waitUntil` foi cancelado no meio dele e a estrela nunca chegava.
   */
  estrela?: {
    estrelas: number;
    confianca: string | null;
    leitura: string | null;
    contestada: boolean;
    quando: string | null;
  } | null;
  /** Último veredito do TIME completo (auditoria em lote). `null` = nunca rodou aqui. */
  time?: {
    estrela: number | null;
    /** Faixa 6-10 indicada: aí o número (travado em 5) NÃO é a nota. Ver o servidor. */
    escape: boolean;
    saida: string | null;
    confianca: string | null;
    quando: string | null;
    motivos: string[];
    divergencias: string[];
  } | null;
  deliberacao: {
    estado: string;
    grau: string | null;
    rodada: number;
    motivo: string | null;
    /** Rodadas da deliberação (parecer + confiança de cada uma). `[]` quando veio pelo lote. */
    historico?: {
      rodada: number;
      estado: string | null;
      confianca: number | null;
      motivo: string | null;
    }[];
  } | null;
  retroativo: {
    resultado: string;
    veredito_agregado: string | null;
    veredito_humano: string | null;
    grau: string | null;
    motivo: string | null;
  } | null;
};

type Detalhe = {
  id: string;
  campos: Record<string, string>;
  historico: HistoricoEntrada[];
  // Contrafactual da Etapa 2 ("quem sentiria falta"): vem do SQLite, não da planilha.
  contrafactual: { tipo: 'pessoa' | 'time'; lista: string[] } | null;
  /** O que cada participante fez — do SQLite, como o contrafactual (nunca da planilha). */
  pessoas?: ContribuicaoParticipante[];
  /** Avaliação em SOMBRA do time de agentes (teste sombra). NADA disto muda o status. */
  avaliacaoSombra?: AvaliacaoSombra | null;
  /** Voto do admin sobre a recomendação em sombra. */
  feedback?: 'like' | 'dislike' | null;
  // Pré-aprovação do estágio 2 (líder do dono do projeto PAI) — só quando é feature de
  // outro projeto. Vem do SQLite (o estágio 2 não tem coluna no Sheets).
  preAprovacaoPai?: { estado: string; justificativa: string } | null;
};

type Grupo = { titulo: string; colunas: string[] };

const GRUPOS: Grupo[] = [
  {
    titulo: 'Identificação',
    colunas: [
      'ID Projeto',
      'Data Submissão',
      'Data Criação',
      'Atualizado Em',
      'Área',
      'Nome Completo',
      'Email',
      'Coautor',
      'Participante',
      'Contribuidor',
      'Tipos de Ganho',
      'Ferramenta',
      'Escopo',
      'Especial?',
      'Ganho Imensurável',
      'Usa AI Proxy',
      'URL',
    ],
  },
  {
    titulo: 'Saving e horas',
    colunas: [
      'Alguém Fazia?',
      'Freq. Custo Evitado',
      'Custo Evitado Horas',
      'Saving Horas Real',
      'Saving Horas Escalado',
      'Custo Evitado Horas Reais',
      'Impacto Bruto',
      'Diff Horas / Antes',
      'Diff Saving / Antes',
    ],
  },
  {
    titulo: 'Custos e receita',
    colunas: [
      'Saving Efetivado',
      'Freq. Saving Efetivado',
      'Evidência Saving Efetivado',
      'Custo Externo Mensal',
      'Custo para Rodar',
      'Freq. Custo para Rodar',
      'Justificativa Custo para Rodar',
      'Receita Incremental',
      'Freq. Receita',
      'Impacto Líquido',
    ],
  },
  {
    titulo: 'Análise',
    colunas: [
      'Status',
      'Complexidade',
      // Régua de critério de projeto: a classificação vem SEMPRE com a justificativa;
      // os motivos explicam a reprovação (analisador/triagem) e o pedido de reenvio.
      'Classificação',
      'Motivo Reprovado',
      'Motivo Reenvio',
      'Observações',
      'Alocação Ganhos',
      'Racional Custo Evitado',
      'Análise Antiagente',
    ],
  },
];

/** Textos longos: vão em bloco de largura cheia, dentro de um `<details>`. */
const MEMORIAIS = ['Memorial de Saving', 'Racional Receita', 'Memorial anterior'];

/** A descrição abre a ficha (é a primeira coisa que a triagem lê). */
const DESCRICAO = 'Descrição';

/** Colunas já exibidas no cabeçalho — não repetir no corpo. */
// "Estrelas" tem controle PRÓPRIO na Decisão da triagem — sem isto, apareceria também
// como texto cru em "Outras colunas", e a pessoa teria dois lugares dizendo a mesma nota.
const NO_CABECALHO = ['Projeto', 'Estrelas'];

/**
 * A escala da triagem vai até **10 estrelas** (decisão do Luis, 18/08/2026) e as 10 ficam
 * TODAS visíveis — antes a fileira nascia com 5 e crescia por um botão "+", o que escondia
 * metade da escala atrás de um clique de descoberta.
 *
 * ⚠️ Não é um recorte do valor: nota LEGADA acima de 10 (a planilha aceitava mais) continua
 * desenhando a fileira inteira até ela, senão salvar rebaixaria a nota de outra pessoa — foi
 * exatamente o bug do `Math.min(nota, 5)`.
 */
const ESCALA_ESTRELAS = 10;

/**
 * Sanidade da célula, espelhando o `MAX_ESTRELAS_GRAVAVEL` do servidor (replicado, não
 * importado, para o bundle do cliente não arrastar o módulo server-only — mesma razão do
 * `STATUS_OPCOES` acima).
 */
const MAX_ESTRELAS_GRAVAVEL = 100;

function lerEstrelas(valor: string | undefined): number {
  const n = Number(String(valor ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * Nota da triagem — grupo de rádio (`radiogroup`, com as setas do teclado), não N botões
 * soltos: é UMA escolha entre opções mutuamente exclusivas.
 *
 * As 10 estrelas da escala aparecem de uma vez, em **duas linhas de 5** (decisão do Luis,
 * 18/08/2026): numa fileira corrida de 10 ninguém distingue a 7ª da 8ª de relance, e a
 * quebra em 5 + 5 dá o ponto de apoio da conta. Nota legada acima de 10 vira uma 3ª linha.
 *
 * ⚠️ A nota nunca é dita só pelo preenchimento da estrela: o número fica ao lado, em
 * texto, e cada estrela tem `aria-label` própria.
 */
function NotaEstrelas({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  const [previa, setPrevia] = useState<number | null>(null);
  const mostrado = previa ?? valor;
  // 10 é a escala; a fileira só passa disso para não rebaixar uma nota legada já gravada.
  const quantas = Math.min(MAX_ESTRELAS_GRAVAVEL, Math.max(ESCALA_ESTRELAS, valor));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={`Nota do projeto, de 0 a ${quantas} estrelas`}
        className="grid w-max grid-cols-5 gap-1"
        onMouseLeave={() => setPrevia(null)}
      >
        {Array.from({ length: quantas }, (_, i) => i + 1).map((n) => {
          const cheia = n <= mostrado;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={valor === n}
              aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
              // Clicar de novo na estrela atual zera — é como se tira a nota sem um
              // "limpar" extra ocupando a linha.
              onClick={() => onChange(valor === n ? 0 : n)}
              onMouseEnter={() => setPrevia(n)}
              onFocus={() => setPrevia(n)}
              onBlur={() => setPrevia(null)}
              className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              style={{ ['--tw-ring-color' as string]: 'var(--go-blue)' }}
            >
              <Star
                className="h-6 w-6"
                style={{ color: cheia ? '#e0a800' : 'var(--muted-foreground)', opacity: cheia ? 1 : 0.4 }}
                fill={cheia ? '#f5c518' : 'none'}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      {/* A nota também vem em número, num chip ao lado: com 10 casas, contar estrela por
          estrela é trabalho que a tela pode poupar. */}
      {valor === 0 ? (
        <span className="text-[12px] text-muted-foreground">sem nota</span>
      ) : (
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums"
          style={{ background: 'rgba(224,168,0,0.14)', color: '#8a6a00' }}
        >
          {valor} {valor === 1 ? 'estrela' : 'estrelas'}
        </span>
      )}
    </div>
  );
}

const LIMITE_CURTO = 90; // acima disso o campo ocupa a linha inteira

function ehUrl(v: string) {
  return /^https?:\/\//i.test(v.trim());
}

function Campo({ nome, valor }: { nome: string; valor: string }) {
  const longo = valor.length > LIMITE_CURTO;
  return (
    <div className={longo ? 'sm:col-span-2' : undefined}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {/* Rótulo de exibição: as colunas de papel se chamam "Coautor"/"Participante"
            na planilha, mas quem submeteu escolheu "Coautor"/"Participante" — a ficha fala a
            língua do formulário. A CHAVE da célula continua sendo o nome da coluna. */}
        {rotuloColuna(nome)}
      </dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed text-foreground">
        {ehUrl(valor) ? (
          <a
            href={valor}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all underline underline-offset-2"
            style={{ color: 'var(--go-blue)' }}
          >
            Abrir link <ExternalLink className="h-3 w-3" />
          </a>
        ) : longo ? (
          <span className="whitespace-pre-wrap">{valor}</span>
        ) : (
          <span className="tabular-nums">{valor}</span>
        )}
      </dd>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3
        className="mb-2 border-b pb-1 text-[11px] font-bold uppercase tracking-[0.1em]"
        style={{ color: 'var(--go-blue)', borderColor: 'rgba(0,89,169,0.15)' }}
      >
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/**
 * Confiança em destaque: **só o GRAU**, em palavra, colorido por ele. `compacta` é a versão da
 * linha colapsada — mesmo componente para a tela não ter duas réguas de cor/arredondamento.
 *
 * ⚠️ **Nenhum número** (decisão do Luis, 08/09/2026). Saíram, nesta ordem: o **percentual** do
 * float interno (`pctConfianca`, removida — é o placar da votação, que com 4 especialistas só
 * podia valer 43%, 71% e alguns vizinhos) e a **frequência medida** ("8 de 10 · N casos"), que era
 * honesta mas *"uma boa ideia para contornar a confiança"* — contorno, não solução. O que importa
 * é o agente avaliar bem. A medição segue viva onde decide algo: `politicaDeLiberacao` e o
 * relatório do retroativo.
 */
function ConfiancaDestaque({ conf, compacta }: { conf: number | null; compacta?: boolean }) {
  const a = aparenciaConfianca(conf);
  const grau = typeof conf === 'number' ? grauConfianca(conf) : null;
  return (
    <span
      className={`inline-flex items-baseline rounded-lg ${compacta ? 'gap-1 px-2 py-0.5' : 'gap-1.5 px-2.5 py-1'}`}
      style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
    >
      <span className={`font-semibold ${compacta ? 'text-[11px]' : 'text-[13px]'}`}>
        {rotuloGrau(grau)}
      </span>
    </span>
  );
}

/** Saída do time → rótulo curto. Desconhecida cai no valor cru (nunca num texto falso). */
function rotuloSaidaTime(saida: string): string {
  switch (saida) {
    case 'aprovar':
      return 'Aprovar';
    case 'ajuste':
      return 'Pedir ajuste';
    case 'humano':
      return 'Decisão humana';
    case 'reprovar':
      return 'Reprovar';
    default:
      return saida;
  }
}

/**
 * O parecer dos QUATRO agentes: um por linha, com o veredito de cada um em RÓTULO (nunca só cor) e
 * o porquê inteiro — sem `line-clamp`, que era o que cortava o texto com reticências.
 */
function ParecerDosAgentes({
  itens,
}: {
  itens: { dimensao: string; preocupa: boolean; argumento: string; confianca: number | null }[];
}) {
  return (
    <ul className="space-y-2">
      {itens.map((a) => {
        const cor = a.preocupa ? '#8a5a00' : '#186a3b';
        const fundo = a.preocupa ? 'rgba(138,90,0,0.10)' : 'rgba(24,106,59,0.09)';
        return (
          <li key={a.dimensao} className="text-[12.5px] leading-relaxed">
            <span className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold" style={{ color: '#475569' }}>
                {ROTULO_CURTO_DIMENSAO[a.dimensao as keyof typeof ROTULO_CURTO_DIMENSAO] ?? a.dimensao}
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold"
                style={{ background: fundo, border: `1px solid ${cor}55`, color: cor }}
              >
                {a.preocupa ? (
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                ) : (
                  <Check className="h-3 w-3" aria-hidden />
                )}
                {a.preocupa ? 'Aponta problema' : 'Sem ressalva'}
              </span>
            </span>
            {a.argumento ? (
              <p className="text-muted-foreground">{a.argumento}</p>
            ) : (
              <p className="text-muted-foreground">Nada a apontar neste eixo.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A ESTRELA sugerida pelo agente classificador + a leitura dele.
 *
 * ⚠️ Sem botão de aplicar: quem grava a coluna "Estrelas" é a triagem, no campo do topo da ficha.
 */
function EstrelaSugerida({ estrela }: { estrela: NonNullable<AvaliacaoSombra['estrela']> }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: 'rgba(0,89,169,0.22)', background: 'rgba(0,89,169,0.05)' }}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: '#0059A9' }}>
          Estrela sugerida
        </span>
        <span className="inline-flex items-baseline gap-1 text-[15px] font-bold" style={{ color: '#0059A9' }}>
          {estrela.estrelas}
          <Star className="h-3.5 w-3.5 self-center" aria-hidden />
        </span>
        {estrela.confianca && (
          <span className="text-[11.5px] font-semibold" style={{ color: aparenciaGrauTexto(estrela.confianca).cor }}>
                    confiança {estrela.confianca}
                  </span>
        )}
        {estrela.contestada && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[10.5px] font-semibold"
            style={{ background: 'rgba(138,90,0,0.12)', border: '1px solid rgba(138,90,0,0.4)', color: '#8a5a00' }}
          >
            <AlertTriangle className="h-3 w-3" aria-hidden /> Contestada
          </span>
        )}
      </span>
      {estrela.leitura && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{estrela.leitura}</p>
      )}
      {/* ⚠️ Não diz mais "quem grava a nota é a triagem": desde 10/09/2026 o agente escreve a nota
          de 0 a 5 na coluna, e só a faixa 6-10 fica para o comitê. A triagem CORRIGE, que é outra
          coisa — e é o campo acima que serve para isso. */}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Nota do classificador de 1 agente (legado). O número que vale é o do time, abaixo.
      </p>
    </div>
  );
}

/** A estrela recomendada pelo TIME completo (só aparece quando ele rodou em lote). */
function EstrelaDoTime({ time }: { time: NonNullable<AvaliacaoSombra['time']> }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: 'rgba(0,89,169,0.22)', background: 'rgba(0,89,169,0.05)' }}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: '#0059A9' }}>
          Time de agentes
        </span>
        {/* ⚠️ **Na faixa 6-10 o número NÃO é a nota** (10/09/2026): a régua trava a saída do agente
            em 5 (o teto do que ele concede sozinho) e o que ele afirmou está no `escape`. Mostrar
            "5 · Assume" para um projeto que o time mandou ao comitê é dizer o oposto do parecer —
            foi o que aconteceu no «AVD Central v2». Aqui a faixa vem primeiro, e o verbo some:
            dentro dela a régua se recusa a nomear o nível. */}
        {time.escape ? (
          <span className="inline-flex items-baseline gap-1 text-[13.5px] font-bold" style={{ color: '#0059A9' }}>
            faixa 6-10
            <Star className="h-3.5 w-3.5 self-center" aria-hidden />
            <span className="text-[11px] font-semibold">muda o jogo · o comitê crava o número</span>
          </span>
        ) : (
          time.estrela != null && (
            <span className="inline-flex items-baseline gap-1 text-[13.5px] font-bold" style={{ color: '#0059A9' }}>
              {time.estrela}
              <Star className="h-3.5 w-3.5 self-center" aria-hidden />
              {/* ⚠️ O VERBO ao lado do número: "2" sozinho não é revisável, "2 · Executa" é. Sai da
                  fonte única da régua, a mesma que o agente recebe. */}
              <span className="text-[11px] font-semibold">{verboDaNota(time.estrela) ?? (time.estrela === 1 ? 'estrela' : 'estrelas')}</span>
            </span>
          )
        )}
        {time.saida && (
          <span className="text-[12px] font-semibold" style={{ color: '#475569' }}>
            {rotuloSaidaTime(time.saida)}
          </span>
        )}
        {time.confianca && (
          <span className="text-[11.5px] font-semibold" style={{ color: aparenciaGrauTexto(time.confianca).cor }}>
                    confiança {time.confianca}
                  </span>
        )}
      </span>
      {time.motivos.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {time.motivos.map((m, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed text-muted-foreground">
              {m}
            </li>
          ))}
        </ul>
      )}
      {time.divergencias.length > 0 && (
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: '#8a5a00' }}>
          {time.divergencias.join(' ')}
        </p>
      )}
      {/* ⚠️ Sem botão de aplicar: de 0 a 5 o agente já GRAVOU a nota na coluna, e na faixa 6-10 o
          número é do comitê — não há o que aplicar em nenhum dos dois casos. */}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Esta é a nota que o time gravou. Para mudá-la, use o campo de estrelas acima.
      </p>
      {/* A régua na tela: sem ela, discordar de um 2 é palpite contra palpite.
          ⚠️ Na faixa 6-10 não se passa o 5: o critério do 5★ não é o que o time aplicou. */}
      <ReguaEstrela nota={time.escape ? null : (time.estrela ?? null)} />
    </div>
  );
}

function LinhaSombra({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {rotulo}
      </span>
      <span className="text-[13px]">{children}</span>
    </div>
  );
}

/**
 * Painel da avaliação em SOMBRA — **colapsado por padrão** (pedido do Luis, 01/09/2026).
 *
 * A tira visível responde as duas perguntas que a triagem faz de relance: **o que o agente
 * recomendou** e **quão seguro ele está**. O resto (parecer, deliberação, rodadas, retroativo,
 * voto) vive atrás do dropdown, porque o parecer chegava como um parágrafo de 900 caracteres em
 * cima da ficha e empurrava a decisão humana para fora da vista.
 *
 * A tira INTEIRA é o `<button aria-expanded>` — mesmo idioma do `AvisoPendencia`: alvo generoso e
 * um único stop de teclado. Estado nunca só por cor: chevron + a palavra "Detalhes"/"Ocultar".
 */
function AvaliacaoSombraPainel({
  sombra,
  feedback,
  votando,
  onDiscordar,
  onLimparVoto,
  onRodar,
  rodando,
}: {
  sombra: AvaliacaoSombra;
  /** Dispara a análise: a MESA (rápida) ou o TIME completo (dá a estrela, roda em background). */
  onRodar: (qual: 'time' | 'mesa' | 'estrela') => Promise<void> | void;
  rodando: 'time' | 'mesa' | 'estrela' | null;
  feedback: 'like' | 'dislike' | null;
  votando: boolean;
  /** Registra a discordância COM motivo (o que vira lição). */
  onDiscordar: (dados: DadosDiscordancia) => Promise<void> | void;
  /** Desfaz um voto já dado (inclusive um 👍 legado). */
  onLimparVoto: () => Promise<void> | void;
}) {
  const [formAberto, setFormAberto] = useState(false);
  const { mesa, deliberacao, retroativo } = sombra;
  const time = sombra.time ?? null;
  const estrela = sombra.estrela ?? null;
  const especialistas = sombra.especialistas ?? [];
  const [aberto, setAberto] = useState(false);
  const [rodadasAbertas, setRodadasAbertas] = useState(false);
  // O parecer vem com uma linha por especialista ("Financeiro: ..."); parecer LEGADO (parágrafo
  // corrido, sem prefixo) volta como uma única linha sem autor e é exibido como sempre.
  const linhas = partirParecerMesa(mesa?.motivo);
  const borda = 'rgba(71,85,105,0.28)';
  return (
    <div className="rounded-xl border" style={{ borderColor: borda, background: 'rgba(71,85,105,0.04)' }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls="sombra-detalhes"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0059A9] focus-visible:ring-offset-1"
      >
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]"
          style={{ background: 'rgba(71,85,105,0.12)', color: '#475569' }}
        >
          {/* ⚠️ Era "Sombra", e virou mentira em 10/09/2026: o agente passou a GRAVAR o Status
              (Aprovado/Reprovado) e a nota de 0 a 5. Rótulo que descreve um modo que acabou é pior
              que rótulo nenhum — quem tria lê "sombra" e ignora uma decisão que já valeu. */}
          <Bot className="h-3 w-3" aria-hidden /> Time de agentes
        </span>
        {mesa ? (
          <>
            <span className="text-[13.5px] font-semibold">{rotuloVeredito(mesa.veredito)}</span>
            <ConfiancaDestaque conf={mesa.confianca} compacta />
            {mesa.divergencia && (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                style={{
                  background: 'rgba(138,90,0,0.12)',
                  border: '1px solid rgba(138,90,0,0.4)',
                  color: '#8a5a00',
                }}
              >
                Divergiram
              </span>
            )}
            {/* ⚠️ A ORDEM inverteu em 10/09/2026: mostrava a nota do classificador de 1 agente e
                caía na do time só como fallback, então a mesma tela exibia 4 (classificador), 5
                (time) e a faixa 6-10 em prosa — três respostas para "qual é a nota". Quem decide
                é o TIME; o classificador virou legado aqui. */}
            {(time?.estrela ?? estrela?.estrelas) != null &&
              (() => {
                const n = (time?.estrela ?? estrela?.estrelas) as number;
                const { rotulo } = rotuloNotaAgente(n);
                const escape = rotulo !== String(n);
                // ⚠️ **A FAIXA 6-10 É DESTAQUE, não prosa** (pedido do Luis, 10/09/2026, olhando a
                // ficha do «AVD Central v2»): ela estava escondida no 3º parágrafo do painel
                // enquanto o cabeçalho mostrava "4 sugeridas", e a triagem tinha de ler o texto
                // inteiro para descobrir que o desfecho real era "falta cravar de 6 a 10".
                // O rótulo sai de `rotuloNotaAgente`, a MESMA fonte da planilha e do chip da lista.
                // ⚠️ Estado nunca só por cor: a faixa vem com a palavra "faixa" e o que falta.
                return escape ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: 'rgba(138,90,0,0.12)', border: '1px solid rgba(138,90,0,0.45)', color: '#8a5a00' }}
                  >
                    <Star className="h-3 w-3" aria-hidden />
                    faixa {rotulo} · falta o comitê cravar
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: 'rgba(0,89,169,0.09)', border: '1px solid rgba(0,89,169,0.3)', color: '#0059A9' }}
                  >
                    {rotulo}
                    <Star className="h-3 w-3" aria-hidden />
                    <span className="font-semibold">do time</span>
                  </span>
                );
              })()}
          </>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">Sem recomendação ainda</span>
        )}
        <span
          className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold"
          style={{ color: '#475569' }}
        >
          {aberto ? 'Ocultar' : 'Detalhes'}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${aberto ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>

      {aberto && (
        <div
          id="sombra-detalhes"
          className="space-y-3 border-t px-3.5 pb-3.5 pt-3"
          style={{ borderColor: 'rgba(71,85,105,0.18)' }}
        >
          {/* ⚠️ Esta frase dizia "não muda o status. A decisão segue sendo da triagem" — verdade
              até 10/09/2026, quando o time passou a decidir o funil e gravou Aprovado em 50
              projetos e Reprovado em 15 no mesmo dia. Manter o texto antigo fazia a tela negar o
              que a planilha mostrava. */}
          <p className="text-[11.5px] text-muted-foreground">
            O time de agentes <strong className="font-semibold">decide o status</strong> deste
            projeto. A triagem revisa e corrige quando discorda.
          </p>

          {/* O veredito dos QUATRO. Avaliação ANTIGA não tem os argumentos gravados: aí cai no
              parecer de sempre (só quem objetou), que é o melhor que existe para aquela linha. */}
          {especialistas.length > 0 ? (
            <ParecerDosAgentes itens={especialistas} />
          ) : (
            linhas.length > 0 && (
              <ul className="space-y-1.5">
                {linhas.map((l, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    {l.autor ? (
                      <>
                        <span className="font-semibold" style={{ color: '#475569' }}>
                          {l.autor}
                        </span>
                        <span className="text-muted-foreground"> · </span>
                        {l.texto}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{l.texto}</span>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}

          {estrela && <EstrelaSugerida estrela={estrela} />}
          {time && <EstrelaDoTime time={time} />}

          {deliberacao && (
            <div className="space-y-1">
              <LinhaSombra rotulo="Deliberação">
                {rotuloEstadoDeliberacao(deliberacao.estado)}
                {deliberacao.grau ? ` · confiança ${deliberacao.grau}` : ''}
                {` · rodada ${deliberacao.rodada}`}
              </LinhaSombra>
              {/* ⚠️ As rodadas ficam FECHADAS por padrão e, abertas, mostram o texto INTEIRO.
                  Antes vinham abertas com `line-clamp-2`, o que dava as reticências que cortavam o
                  parecer no meio (queixa do Luis, 08/09/2026). O parecer que importa é o dos 4
                  agentes, acima; aqui é a trajetória, e quem quer a trajetória quer lê-la toda. */}
              {(deliberacao.historico?.length ?? 0) > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setRodadasAbertas((v) => !v)}
                    aria-expanded={rodadasAbertas}
                    className="mt-1 inline-flex items-center gap-1 rounded text-[11.5px] font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0059A9]"
                    style={{ color: '#475569' }}
                  >
                    {rodadasAbertas ? 'Ocultar' : 'Ver'} as {deliberacao.historico!.length} rodadas
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${rodadasAbertas ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>
                  {rodadasAbertas && (
                    <ol
                      className="mt-1.5 space-y-1.5 border-l-2 pl-3"
                      style={{ borderColor: 'rgba(71,85,105,0.22)' }}
                    >
                      {deliberacao.historico!.map((r, i) => (
                        <li key={`${r.rodada}-${i}`} className="text-[12px]">
                          <span className="font-semibold" style={{ color: '#475569' }}>
                            Rodada {r.rodada}
                            {r.estado ? ` · ${rotuloEstadoDeliberacao(r.estado)}` : ''}
                            {/* grau em PALAVRA: o percentual daqui era o mesmo float não-medido. */}
                            {typeof r.confianca === 'number'
                              ? ` · ${rotuloGrau(grauConfianca(r.confianca))}`
                              : ''}
                          </span>
                          {r.motivo && (
                            <p className="mt-0.5 leading-relaxed text-muted-foreground">{r.motivo}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          )}

          {retroativo && (
            <LinhaSombra rotulo="Confere com o humano?">
              {rotuloResultadoRetroativo(retroativo.resultado)}
              {' · '}
              {rotuloVeredito(retroativo.veredito_agregado)} × {rotuloVeredito(retroativo.veredito_humano)}
            </LinhaSombra>
          )}

          {/* Rodar / rerodar a análise NESTE projeto. Duas ações porque são duas coisas: a MESA
              (veredito + o parecer dos 4) e a ESTRELA (o classificador, 1 chamada de LLM).
              ⚠️ Nenhuma muda status nem escreve a coluna "Estrelas".
              ⚠️ **O botão do TIME COMPLETO saiu** (08/09/2026): ele são ~30 chamadas de LLM e o
              `waitUntil` do Godeploy o cancela no meio — medido em prod, com 2 de 4 chamadas
              respondidas e a mensagem "tasks did not complete within the allowed time". O botão
              dizia "rodando, a estrela aparece em ~1 min" e nunca aparecia. O time completo segue
              existindo como ferramenta de auditoria em LOTE (a rota de admin), que é o que ele
              sempre foi; num clique, quem responde é o classificador. */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'rgba(71,85,105,0.18)' }}>
            {/* O TIME agindo JUNTO é o botão PRINCIPAL: o veredito de impacto e a nota saem da
                mesma passada, e é isso que a submissão dispara. Os dois abaixo ficam para rodar
                uma metade só, quando é isso que se quer (pedido do Luis, 08/09/2026). */}
            <Button
              type="button"
              size="sm"
              disabled={rodando !== null}
              onClick={() => void onRodar('time')}
              className="h-8 text-[12px]"
            >
              {rodando === 'time' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Rodar o time
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rodando !== null}
              onClick={() => void onRodar('mesa')}
              className="h-8 text-[12px]"
            >
              {rodando === 'mesa' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {mesa ? 'Só o parecer' : 'Só o parecer'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rodando !== null}
              onClick={() => void onRodar('estrela')}
              className="h-8 text-[12px]"
            >
              {rodando === 'estrela' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Star className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Só a nota
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Respondem na hora. A nota vai para a coluna do agente, nunca para "Estrelas".
            </span>
          </div>

          {/* Sinal de treinamento — ⚠️ o 👍 SAIU (decisão do Luis, 08/09/2026): a AUSÊNCIA de
              discordância já é concordância, e um polegar para cima não ensinava nada ao agente
              (gravava estado e ninguém lia de volta). O que ficou é o caminho que ENSINA: o 👎
              com eixo e motivo. Estado nunca só por cor: rótulo em texto + ícone. */}
          <div
            className="space-y-2.5 border-t pt-3"
            style={{ borderColor: 'rgba(71,85,105,0.18)' }}
          >
            {formAberto ? (
              <DiscordanciaForm
                parecer={linhas}
                vereditoDoAgente={mesa?.veredito ?? null}
                salvando={votando}
                onCancelar={() => setFormAberto(false)}
                onEnviar={async (dados) => {
                  await onDiscordar(dados);
                  setFormAberto(false);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {feedback === 'dislike' ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#b91c1c' }}>
                      <ThumbsDown className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
                      Você discordou desta recomendação.
                    </span>
                    <Button type="button" size="sm" variant="outline" disabled={votando} onClick={() => setFormAberto(true)}>
                      Registrar de novo
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={votando} onClick={() => onLimparVoto()}>
                      Desfazer
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-[12px] font-medium text-muted-foreground">
                      Discorda desta recomendação?
                    </span>
                    <Button type="button" size="sm" variant="outline" disabled={votando} onClick={() => setFormAberto(true)}>
                      <ThumbsDown className="h-4 w-4" aria-hidden />
                      Discordo, e explico por quê
                    </Button>
                    {/* Um 👍 LEGADO (de antes de o botão sair) segue visível e desfazível — some
                        sozinho quando desmarcado, e nada o recria. */}
                    {feedback === 'like' && (
                      <Button type="button" size="sm" variant="ghost" disabled={votando} onClick={() => onLimparVoto()}>
                        Limpar o "concordo" que você marcou antes
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjetoDetalheDialog({
  projeto,
  onFechar,
  onStatusSalvo,
}: {
  projeto: ProjetoDashboardResumo | null;
  onFechar: () => void;
  onStatusSalvo: (id: string, status: string) => void;
}) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [statusEscolhido, setStatusEscolhido] = useState<string>('');
  const [observacoes, setObservacoes] = useState('');
  // Motivos em coluna própria (nunca sequestram "Observações", que é o parecer usado
  // pelo disparo de e-mails de reenvio).
  const [motivoReenvio, setMotivoReenvio] = useState('');
  const [motivoReprovado, setMotivoReprovado] = useState('');
  // Nota da triagem (coluna manual "Estrelas"). `estrelasOriginal` guarda o valor CRU da
  // planilha: só mandamos a coluna quando o validador realmente mexeu nela — é o que
  // impede um "salvar status" de zerar a nota de outra pessoa.
  const [estrelas, setEstrelas] = useState(0);
  const estrelasOriginal = useRef(0);
  const [salvando, setSalvando] = useState(false);
  // Voto 👍/👎 do admin sobre a recomendação em sombra (teste sombra). Espelha o estado do
  // servidor e é otimista: clicar reflete na hora e desfaz se o POST falhar.
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null);
  const [votando, setVotando] = useState(false);
  /** Qual análise está rodando agora (`null` = nenhuma) — desabilita os dois botões. */
  const [rodandoAnalise, setRodandoAnalise] = useState<'time' | 'mesa' | 'estrela' | null>(null);
  // Guarda o texto original da coluna "Observações": só mandamos a coluna quando o
  // validador realmente mexeu nela (evitar reescrever a célula com o mesmo conteúdo).
  const obsOriginal = useRef('');
  const motivoReenvioOriginal = useRef('');
  const motivoReprovadoOriginal = useRef('');

  const id = projeto?.id ?? null;

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setCarregando(true);
    setErro(null);
    setDetalhe(null);
    // `obterDetalhe` aproveita a requisição que o HOVER da linha já disparou (ver
    // `dashboard-detalhe-cache.ts`): neste ambiente cada requisição carrega ~750 ms de
    // overhead fixo do edge, e começar depois do clique é o que fazia a ficha abrir num
    // spinner. Sem hover (clique direto, teclado, deep link) o comportamento é o de antes:
    // um fetch normal.
    obterDetalhe<Detalhe>(id)
      .then((d) => {
        if (!vivo) return;
        setDetalhe(d);
        const obs = d.campos['Observações'] ?? '';
        obsOriginal.current = obs;
        setObservacoes(obs);
        const mReenvio = d.campos['Motivo Reenvio'] ?? '';
        const mReprovado = d.campos['Motivo Reprovado'] ?? '';
        motivoReenvioOriginal.current = mReenvio;
        motivoReprovadoOriginal.current = mReprovado;
        setMotivoReenvio(mReenvio);
        setMotivoReprovado(mReprovado);
        const nota = lerEstrelas(d.campos['Estrelas']);
        estrelasOriginal.current = nota;
        // ⚠️ Sem `Math.min`: a nota da planilha entra como está — mesmo acima de 10 (legado),
        // porque recortá-la aqui faz o "salvar" REBAIXAR a nota de outra pessoa.
        setEstrelas(nota);
        setStatusEscolhido(d.campos['Status'] ?? '');
        setFeedback(d.feedback ?? null);
      })
      .catch((e: Error) => vivo && setErro(e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id]);

  async function salvarStatus() {
    if (!projeto || !statusEscolhido) return;
    setSalvando(true);
    const obsMudou = observacoes !== obsOriginal.current;
    const reenvioMudou = motivoReenvio !== motivoReenvioOriginal.current;
    const reprovadoMudou = motivoReprovado !== motivoReprovadoOriginal.current;
    const estrelasMudou = estrelas !== estrelasOriginal.current;
    try {
      await apiFetch('/api/admin/dashboard/status', {
        projeto_id: projeto.id,
        status: statusEscolhido,
        ...(obsMudou ? { observacoes } : {}),
        ...(reenvioMudou ? { motivo_reenvio: motivoReenvio } : {}),
        ...(reprovadoMudou ? { motivo_reprovado: motivoReprovado } : {}),
        ...(estrelasMudou ? { estrelas } : {}),
      });
      obsOriginal.current = observacoes;
      motivoReenvioOriginal.current = motivoReenvio;
      motivoReprovadoOriginal.current = motivoReprovado;
      estrelasOriginal.current = estrelas;
      // ⚠️ A ficha guardada acabou de ficar velha: o espelho foi remendado com o status/motivo
      // novos e uma reabertura servida do cache afirmaria o valor ANTERIOR — e, pior, semearia
      // de volta o texto antigo nos campos que a triagem regrava.
      invalidarDetalhe(projeto.id);
      onStatusSalvo(projeto.id, statusEscolhido);
      toast.success(`Status salvo na planilha: ${statusEscolhido}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o status.');
    } finally {
      setSalvando(false);
    }
  }

  // Registra a DISCORDÂNCIA com eixo e motivo — o caminho que vira lição para o agente.
  // ⚠️ Não toca no status do projeto (segue humano). NÃO é otimista, ao contrário do voto simples
  // que existia antes: aqui a pessoa escreveu um texto, e marcar "discordou" antes de o servidor
  // aceitar faria o formulário fechar sobre um motivo que pode ter sido recusado (o piso de
  // caracteres é cobrado nos dois lados).
  async function discordarDaSombra(dados: DadosDiscordancia) {
    if (!projeto || votando) return;
    setVotando(true);
    try {
      // ⚠️ O servidor devolve se aquilo VIROU LIÇÃO (ele pergunta ao mesmo leitor que o prompt
      // usa) — a tela repete o que ele disse em vez de prometer. Prometer lição que o
      // `ensinaAlgo` descarta era mentir para quem acabou de escrever o motivo.
      const r = (await apiFetch('/api/admin/avaliacao/feedback', {
        projetoId: projeto.id,
        projetoNome: projeto.nome ?? null,
        voto: 'dislike',
        eixo: dados.eixo,
        vereditoCerto: dados.vereditoCerto,
        motivo: dados.motivo,
      })) as { virouLicao?: boolean; porque?: string | null };
      setFeedback('dislike');
      invalidarDetalhe(projeto.id);
      if (r?.virouLicao === false && r.porque) {
        toast.warning(`Discordância registrada, mas ela não vira lição: ${r.porque}.`, {
          duration: 12000,
        });
      } else {
        toast.success(
          'Discordância registrada. Ela entra como lição nos próximos projetos parecidos.',
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível registrar a discordância.');
    } finally {
      setVotando(false);
    }
  }

  // Desfaz o voto (inclusive um 👍 legado). Otimista, com rollback — aqui não há texto em jogo.
  async function limparVotoSombra() {
    if (!projeto || votando) return;
    const anterior = feedback;
    setFeedback(null);
    setVotando(true);
    try {
      await apiFetch('/api/admin/avaliacao/feedback', { projetoId: projeto.id, voto: null });
      invalidarDetalhe(projeto.id);
    } catch (e) {
      setFeedback(anterior);
      toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer o voto.');
    } finally {
      setVotando(false);
    }
  }

  /**
   * Recarrega só o `detalhe` (o painel sombra), **sem** reescrever os campos do formulário.
   *
   * ⚠️ De propósito não repete o que o `useEffect` de abertura faz: ele semeia "Observações",
   * "Motivo Reenvio", "Motivo Reprovado" e as estrelas a partir do servidor, e fazer isso aqui
   * apagaria o que o validador já digitou e ainda não salvou.
   */
  async function recarregarDetalhe() {
    if (!projeto) return;
    try {
      setDetalhe(await obterDetalhe<Detalhe>(projeto.id));
    } catch (e) {
      console.error('[ficha] falha ao recarregar o detalhe', e);
    }
  }

  /**
   * Roda (ou reroda) a análise dos agentes NESTE projeto.
   *
   * ⚠️ Reusa as duas rotas de admin que já existem (`avaliar-normais` e `especiais/classificar`)
   * — nenhuma rota nova. **As duas são SÍNCRONAS**, e é isso que faz o botão valer: a rota do time
   * completo devolvia 202 e o `waitUntil` do Godeploy a cancelava no meio (medido em prod
   * 08/09/2026, 2 de 4 chamadas respondidas), então o clique prometia uma estrela que nunca vinha.
   * ⚠️ `forcar: true` na estrela porque RERODAR é o pedido: sem ele o classificador recusa projeto
   * que já tem nota humana ("vira âncora") e recusaria a re-execução.
   * ⚠️ `invalidarDetalhe` antes de recarregar: a ficha tem cache de 30 s e sem isso o painel
   * voltaria com o parecer velho, exatamente como se nada tivesse rodado.
   */
  async function rodarAnalise(qual: 'time' | 'mesa' | 'estrela') {
    if (!projeto || rodandoAnalise) return;
    setRodandoAnalise(qual);
    try {
      if (qual === 'time') {
        // O time JUNTO: veredito de impacto + nota, numa passada (é o caminho normal).
        const r = (await apiFetch('/api/admin/avaliacao/time-completo', {
          projetoId: projeto.id,
          dry: false,
          forcar: true,
        })) as {
          ok?: boolean;
          mesa?: { ok?: boolean; veredito?: string | null; motivo?: string };
          estrela?: { ok?: boolean; estrelas?: number | null; motivo?: string };
        };
        invalidarDetalhe(projeto.id);
        const partes = [
          r?.mesa?.ok ? 'parecer atualizado' : null,
          r?.estrela?.ok && typeof r.estrela.estrelas === 'number' ? `nota ${r.estrela.estrelas}` : null,
        ].filter(Boolean);
        if (partes.length) toast.success(`Time rodou: ${partes.join(' · ')}.`);
        else toast.info(r?.estrela?.motivo ?? r?.mesa?.motivo ?? 'O time não teve o que concluir aqui.');
        await recarregarDetalhe();
      } else if (qual === 'mesa') {
        const r = (await apiFetch('/api/admin/avaliar-normais', {
          projetoId: projeto.id,
          dry: false,
        })) as { ok?: boolean; gravado?: boolean; motivo?: string };
        invalidarDetalhe(projeto.id);
        if (r?.ok === false) {
          toast.error(r.motivo ?? 'A mesa não conseguiu avaliar este projeto.');
        } else if (r?.gravado === false) {
          // NO-OP legítimo: projeto especial, ou a flag `AVALIACAO_NORMAIS` desligada.
          toast.info(r.motivo ?? 'A mesa não avaliou este projeto.');
        } else {
          toast.success('Mesa rodou. Recarregando o parecer.');
        }
        await recarregarDetalhe();
      } else {
        const r = (await apiFetch('/api/admin/especiais/classificar', {
          projetoId: projeto.id,
          dry: false,
          forcar: true,
        })) as { ok?: boolean; motivo?: string; recomendacao?: { estrelas_recomendada?: number } };
        invalidarDetalhe(projeto.id);
        if (r?.ok === false) {
          toast.error(r.motivo ?? 'O agente não conseguiu sugerir uma estrela.');
        } else {
          const n = r?.recomendacao?.estrelas_recomendada;
          toast.success(
            typeof n === 'number' ? `Estrela sugerida: ${n}.` : 'Estrela sugerida atualizada.',
          );
        }
        await recarregarDetalhe();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível rodar a análise.');
    } finally {
      setRodandoAnalise(null);
    }
  }

  const campos = detalhe?.campos ?? {};
  const usados = new Set<string>([
    ...GRUPOS.flatMap((g) => g.colunas),
    ...MEMORIAIS,
    DESCRICAO,
    ...NO_CABECALHO,
  ]);
  // As duas colunas do líder viram a seção "Pré-aprovação do líder" e por isso saem de
  // "Outras colunas". ⚠️ A exclusão é por chave TOLERANTE: o cabeçalho real de prod e da
  // staging é "Justificativa Aprovação do Lider" (sem acento) e um `Set` de nomes exatos
  // deixaria a célula multi-linha aparecer DE NOVO ali embaixo, crua.
  const chavesDoLider = new Set(
    [COLUNA_ESTADO_LIDER, COLUNA_JUSTIFICATIVA_LIDER].map(chaveColuna),
  );
  const parecerLider = interpretarParecerLider(campos);
  const outras = Object.keys(campos).filter(
    (k) => !usados.has(k) && !chavesDoLider.has(chaveColuna(k)),
  );
  const statusMudou = detalhe != null && statusEscolhido !== (campos['Status'] ?? '');
  const obsMudou = detalhe != null && observacoes !== obsOriginal.current;
  const estrelasMudou = detalhe != null && estrelas !== estrelasOriginal.current;
  const motivosMudaram =
    detalhe != null &&
    (motivoReenvio !== motivoReenvioOriginal.current ||
      motivoReprovado !== motivoReprovadoOriginal.current);
  // Campo de motivo aparece conforme a decisão: reenvio pede o que corrigir; reprovação
  // pede o porquê (e sobrepõe o motivo escrito pelo analisador).
  const pedeMotivoReenvio = statusEscolhido === 'Reenvio Pendente';
  const pedeMotivoReprovado = statusEscolhido === 'Reprovado';

  return (
    <Dialog open={projeto != null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="text-xl">
              {projeto?.nome ?? 'Projeto sem nome'}
            </DialogTitle>
            <StatusBadge status={projeto?.statusChave ?? null} />
            {projeto?.especial && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: 'rgba(215,219,0,0.18)',
                  border: '1px solid rgba(215,219,0,0.5)',
                  color: '#6b6f00',
                }}
              >
                <FileText className="h-3 w-3" /> Especial
              </span>
            )}
          </div>
          <DialogDescription className="text-[13px]">
            {projeto?.autor ?? 'Autor não informado'}
            {projeto?.email ? ` · ${projeto.email}` : ''}
            {projeto?.area ? ` · ${projeto.area}` : ''}
            {projeto?.dataSubmissao ? ` · enviado em ${fmtDataBR(projeto.dataSubmissao)}` : ''}
            <span className="ml-1 font-mono text-[11px] opacity-70">({projeto?.id})</span>
          </DialogDescription>
        </DialogHeader>

        {carregando && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando a linha da planilha…
          </div>
        )}

        {erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}

        {detalhe && (
          <>
            {/* Decisão da triagem primeiro: é a ação que trouxe o validador até aqui. */}
            <section
              className="rounded-xl border p-4"
              style={{ borderColor: 'rgba(0,89,169,0.18)', background: 'rgba(0,89,169,0.035)' }}
            >
              <h3 className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--go-blue)' }}>
                Decisão da triagem
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr]">
                <label className="block">
                  <span className="text-[11px] font-semibold text-muted-foreground">Status na planilha</span>
                  <select
                    value={statusEscolhido}
                    onChange={(e) => setStatusEscolhido(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {!STATUS_OPCOES.includes(statusEscolhido as (typeof STATUS_OPCOES)[number]) && (
                      <option value={statusEscolhido}>
                        {statusEscolhido || 'Sem status'}
                      </option>
                    )}
                    {STATUS_OPCOES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {/* A nota mora junto do status porque é a MESMA decisão: a triagem
                      olha o projeto uma vez e registra as duas coisas no mesmo salvar. */}
                  <span className="mt-3 block text-[11px] font-semibold text-muted-foreground">
                    Nota da triagem — coluna "Estrelas" da planilha
                  </span>
                  <NotaEstrelas valor={estrelas} onChange={setEstrelas} />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Motivo / observações — vai para a coluna "Observações" e é o texto que o
                    dono recebe no e-mail de reenvio
                  </span>
                  <textarea
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    rows={3}
                    placeholder="Ex.: o memorial não quebra as horas por atividade — favor detalhar a composição."
                    className="mt-1 w-full resize-y rounded-md border border-input bg-background p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
              </div>

              {/* Motivo em COLUNA PRÓPRIA, conforme a decisão. Não toca "Observações":
                  aquele texto é o parecer que o disparo de e-mails usa. O autor VÊ estes
                  motivos na tela do projeto dele — escreva para ele ler. */}
              {(pedeMotivoReenvio || pedeMotivoReprovado) && (
                <label className="mt-3 block">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {pedeMotivoReprovado
                      ? 'Motivo da reprovação — vai para a coluna "Motivo Reprovado" e é o que o autor vê (sobrepõe o motivo do analisador)'
                      : 'Motivo do reenvio — vai para a coluna "Motivo Reenvio" e é o que o autor vê'}
                  </span>
                  <textarea
                    value={pedeMotivoReprovado ? motivoReprovado : motivoReenvio}
                    onChange={(e) =>
                      pedeMotivoReprovado
                        ? setMotivoReprovado(e.target.value)
                        : setMotivoReenvio(e.target.value)
                    }
                    rows={2}
                    placeholder={
                      pedeMotivoReprovado
                        ? 'Ex.: entrega executada uma única vez, sem indicador verificável — não se enquadra como projeto recorrente.'
                        : 'Ex.: projeto parado, em manutenção; reenviar depois de aplicar as correções.'
                    }
                    className="mt-1 w-full resize-y rounded-md border border-input bg-background p-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </label>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  onClick={salvarStatus}
                  disabled={salvando || (!statusMudou && !obsMudou && !motivosMudaram && !estrelasMudou)}
                >
                  {salvando ? <Loader2 className="animate-spin" /> : <Save />}
                  Salvar na planilha
                </Button>
                <span className="text-xs text-muted-foreground">
                  {statusMudou || obsMudou || motivosMudaram || estrelasMudou
                    ? 'Há mudanças não salvas.'
                    : 'Nada mudou desde a última leitura.'}
                </span>
              </div>
            </section>

            {/* Logo depois da decisão: é o insumo que a triagem usa para decidir, e
                antes vivia só na planilha (célula multi-linha, ilegível ali). */}
            {!parecerLider.vazio && (
              <Secao titulo="Pré-aprovação do líder">
                <ParecerLiderPainel parecer={parecerLider} />
              </Secao>
            )}

            {/* Teste sombra: o que o time de AGENTES recomendaria, ao lado da decisão
                humana. NADA aqui muda o status — é para calibrar os agentes. */}
            {/* ⚠️ A seção aparece SEMPRE (para admin), mesmo sem avaliação: era condicionada a
                `avaliacaoSombra` existir, e então projeto que o agente nunca avaliou não tinha
                onde MANDAR avaliar — o botão de rodar ficava inalcançável justo em quem precisa
                dele. Sem avaliação, o painel diz "Sem recomendação ainda" e oferece os botões. */}
            {(
              <Secao titulo="Avaliação em sombra (agente)">
                <AvaliacaoSombraPainel
                  sombra={
                    detalhe.avaliacaoSombra ?? {
                      mesa: null,
                      deliberacao: null,
                      retroativo: null,
                      especialistas: [],
                      time: null,
                    }
                  }
                  feedback={feedback}
                  votando={votando}
                  onDiscordar={discordarDaSombra}
                  onLimparVoto={limparVotoSombra}
                  onRodar={rodarAnalise}
                  rodando={rodandoAnalise}
                />
              </Secao>
            )}

            {/* Estágio 2 — feature de outro projeto: parecer do líder do DONO DO PAI. Vem
                do SQLite (o estágio 2 não tem coluna no Sheets), para a triagem ver os DOIS
                pareceres sem abrir a planilha. */}
            {detalhe.preAprovacaoPai && (
              <Secao titulo="Pré-aprovação do líder do projeto pai (feature)">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--go-blue)' }}>
                  {detalhe.preAprovacaoPai.estado}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                  {detalhe.preAprovacaoPai.justificativa}
                </p>
              </Secao>
            )}

            {campos[DESCRICAO] && (
              <Secao titulo="Descrição">
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                  {campos[DESCRICAO]}
                </p>
              </Secao>
            )}

            {/* Contrafactual da Etapa 2 — "quem sentiria falta se a automação parasse".
                Insumo do critério de projeto (o eixo contrafactual). Vive SÓ no SQLite,
                nunca virou coluna do Sheets, então a triagem não o via até aqui. */}
            {detalhe.contrafactual && detalhe.contrafactual.lista.length > 0 && (
              <Secao titulo="Quem sentiria falta se a automação parasse">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {detalhe.contrafactual.tipo === 'time'
                    ? 'Times/áreas apontados pelo autor'
                    : 'Pessoas apontadas pelo autor'}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {detalhe.contrafactual.lista.map((item) => (
                    <li
                      key={item}
                      className="rounded-md border px-2.5 py-1 text-[13px]"
                      style={{ borderColor: 'rgba(0,89,169,0.22)', background: 'rgba(0,89,169,0.04)' }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </Secao>
            )}

            {/* Quem fez o quê — ABERTO aqui (ao contrário do cartão, que colapsa para a
                coluna continuar escaneável): a ficha é onde se decide, e é para ler. */}
            {/* O texto vem do PRÓPRIO detalhe da ficha — uma fonte só para as 3 abas
                (/dashboard, /especiais e /aprovacoes-pendentes). Nos CARTÕES daquelas duas
                ele chega pelo mapa da listagem, porque lá aparece sem abrir a ficha. As
                colunas de papel dizem QUEM participou; só este bloco diz o QUE cada um fez. */}
            {detalhe.pessoas != null && detalhe.pessoas.length > 0 && (
              <Secao titulo="Quem fez o quê">
                <ul className="space-y-1.5">
                  {detalhe.pessoas.map((pes) => (
                    <li key={pes.email} className="rounded-md bg-muted/60 px-2.5 py-2">
                      <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
                        <span className="font-medium text-foreground">{pes.email}</span>
                        {pes.papel && (
                          <span
                            className="rounded px-1 py-px text-[10.5px] font-medium"
                            style={{ background: 'rgba(0,89,169,0.1)', color: 'var(--go-blue)' }}
                          >
                            {pes.papel}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground">
                        {pes.texto}
                      </p>
                    </li>
                  ))}
                </ul>
              </Secao>
            )}

            {GRUPOS.map((g) => {
              const presentes = g.colunas.filter((c) => campos[c]);
              if (!presentes.length) return null;
              return (
                <Secao key={g.titulo} titulo={g.titulo}>
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {presentes.map((c) => (
                      <Campo key={c} nome={c} valor={campos[c]} />
                    ))}
                  </dl>
                </Secao>
              );
            })}

            {MEMORIAIS.some((m) => campos[m]) && (
              <Secao titulo="Memoriais">
                {MEMORIAIS.filter((m) => campos[m]).map((m) => (
                  <details key={m} className="mb-2 rounded-lg border border-border bg-card">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">
                      {m}
                    </summary>
                    <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-[12.5px] leading-relaxed">
                      {campos[m]}
                    </div>
                  </details>
                ))}
              </Secao>
            )}

            {outras.length > 0 && (
              <Secao titulo="Outras colunas">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {outras.map((c) => (
                    <Campo key={c} nome={c} valor={campos[c]} />
                  ))}
                </dl>
              </Secao>
            )}

            {detalhe.historico.length > 0 && (
              <Secao titulo="Histórico de triagem">
                <ul className="space-y-1.5">
                  {detalhe.historico.map((h, i) =>
                    h.tipo === 'reenvio' ? (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                        <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          Projeto reenviado (edição {h.edicao})
                        </span>
                        <span className="text-muted-foreground">
                          {h.submetido_por ? `por ${h.submetido_por}` : ''}
                          {h.created_at ? ` em ${fmtDataBR(h.created_at)}` : ''}
                        </span>
                      </li>
                    ) : (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                        <History className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">
                          {h.status_anterior ?? 'sem status'} → {h.status_novo}
                        </span>
                        <span className="text-muted-foreground">
                          por {h.admin_email}
                          {h.created_at ? ` em ${fmtDataBR(h.created_at)}` : ''}
                        </span>
                        {h.observacoes && (
                          <span className="w-full text-muted-foreground">Motivo: {h.observacoes}</span>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </Secao>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
