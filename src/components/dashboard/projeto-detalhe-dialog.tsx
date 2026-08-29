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
  ThumbsUp,
  ThumbsDown,
  Bot,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
  pctConfianca,
  grauConfianca,
  aparenciaConfianca,
} from '@/lib/avaliacao-sombra-rotulos';
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
      'Participantes',
      'Participantes 2',
      'Contribuidor',
      'Tipos Projeto',
      'Ferramenta',
      'Escopo',
      'Especial?',
      'Contexto do Projeto Especial',
      'Usa AI Proxy',
      'URL',
    ],
  },
  {
    titulo: 'Saving e horas',
    colunas: [
      'Alguém Fazia?',
      'Tipo de Saving',
      'Saving Horas',
      'Saving Horas Real',
      'Saving Horas Escalado',
      'Horas em Reais',
      'Saving Reais',
      'Diff Horas / Antes',
      'Diff Saving / Antes',
    ],
  },
  {
    titulo: 'Custos e receita',
    colunas: [
      'Custo Evitado',
      'Custo Mensal ou Pontual',
      'Justificativa Custo Evitado',
      'Custo Externo Mensal',
      'Custo do Projeto',
      'Custo do Projeto Mensal ou Pontual',
      'Justificativa Custo do Projeto',
      'Receita Mensal',
      'Tipo de Receita',
      'Ganho Total',
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
      'Justificativa Saving Escalado e Real',
      'Análise Antiagente',
    ],
  },
];

/** Textos longos: vão em bloco de largura cheia, dentro de um `<details>`. */
const MEMORIAIS = ['Memorial de Saving', 'Receita Memorial', 'Memorial anterior'];

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
        {/* Rótulo de exibição: as colunas de papel se chamam "Participantes"/"Participantes 2"
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

/** Confiança em destaque: o número grande, colorido pelo grau, com o rótulo do grau ao lado. */
function ConfiancaDestaque({ conf }: { conf: number | null }) {
  const a = aparenciaConfianca(conf);
  const grau = typeof conf === 'number' ? grauConfianca(conf) : null;
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1"
      style={{ background: a.fundo, border: `1px solid ${a.borda}`, color: a.cor }}
    >
      <span className="text-[20px] font-bold leading-none tabular-nums">{pctConfianca(conf)}</span>
      <span className="text-[11px] font-semibold">{rotuloGrau(grau)}</span>
    </span>
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

function AvaliacaoSombraPainel({
  sombra,
  feedback,
  votando,
  onVotar,
}: {
  sombra: AvaliacaoSombra;
  feedback: 'like' | 'dislike' | null;
  votando: boolean;
  onVotar: (v: 'like' | 'dislike') => void;
}) {
  const { mesa, deliberacao, retroativo } = sombra;
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'rgba(71,85,105,0.28)', background: 'rgba(71,85,105,0.04)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em]"
          style={{ background: 'rgba(71,85,105,0.12)', color: '#475569' }}
        >
          <Bot className="h-3 w-3" aria-hidden /> Sombra
        </span>
        <span className="text-[12px] text-muted-foreground">
          Recomendação do agente — <strong className="font-semibold">não muda o status</strong> do
          projeto (a decisão segue sendo da triagem).
        </span>
      </div>

      {mesa ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              Veredito do agente
            </span>
            <p className="text-[15px] font-semibold">{rotuloVeredito(mesa.veredito)}</p>
          </div>
          <ConfiancaDestaque conf={mesa.confianca} />
          {mesa.divergencia && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: 'rgba(138,90,0,0.12)', border: '1px solid rgba(138,90,0,0.4)', color: '#8a5a00' }}
            >
              Especialistas divergiram
            </span>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          O agregador ainda não emitiu recomendação para este projeto.
        </p>
      )}

      {mesa?.motivo && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-2.5 text-[12.5px] leading-relaxed">
          {mesa.motivo}
        </p>
      )}

      {deliberacao && (
        <div className="mt-3 space-y-1">
          <LinhaSombra rotulo="Deliberação">
            {rotuloEstadoDeliberacao(deliberacao.estado)}
            {deliberacao.grau ? ` · confiança ${deliberacao.grau}` : ''}
            {` · rodada ${deliberacao.rodada}`}
          </LinhaSombra>
          {deliberacao.motivo && (
            <p className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">
              {deliberacao.motivo}
            </p>
          )}
          {(deliberacao.historico?.length ?? 0) > 1 && (
            <div className="mt-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                Rodadas da mesa
              </span>
              <ol
                className="mt-1 space-y-2 border-l-2 pl-3"
                style={{ borderColor: 'rgba(71,85,105,0.22)' }}
              >
                {deliberacao.historico!.map((r, i) => (
                  <li key={`${r.rodada}-${i}`} className="text-[12px]">
                    <span className="font-semibold" style={{ color: '#475569' }}>
                      Rodada {r.rodada}
                      {r.estado ? ` · ${rotuloEstadoDeliberacao(r.estado)}` : ''}
                      {typeof r.confianca === 'number' ? ` · confiança ${pctConfianca(r.confianca)}` : ''}
                    </span>
                    {r.motivo && (
                      <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                        {r.motivo}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {retroativo && (
        <div className="mt-3 space-y-1">
          <LinhaSombra rotulo="Confere com o humano?">
            {rotuloResultadoRetroativo(retroativo.resultado)}
          </LinhaSombra>
          <LinhaSombra rotulo="Agente × humano">
            {rotuloVeredito(retroativo.veredito_agregado)} × {rotuloVeredito(retroativo.veredito_humano)}
          </LinhaSombra>
          {retroativo.motivo && (
            <p className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">
              {retroativo.motivo}
            </p>
          )}
        </div>
      )}

      {/* Sinal de treinamento: o admin diz se concorda com o agente. Estado nunca só por cor —
          o botão marcado leva rótulo, ícone preenchido e aria-pressed. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'rgba(71,85,105,0.18)' }}>
        <span className="text-[12px] font-medium text-muted-foreground">
          A recomendação está certa?
        </span>
        <Button
          type="button"
          size="sm"
          variant={feedback === 'like' ? 'default' : 'outline'}
          aria-pressed={feedback === 'like'}
          disabled={votando}
          onClick={() => onVotar('like')}
        >
          <ThumbsUp className="h-4 w-4" fill={feedback === 'like' ? 'currentColor' : 'none'} />
          Concordo
        </Button>
        <Button
          type="button"
          size="sm"
          variant={feedback === 'dislike' ? 'destructive' : 'outline'}
          aria-pressed={feedback === 'dislike'}
          disabled={votando}
          onClick={() => onVotar('dislike')}
        >
          <ThumbsDown className="h-4 w-4" fill={feedback === 'dislike' ? 'currentColor' : 'none'} />
          Discordo
        </Button>
        {feedback && (
          <span className="text-[12px] text-muted-foreground">
            {feedback === 'like' ? 'Você concordou.' : 'Você discordou.'} Clique de novo para desmarcar.
          </span>
        )}
      </div>
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

  // Vota (ou desmarca, clicando de novo no voto atual) na recomendação em sombra.
  // ⚠️ Não toca no status do projeto — é só sinal de treinamento. Otimista, com rollback.
  async function votarSombra(voto: 'like' | 'dislike') {
    if (!projeto || votando) return;
    const novo = feedback === voto ? null : voto;
    const anterior = feedback;
    setFeedback(novo);
    setVotando(true);
    try {
      await apiFetch('/api/admin/avaliacao/feedback', { projetoId: projeto.id, voto: novo });
      invalidarDetalhe(projeto.id);
    } catch (e) {
      setFeedback(anterior);
      toast.error(e instanceof Error ? e.message : 'Não foi possível registrar o voto.');
    } finally {
      setVotando(false);
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
            {detalhe.avaliacaoSombra && (
              <Secao titulo="Avaliação em sombra (agente)">
                <AvaliacaoSombraPainel
                  sombra={detalhe.avaliacaoSombra}
                  feedback={feedback}
                  votando={votando}
                  onVotar={votarSombra}
                />
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
