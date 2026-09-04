// Integração GoDocs → Gomoon → Google Chat: o aviso diário ao líder (D17, 05/08/2026).
//
// O GoDocs NÃO fala mais com a API do Google Chat. Uma vez por dia ele manda a
// RELAÇÃO líder↔liderados-com-pendência para o Gomoon, que enfileira, monta a
// mensagem e entrega a DM pelo bot dele (Bot Gomoon, admin-installed no Workspace).
//
// Contrato dos dois lados: docs/integracao-gomoon-chat.md.
//
// UMA mensagem sai daqui: o aviso DIÁRIO ao líder com pendência. A redação mora em
// `gomoon-mensagens.ts` (módulo puro, fonte única) e nós mandamos o texto PRONTO em
// `mensagem.texto`; o template do Gomoon é fallback.
//
// ⚠️ **O ANÚNCIO de abertura da feature SAIU do GoDocs (D24, 06/08/2026).** Quem guarda
// o texto e dispara a mensagem única para a empresa é o GOMOON. `anunciarPreAprovacao`,
// `montarPayloadAnuncio` e a rota `/api/admin/anunciar-pre-aprovacao` foram REMOVIDOS —
// **não reimplementar**. O texto acordado está em `docs/integracao-gomoon-chat.md`.
//
// Invariantes que NÃO podem regredir:
//  • **Nenhum valor em R$ no payload** (§7.1). É o que torna impossível vazar saving
//    numa DM que se lê por cima do ombro. Só nome, e-mail e CONTAGEM.
//  • **Dia sem pendência manda `lideres: []` assim mesmo** (§2). Silêncio é
//    indistinguível de cron morto — a lista vazia é a prova de que o run rodou.
//  • **Idempotência por `godocs:<email>:<YYYY-MM-DD>`** (§4): o POST é um SNAPSHOT que
//    SUBSTITUI o estado do dia, nunca um incremento. Cron repetido às 09h05 não pode
//    render duas DMs — quem garante isso é a chave (o Gomoon trava no banco dele).
//  • **`ambiente` é a ÚNICA proteção da staging** (§6): o Gomoon implementou a opção 2
//    (honra o campo e roteia tudo para um destinatário de teste). Se a staging mandar
//    `"producao"`, líder REAL recebe teste nosso. Por isso o campo deriva do
//    `GODOCS_ENV` (fonte única do ambiente) e nunca é parâmetro de chamada.

import { getPendenciasPorLider } from '@/integrations/db/client.server';
import { derivarNomeDeEmail } from '@/lib/auth.functions';
import { rotuloAmbienteExterno } from '@/lib/env';
import { ehProjetoTesteE2E } from '@/lib/google/chat';
import { renderMensagemLider, renderMensagemLiderFeature } from '@/lib/gomoon-mensagens';

const URL_PADRAO = 'https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes';
const APP_PADRAO = 'https://godocs.devgogroup.com';
/** O Gomoon responde entre 0,6s e 1,7s em produção; o contrato pede ≤10s (§3). */
const TIMEOUT_MS = 15_000;

// ─── Tipos do contrato (§3) ──────────────────────────────────────────────────

export type LideradoPayload = {
  nome: string;
  email: string;
  /** Sempre ≥ 1 — liderado sem pendência não entra na lista. */
  projetos_pendentes: number;
};

/** O texto pronto que o Gomoon entrega. Ver `gomoon-mensagens.ts` e §13 do contrato. */
export type MensagemPayload = {
  /** Markup do Google Chat, já renderizado. O Gomoon NÃO prefixa nem sufixa nada. */
  texto: string;
};

export type LiderPayload = {
  email: string;
  nome: string | null;
  url: string;
  /** `godocs:<email>:<YYYY-MM-DD>` — ver §4. */
  idempotency_key: string;
  /** Nunca vazio (§3). */
  liderados: LideradoPayload[];
  /**
   * Mensagem já redigida por nós (§13). O Gomoon usa este texto; se o campo faltar,
   * ele cai no template interno dele — é o que deixa os dois lados deployarem em
   * qualquer ordem.
   */
  mensagem: MensagemPayload;
};

export type PayloadLideresPendentes = {
  origem: 'godocs';
  ambiente: 'producao' | 'staging';
  gerado_em: string;
  lideres: LiderPayload[];
};

/** Uma linha da agregada: par (líder, liderado) + quantos projetos esperam parecer. */
export type LinhaPendencia = {
  lider_email: string;
  lider_nome: string | null;
  liderado_email: string | null;
  liderado_nome: string | null;
  projetos_pendentes: number;
};

// ─── Montagem do payload (pura) ──────────────────────────────────────────────

/**
 * Dia-calendário de BRASÍLIA em `YYYY-MM-DD`, para a chave de idempotência. Função pura.
 *
 * ⚠️ NÃO usar `toISOString().slice(0,10)`: o dia da chave tem de ser o dia ÚTIL do
 * negócio, não o dia UTC. Com o cron às 09h BRT (12h UTC) os dois coincidem, mas um
 * disparo manual às 22h BRT cairia no dia seguinte em UTC e o líder receberia uma
 * segunda DM "de amanhã" no mesmo dia. `en-CA` formata como ISO.
 */
export function dataChaveBRT(iso: string): string {
  const d = new Date(iso);
  const valida = Number.isNaN(d.getTime()) ? new Date() : d;
  return valida.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * ORIGEM (protocolo + host) de uma URL, descartando qualquer caminho. Função pura.
 *
 * ⚠️ `APP_BASE_URL` **não é uma origem limpa**: na staging ela vale
 * `https://godocs-staging.devgogroup.com/meus-projetos` (o disparo de e-mails usa esse
 * link inteiro). Concatenar `/aprovacoes` nela gerava
 * `…/meus-projetos/aprovacoes` — rota que não existe, e o líder cairia num 404 vindo
 * da DM. A tela mora na RAIZ (`src/routes/aprovacoes.tsx`).
 */
export function origemDe(url: string, padrao: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return padrao.replace(/\/+$/, '');
  }
}

/**
 * Chave de idempotência do aviso DIÁRIO: um dia, uma entrega por líder (§4).
 * O POST é um snapshot que SUBSTITUI o estado do dia — cron repetido não reentrega.
 */
export function chaveDiaria(email: string, geradoEm: string): string {
  return `godocs:${email}:${dataChaveBRT(geradoEm)}`;
}

/**
 * Chave de idempotência do aviso IMEDIATO (D26): uma entrega por PROJETO, para sempre.
 *
 * ⚠️ NÃO dá para reaproveitar a chave diária aqui. Com disparo por submissão, dois
 * projetos que caem no mesmo dia para o mesmo líder colidiriam na chave: o Gomoon
 * devolveria `ja_entregue` no segundo (§8 — "chave já entregue → ignoramos") e a DM do
 * segundo projeto sumiria em silêncio. A chave é string OPACA do lado deles ("continua
 * sendo a mesma e é devolvida como veio", §3), então o formato é escolha nossa.
 */
export function chaveDeProjeto(email: string, projetoId: string): string {
  return `godocs:${email}:${projetoId}`;
}

/**
 * Agrupa as linhas da agregada no payload do §3. Função PURA (exportada para teste).
 *
 * Os liderados saem ordenados por quantidade decrescente (é a ordem em que o Gomoon
 * lista na mensagem) e, no empate, por nome — para o payload ser estável entre runs.
 * O TOTAL do líder NÃO vai pré-calculado: o Gomoon soma (confirmado por eles no §2).
 *
 * `chaveDe` troca a granularidade da idempotência sem duplicar a montagem: o aviso
 * diário usa a chave por DIA, o imediato usa a chave por PROJETO. Default = diária.
 */
export function montarPayloadLideresPendentes(
  linhas: LinhaPendencia[],
  opts: {
    ambiente: 'producao' | 'staging';
    geradoEm: string;
    appUrl: string;
    chaveDe?: (email: string) => string;
  },
): PayloadLideresPendentes {
  const chaveDe = opts.chaveDe ?? ((email: string) => chaveDiaria(email, opts.geradoEm));
  const url = `${origemDe(opts.appUrl, APP_PADRAO)}/aprovacoes`;
  // A `mensagem` entra só no fim: o texto lista os liderados na ordem final e soma o
  // total, então renderizar antes de agrupar/ordenar daria uma DM diferente da lista.
  const porLider = new Map<string, Omit<LiderPayload, 'mensagem'>>();

  for (const l of linhas) {
    const email = (l.lider_email ?? '').trim().toLowerCase();
    const liderado = (l.liderado_email ?? '').trim().toLowerCase();
    const quantos = Number(l.projetos_pendentes) || 0;
    // Sem e-mail não há DM; sem projeto não há o que avisar. `liderados` nunca vazio (§3).
    if (!email || !liderado || quantos < 1) continue;

    let atual = porLider.get(email);
    if (!atual) {
      atual = {
        email,
        nome: (l.lider_nome ?? '').trim() || null,
        url,
        idempotency_key: chaveDe(email),
        liderados: [],
      };
      porLider.set(email, atual);
    }
    atual.liderados.push({
      // O nome do autor pode estar vazio no banco (legado) — o e-mail sempre dá um nome
      // legível, e a DM sem nome nenhum é pior do que a derivação.
      nome: (l.liderado_nome ?? '').trim() || derivarNomeDeEmail(liderado),
      email: liderado,
      projetos_pendentes: quantos,
    });
  }

  const lideres: LiderPayload[] = [...porLider.values()]
    .map((lider) => {
      const liderados = [...lider.liderados].sort(
        (a, b) => b.projetos_pendentes - a.projetos_pendentes || a.nome.localeCompare(b.nome, 'pt-BR'),
      );
      const comOrdem = { ...lider, liderados };
      return { ...comOrdem, mensagem: { texto: renderMensagemLider(comOrdem) } };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  return { origem: 'godocs', ambiente: opts.ambiente, gerado_em: opts.geradoEm, lideres };
}

// ─── Envio ───────────────────────────────────────────────────────────────────

/** Resultado por item devolvido pelo Gomoon (§3/§4). */
export type ResultadoItemGomoon = {
  email?: string;
  ok?: boolean;
  codigo?: string;
  enfileirado_em?: string;
  entregue_em?: string;
};

export type ResultadoNotificacao = {
  ok: boolean;
  dry: boolean;
  ambiente: 'producao' | 'staging';
  gerado_em: string;
  /** Quantos líderes foram no lote (0 é um resultado VÁLIDO — ver §2). */
  lideres: number;
  liderados: number;
  projetos: number;
  /** Status HTTP do Gomoon (ausente em dry-run ou falha de rede). */
  status?: number;
  /** Itens que o Gomoon NÃO aceitou — o GoDocs loga quem não recebeu (§3). */
  falhas: { email: string; codigo: string }[];
  /** Itens ignorados por já terem sido entregues hoje (§4 — não é erro). */
  ja_entregues: number;
  erro?: string;
  /** Só no dry-run: o payload que SERIA enviado (a validação da staging olha isto). */
  payload?: PayloadLideresPendentes;
};

/** Resposta crua do POST. `erro` presente = não deu certo (HTTP ruim, rede ou timeout). */
type RespostaGomoon = { status?: number; texto: string; erro?: string };

/**
 * O POST ao Gomoon — compartilhado pelo aviso diário e pelo anúncio.
 *
 * NUNCA lança: devolve o erro no campo `erro`. Quem chama é cron ou rota admin, e
 * uma exceção viraria 500 opaco no log da plataforma.
 */
async function postGomoon(url: string, token: string, payload: unknown): Promise<RespostaGomoon> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const texto = await resp.text().catch(() => '');
    if (!resp.ok) {
      // 400 = lote inteiro rejeitado (JSON/origem/ambiente/gerado_em) · 401 = token.
      console.error(`[gomoon] POST recusado (${resp.status}): ${texto.slice(0, 500)}`);
      return { status: resp.status, texto, erro: texto.slice(0, 500) || `HTTP ${resp.status}` };
    }
    return { status: resp.status, texto };
  } catch (e) {
    const abortou = e instanceof Error && e.name === 'AbortError';
    const msg = abortou ? `timeout de ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e);
    console.error('[gomoon] falha no POST:', msg);
    return { texto: '', erro: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lê o `resultados[]` da resposta (§3) — tolerante a corpo vazio ou não-JSON.
 *
 * `ja_entregue` vem com `ok:true`: é o comportamento CORRETO quando o disparo repete
 * (§4), não uma falha. Contamos à parte para o log não parecer um problema.
 *
 * ⚠️ O e-mail de reserva é resolvido pelo índice no array COMPLETO, antes do filtro —
 * filtrar primeiro e indexar depois atribuiria a falha ao líder errado no log.
 */
function resumirItens(
  texto: string,
  emailNoIndice: (i: number) => string | undefined,
): { itens: number; jaEntregues: number; falhas: { email: string; codigo: string }[] } {
  let itens: ResultadoItemGomoon[] = [];
  try {
    itens = (JSON.parse(texto)?.resultados as ResultadoItemGomoon[]) ?? [];
  } catch {
    itens = [];
  }
  const falhas = itens
    .map((i, idx) => ({
      ok: i?.ok !== false,
      email: i?.email ?? emailNoIndice(idx) ?? '(desconhecido)',
      codigo: i?.codigo ?? 'erro_interno',
    }))
    .filter((i) => !i.ok)
    .map(({ email, codigo }) => ({ email, codigo }));

  return {
    itens: itens.length,
    jaEntregues: itens.filter((i) => i?.codigo === 'ja_entregue').length,
    falhas,
  };
}

/** Contagens do relatório, derivadas do payload. */
function contarPayload(payload: PayloadLideresPendentes) {
  return {
    lideres: payload.lideres.length,
    liderados: payload.lideres.reduce((s, l) => s + l.liderados.length, 0),
    projetos: payload.lideres.reduce(
      (s, l) => s + l.liderados.reduce((t, d) => t + d.projetos_pendentes, 0),
      0,
    ),
  };
}

/**
 * Envia um payload já montado e resume a resposta. Compartilhado pelos DOIS disparos
 * (imediato por submissão e snapshot diário) — a checagem de token, o tratamento de
 * erro e a leitura do `resultados[]` são idênticos e não podem divergir.
 *
 * NUNCA lança: toda falha volta em `erro`.
 */
async function enviarPayload(
  payload: PayloadLideresPendentes,
  base: ResultadoNotificacao,
  rotulo: string,
): Promise<ResultadoNotificacao> {
  const contagem = contarPayload(payload);
  if (base.dry) return { ...base, ...contagem, ok: true, payload };

  const url = process.env.GOMOON_LIDERES_URL || URL_PADRAO;
  const token = (process.env.GOMOON_TOKEN || '').trim();
  if (!token) {
    // Defensivo como o resto das integrações: sem secret, não manda e diz por quê.
    console.warn(`[gomoon] GOMOON_TOKEN não configurado — ${rotulo} NÃO enviado.`);
    return { ...base, ...contagem, erro: 'GOMOON_TOKEN não configurado.' };
  }

  const resp = await postGomoon(url, token, payload);
  if (resp.erro) {
    return { ...base, ...contagem, status: resp.status, erro: resp.erro };
  }

  // 202 com resultado por item, na mesma ordem do array enviado (§3).
  const { jaEntregues, falhas } = resumirItens(resp.texto, (i) => payload.lideres[i]?.email);
  if (falhas.length) {
    console.error(
      `[gomoon] ${falhas.length} líder(es) não entraram na fila:`,
      falhas.map((f) => `${f.email}=${f.codigo}`).join(', '),
    );
  }
  console.log(
    `[gomoon] ${rotulo} enviado (${base.ambiente}): ${contagem.lideres} líder(es), ` +
      `${contagem.liderados} liderado(s), ${contagem.projetos} projeto(s) — HTTP ${resp.status}` +
      (jaEntregues ? ` · ${jaEntregues} já entregue(s)` : ''),
  );
  return { ...base, ...contagem, ok: true, status: resp.status, falhas, ja_entregues: jaEntregues };
}

/** Esqueleto do relatório, antes de saber o que foi montado. */
function baseResultado(dry: boolean): ResultadoNotificacao {
  return {
    ok: false,
    dry,
    ambiente: rotuloAmbienteExterno(),
    gerado_em: new Date().toISOString(),
    lideres: 0,
    liderados: 0,
    projetos: 0,
    falhas: [],
    ja_entregues: 0,
  };
}

/**
 * AVISO IMEDIATO (D26, 06/08/2026) — o disparo do caminho quente da submissão.
 *
 * Decisão do Luis (06/08/2026): o líder é avisado **na hora**, não na manhã seguinte.
 * A API do Gomoon nunca foi "diária" — ela entrega na hora em que recebe o POST (§9);
 * a cadência sempre foi escolha NOSSA. O aviso diário (`notificarLideresPendentes`)
 * continua existindo e testado, apenas não está agendado.
 *
 * ⚠️ Manda o BACKLOG INTEIRO do líder, não só o projeto que disparou. O gatilho é o
 * projeto novo; o conteúdo é "o que está te esperando agora". É o que devolve o efeito
 * de lembrete que o digest diário dava: quem ignorou a DM de ontem vê os dois projetos
 * na DM de hoje. Por isso a relação sai da MESMA agregada do diário — uma régua só, e
 * a DM nunca diverge do que a tela `/aprovacoes` mostra.
 *
 * ⚠️ NÃO manda `lideres: []`. A lista vazia é invariante do CRON (§2: prova de que o
 * run aconteceu num dia sem pendência); aqui ela só gastaria uma chamada — se a fila
 * do líder está vazia, não há o que avisar.
 *
 * NUNCA lança (D3): o chamador é o fim de `submeterParaValidacao`. Uma exceção aqui
 * derrubaria a submissão de alguém por causa de um aviso.
 */
export async function notificarLideresDoProjeto(
  projetoId: string,
  aprovadores: { email: string; nome: string | null }[],
  opts?: { dry?: boolean; nomeProjeto?: string | null },
): Promise<ResultadoNotificacao> {
  const base = baseResultado(opts?.dry === true);

  // Projeto de teste do harness não avisa ninguém. O filtro existe na agregada, mas
  // aqui ele precisa ser explícito: sem isto, uma submissão `[E2E-…]` (que a agregada
  // descarta) ainda dispararia a DM do BACKLOG do líder — um ping real por teste.
  if (ehProjetoTesteE2E(opts?.nomeProjeto)) {
    console.log(`[gomoon] ${projetoId} é projeto de teste E2E — aviso ao líder suprimido.`);
    return { ...base, ok: true };
  }

  const alvos = new Set(
    aprovadores.map((a) => (a.email ?? '').trim().toLowerCase()).filter(Boolean),
  );
  if (!alvos.size) return { ...base, ok: true };

  let payload: PayloadLideresPendentes;
  try {
    const linhas = (await getPendenciasPorLider()).filter((l) =>
      alvos.has((l.lider_email ?? '').trim().toLowerCase()),
    );
    payload = montarPayloadLideresPendentes(linhas, {
      ambiente: base.ambiente,
      geradoEm: base.gerado_em,
      appUrl: process.env.APP_BASE_URL ?? APP_PADRAO,
      chaveDe: (email) => chaveDeProjeto(email, projetoId),
    });
  } catch (e) {
    console.error('[gomoon] falha ao montar o aviso imediato ao líder:', e);
    return { ...base, erro: e instanceof Error ? e.message : String(e) };
  }

  if (!payload.lideres.length) {
    // A fila do líder ficou vazia entre abrir e avisar (projeto descontinuado, decidido
    // por outro líder, ou o próprio projeto filtrado). Nada a enviar — não é erro.
    return { ...base, ok: true };
  }

  return enviarPayload(payload, base, `aviso imediato (${projetoId})`);
}

/**
 * AVISO DO ESTÁGIO 2 — o líder do DONO DO PROJETO PAI, quando uma NOVA FEATURE (projeto
 * vinculado) entra na fila dele. Mesmo canal do aviso imediato (Gomoon, D17), mas com
 * COPY PRÓPRIA (`renderMensagemLiderFeature`): deixa claro que é uma feature nova no
 * projeto DELE, não um projeto solto de um liderado.
 *
 * ⚠️ Guard `[E2E-…]` explícito (o nome do filho carrega a tag do harness). Idempotência
 * por PROJETO-FEATURE (`chaveDeProjeto`). NUNCA lança (mesma régua do imediato).
 */
export async function notificarLiderDoProjetoPai(
  filhoId: string,
  aprovadores: { email: string; nome: string | null }[],
  dados: { autorNome: string; autorEmail: string; projetoPaiNome: string; featureNome: string },
  opts?: { dry?: boolean },
): Promise<ResultadoNotificacao> {
  const base = baseResultado(opts?.dry === true);

  if (ehProjetoTesteE2E(dados.featureNome)) {
    console.log(`[gomoon] feature ${filhoId} é teste E2E — aviso ao líder do pai suprimido.`);
    return { ...base, ok: true };
  }

  const alvos = aprovadores
    .map((a) => ({ email: (a.email ?? '').trim().toLowerCase(), nome: a.nome }))
    .filter((a) => a.email);
  if (!alvos.length) return { ...base, ok: true };

  const appUrl = process.env.APP_BASE_URL ?? APP_PADRAO;
  const url = `${origemDe(appUrl, APP_PADRAO)}/aprovacoes`;

  const payload: PayloadLideresPendentes = {
    origem: 'godocs',
    ambiente: base.ambiente,
    gerado_em: base.gerado_em,
    lideres: alvos.map((a) => ({
      email: a.email,
      nome: a.nome,
      url,
      idempotency_key: chaveDeProjeto(a.email, filhoId),
      // `liderados` nunca vazio (§3): a "liderada" aqui é a pessoa que implementou a
      // feature. A CONTAGEM é 1 (esta feature). O texto real vai em `mensagem`.
      liderados: [
        {
          nome: dados.autorNome || derivarNomeDeEmail(dados.autorEmail || a.email),
          email: (dados.autorEmail ?? '').trim().toLowerCase(),
          projetos_pendentes: 1,
        },
      ],
      mensagem: {
        texto: renderMensagemLiderFeature({
          nome: a.nome,
          autorNome: dados.autorNome,
          projetoPaiNome: dados.projetoPaiNome,
          featureNome: dados.featureNome,
        }),
      },
    })),
  };

  return enviarPayload(payload, base, `aviso feature ao líder do pai (${filhoId})`);
}

/**
 * SNAPSHOT DIÁRIO — o aviso em lote, disparado por cron.
 *
 * ⚠️ Continua implementado e testado, mas **não está agendado** desde a D26: quem avisa
 * o líder é o disparo imediato acima. Ligar de volta é criar o cron
 * `0 12 * * 1-5 → POST /api/cron/notificar-lideres` — as chaves de idempotência são
 * independentes (dia × projeto), então os dois convivem sem se anular.
 *
 * NUNCA lança — o chamador é um cron: uma exceção viraria 500 opaco no log da
 * plataforma. Toda falha volta como `ok:false` + `erro`, e o corpo da resposta do
 * cron é o próprio relatório.
 *
 * `dry: true` monta o payload e NÃO envia nada (é como se valida sem cutucar ninguém).
 */
export async function notificarLideresPendentes(
  opts?: { dry?: boolean },
): Promise<ResultadoNotificacao> {
  const base = baseResultado(opts?.dry === true);

  let payload: PayloadLideresPendentes;
  try {
    const linhas = await getPendenciasPorLider();
    payload = montarPayloadLideresPendentes(linhas, {
      ambiente: base.ambiente,
      geradoEm: base.gerado_em,
      appUrl: process.env.APP_BASE_URL ?? APP_PADRAO,
    });
  } catch (e) {
    console.error('[gomoon] falha ao montar o snapshot de pendências:', e);
    return { ...base, erro: e instanceof Error ? e.message : String(e) };
  }

  return enviarPayload(payload, base, 'snapshot');
}
