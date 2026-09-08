// Notificação via webhook do Google Chat (não precisa de auth Google — URL contém key+token).

import type { ResumoGanho } from '@/lib/notificacao-ganho';

// Projetos de teste E2E (nome com prefixo "[E2E-") NÃO notificam o Google Chat —
// o harness de validação roda contra produção e gravaria N pings no espaço do time.
// A gravação na planilha continua normal (é o alvo da validação); só o Chat é mudo.
// Ver scripts/e2e/ e CLAUDE.md. Reverter junto com o harness quando a validação terminar.
export function ehProjetoTesteE2E(nome: string | null | undefined): boolean {
  return typeof nome === 'string' && nome.startsWith('[E2E-');
}

/**
 * Uma mensagem para o Chat: **texto** simples ou um **card** (cardsV2).
 *
 * ⚠️ O card carrega `fallbackTexto` OBRIGATÓRIO, e ele não é decoração: o card do alerta
 * usa seções colapsáveis (o "exibir mais"), e se algum dia o webhook recusar um campo do
 * schema a mensagem NÃO PODE simplesmente não sair — perder o alerta é pior do que
 * perder o layout. Ver `sendChatNotification`.
 */
export type MensagemChat = string | { cardsV2: unknown[]; fallbackTexto: string };

// Envia uma notificação a um espaço do Google Chat. Por padrão usa o webhook de PROJETOS
// (GOOGLE_CHAT_WEBHOOK_URL); `opts.webhookUrl` permite apontar para outro espaço (ex.: o
// webhook do widget de Ajuda, GOOGLE_CHAT_WEBHOOK_URL_AJUDA).
// Defensivo: sem URL → warn + no-op. Retorna `true` só quando o Chat aceitou (200),
// para o chamador registrar o resultado (ex.: chat_status do chamado de ajuda).
//
// ⚠️ **DEGRADAÇÃO PARA TEXTO (08/09/2026).** Quando a mensagem é um CARD e o Chat recusa,
// a função reenvia a MESMA informação como texto plano antes de desistir. Motivo: o card
// do alerta é montado com `collapsible`, que é o que dá o "exibir mais" pedido pelo Luis —
// e um campo do schema que o webhook não aceite devolveria 400 e mataria o alerta INTEIRO,
// em silêncio, exatamente no grupo onde a triagem descobre que existe projeto novo. O
// texto é feio e é o certo: é o único caminho que garante que a informação sai.
// ⚠️ O retry vale só para o card (texto que falhou não tem para onde degradar) e é UMA
// tentativa — não é retry de rede/cota, é degradação de FORMATO.
export async function sendChatNotification(
  message: MensagemChat,
  opts?: { webhookUrl?: string },
): Promise<boolean> {
  const webhookUrl = opts?.webhookUrl ?? process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[google/chat] webhook do Google Chat não configurado, pulando notificação');
    return false;
  }

  const ehCard = typeof message !== 'string';
  const corpo = ehCard ? { cardsV2: message.cardsV2 } : { text: message };

  const postar = async (payload: unknown): Promise<boolean> => {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[google/chat] Falha ao enviar notificação (${resp.status}): ${body}`);
      return false;
    }
    return true;
  };

  try {
    if (await postar(corpo)) return true;
    if (!ehCard) return false;
    console.warn('[google/chat] card recusado — reenviando como texto plano (degradação de formato).');
    return await postar({ text: message.fallbackTexto });
  } catch (e) {
    console.error('[google/chat] Erro ao enviar notificação:', e);
    return false;
  }
}

// ─── Builders de mensagem ─────────────────────────────────────────────────

const SEPARATOR = '──────────────────────';

// Base do app em produção; fallback quando `APP_BASE_URL` não está setada.
const APP_BASE_PADRAO = 'https://godocs.devgogroup.com';

// Link para a FICHA do projeto no /dashboard (a esteira de triagem do admin). O grupo
// do Chat é lido só por admin, então o alerta leva direto ao card em vez de à planilha:
// `?projeto=<id>` abre o overlay da ficha (ver routes/_authenticated/dashboard.tsx).
// Sem id → raiz do dashboard. ⚠️ `process.env` é lido DENTRO da função (nunca no topo
// do módulo — derruba o worker no bootstrap do Godeploy; ver CLAUDE.md). `APP_BASE_URL`
// pode carregar um caminho (o disparo de e-mails usa a URL inteira), então extraímos só
// a origem — mesma armadilha tratada em `origemDe` de gomoon-lideres.functions.ts.
export function linkDashboardProjeto(projetoId?: string | null): string {
  const bruto = process.env.APP_BASE_URL ?? APP_BASE_PADRAO;
  let origem: string;
  try {
    origem = new URL(bruto).origin;
  } catch {
    origem = APP_BASE_PADRAO;
  }
  return projetoId
    ? `${origem}/dashboard?projeto=${encodeURIComponent(projetoId)}`
    : `${origem}/dashboard`;
}

// Teto dos textos livres dentro do card (descrição, "por que é especial", racionais,
// evidência). O alerta é para bater o olho e decidir se abre a ficha — o texto inteiro
// está na planilha e em `/dashboard?projeto=<id>`.
//
// ⚠️ O teto NÃO é o que dá a compactação (isso é a seção `collapsible`, abaixo): ele
// existe para proteger o PAYLOAD. Um card do Chat tem limite de tamanho, e descrição +
// racional + evidência de um projeto grande passam fácil de alguns milhares de
// caracteres. Card grande demais é recusado, e a mensagem não sai.
const LIMITE_TEXTO_CARD = 1200;

function truncar(texto: string, limite = LIMITE_TEXTO_CARD): string {
  const t = texto.trim();
  return t.length <= limite ? t : `${t.slice(0, limite).trimEnd()}…`;
}

// Teto do título do card (o nome do projeto). Nome longo empurra o subtítulo para fora.
const LIMITE_TITULO = 90;

// ─── o card (cardsV2) ───────────────────────────────────────────────────────
//
// ⚠️ **O alerta virou CARD em 08/09/2026** (era texto plano com 20 linhas de `*negrito*`).
// O pedido do Luis foi "deixa o card mais compacto, comprimindo para 'exibir mais' em
// campos como descrição resumida, para caso eu queira ler o que está escrito ou não" — e
// "exibir mais" **não existe em mensagem de texto**: quem o dá é a seção `collapsible` do
// cardsV2, que o Chat desenha com um botão de expandir.
//
// ⚠️ **MARKUP: `<b>`/`<i>`, NUNCA `*asterisco*`.** O Chat tem duas sintaxes que não se
// conversam — mensagem de TEXTO usa `*negrito*`; `textParagraph` de CARD usa HTML. É a
// mesma armadilha do D22 (o 1º disparo do Gomoon chegou com asterisco literal na tela).
// A sintaxe segue a SUPERFÍCIE: se o alerta voltar a ser texto, o markup volta junto.
// ⚠️ `<a href>` também não funciona em card (sai escapado) — o link vai no `buttonList`.

/** Uma linha "rótulo · valor" do card. Vira um `decoratedText`. */
type WidgetCard = Record<string, unknown>;

/**
 * Uma linha do card: **rótulo em cima, em negrito; valor embaixo**.
 *
 * ⚠️ O rótulo vai no campo `text`, não no `topLabel` — e isso é a correção de 08/09/2026
 * (pedido do Luis: "deixa um pouco maior os subtítulos, para diferenciar dos textos
 * informativos"). O `topLabel` do `decoratedText` tem **tamanho FIXO e miúdo** no Chat, e
 * card não aceita CSS: não existe como aumentá-lo. O que existe é promover o rótulo para o
 * corpo (que é o tamanho normal do card) e diferenciá-lo do valor pelo **peso**. Por isso
 * o `<b>` está no rótulo e NÃO no valor — inclusive na linha de destaque, onde o negrito
 * antes estava no número: com os dois em negrito não haveria hierarquia nenhuma.
 *
 * ⚠️ A quebra é **`<br>`**, não `\n`: em card, `\n` é honrado no `textParagraph`, e o
 * `decoratedText` é outro widget. `<br>` está na allowlist de tags do Chat (ver a nota de
 * markup acima) — qualquer tag fora dela sai ESCAPADA na tela.
 *
 * ⚠️ `bottomLabel` (a nota) segue no campo pequeno de propósito: ele é o 3º nível da
 * hierarquia (rótulo > valor > nota) e é o que mantém a linha com uma altura só.
 */
function linha(rotulo: string, valor: string, nota?: string | null): WidgetCard {
  const w: Record<string, unknown> = {
    text: `<b>${rotulo}</b><br>${valor}`,
    wrapText: true,
  };
  // ⚠️ `bottomLabel` só quando há texto: string vazia desenha uma faixa em branco sob a
  // linha e afrouxa justamente a compactação que este card existe para ganhar.
  const n = (nota ?? '').trim();
  if (n) w.bottomLabel = n;
  return { decoratedText: w };
}

function paragrafo(rotulo: string, texto: string): WidgetCard {
  return { textParagraph: { text: `<b>${rotulo}</b>\n${truncar(texto)}` } };
}

/**
 * Uma seção que nasce FECHADA, com botão de expandir.
 *
 * ⚠️ `uncollapsibleWidgetsCount: 0` é o que mantém a seção inteira atrás do botão. Deixar
 * 1 aqui vazaria a primeira linha (a descrição) para a área visível e desfaria o pedido.
 */
function secaoColapsavel(header: string, widgets: WidgetCard[]): Record<string, unknown> | null {
  if (widgets.length === 0) return null;
  return { header, collapsible: true, uncollapsibleWidgetsCount: 0, widgets };
}

// ─── Builder do alerta de projeto ───────────────────────────────────────────

export type ParamsSubmitMessage = {
  // ID do projeto — vira o link `/dashboard?projeto=<id>` que abre a ficha direto.
  // Ausente → o link cai na raiz do dashboard (nunca deixa o alerta sem caminho).
  projetoId?: string;
  projeto: string;
  area: string;
  ferramenta: string;
  escopo: string;
  nomeCompleto: string;
  email: string;
  participantes: string;
  descricao: string;
  dataSubmissao: string;
  /**
   * O ganho do projeto, já resumido por `src/lib/notificacao-ganho.ts` (v1 ou v2).
   *
   * ⚠️ Aqui **não há** mais `savingHoras`/`savingReais`/`tipoSaving`/`receitaValor`: eram
   * as colunas da v1, que o formulário da v2 nunca escreve, e é por isso que o card
   * anunciava R$ 0,00 e 0 horas em projeto com ganho declarado. Quem sabe de qual geração
   * o número sai é o módulo de resumo; este builder só desenha.
   */
  ganho: ResumoGanho;
  // Distingue o alerta entre SUBMISSÃO nova e EDIÇÃO de um projeto já cadastrado.
  modo: 'novo' | 'edicao';
  // Projeto especial: pula o analisador e vai direto para avaliação humana. Não tem
  // ganho declarado — o card OMITE a seção de números e destaca a justificativa do
  // porquê é especial (`contextoEspecial`).
  especial?: boolean;
  contextoEspecial?: string;
  // Por que este projeto NÃO tem parecer de líder (autor é liderança / sem líder na
  // TeamGuide / TeamGuide fora). Vem pronta e CURTA de `decidirMomentoNotificacao`
  // (`src/lib/notificacao-chat.ts` — FONTE ÚNICA do texto). Vazia/null → nenhuma linha:
  // quem entra em fila não recebe alerta na submissão, e sim quando o líder libera.
  notaPreAprovacao?: string | null;
  // Parecer do líder que DISPAROU esta mensagem. Presente → o alerta deixa de ser
  // "aguardando análise" e passa a anunciar a pré-aprovação, assinada.
  preAprovacao?: { por: string; em: string } | null;
};

/** O estado do projeto, em uma linha, para o subtítulo do card. */
function subtituloDe(p: ParamsSubmitMessage): string {
  if (p.especial) {
    return p.modo === 'edicao'
      ? '⭐ Projeto especial reenviado · avaliação humana'
      : '⭐ Projeto especial · avaliação humana';
  }
  if (p.preAprovacao) return `✅ Pré-aprovado pelo líder · aguardando análise`;
  return p.modo === 'edicao'
    ? '✏️ Edição reenviada · aguardando análise'
    : '🚨 Nova submissão · aguardando análise';
}

/**
 * O card do "Alerta de Automações": um projeto chegando à triagem.
 *
 * Compacto por construção: o que decide se vale abrir a ficha fica VISÍVEL (estado, ganho,
 * área, autor, pré-aprovação) e todo o resto — descrição, racionais, evidência,
 * metadados — vive em duas seções `collapsible`. Ver o bloco de comentário acima.
 */
export function buildSubmitMessage(p: ParamsSubmitMessage): MensagemChat {
  const link = linkDashboardProjeto(p.projetoId);

  // ── visível: só o que decide se vale abrir a ficha ──
  const resumo: WidgetCard[] = [];

  // O parecer (ou a razão de não haver um) vem PRIMEIRO: é o que diz se o projeto já pode
  // ser analisado. ⚠️ Ausente nos dois campos → nenhuma linha (o projeto está em fila, e
  // nesse caso este alerta nem é disparado).
  if (p.preAprovacao) {
    resumo.push(linha('Pré-aprovação do líder', p.preAprovacao.por, `em ${p.preAprovacao.em}`));
  } else if ((p.notaPreAprovacao ?? '').trim()) {
    resumo.push(linha('Pré-aprovação do líder', (p.notaPreAprovacao ?? '').trim()));
  }

  if (!p.especial) {
    if (p.ganho.destaque) {
      resumo.push(linha(p.ganho.destaque.rotulo, p.ganho.destaque.valor, p.ganho.destaque.nota));
    } else if (p.ganho.semNumero) {
      // ⚠️ Diz "sem número declarado" em vez de mostrar R$ 0,00 — que é o que o card fazia
      // e que se lê como bug do sistema, não como característica do projeto (é o caso
      // legítimo do ganho imensurável, onde o que representa o valor é a estrela).
      resumo.push(linha('Ganho', 'Sem número declarado (ganho imensurável)'));
    }
    resumo.push(linha('Ganhos declarados', p.ganho.categorias));
  }

  // ⚠️ A nota "Tipo: …" SAIU daqui (decisão do Luis, 08/09/2026). Ela mostrava o eixo TIPO da
  // categorização (`agente`/`sistema`/`app`/`dashboard`/`automacao`), mas ao lado de "Área" e com
  // o rótulo "Tipo" era lida como **tipo de GANHO** — informação que o card já dá em "Ganhos
  // declarados", logo acima. Pior: na prática ela saía **"Tipo: —"**, porque a coluna
  // `Tipo de Projeto` da planilha nunca está AUSENTE (o analisador grava o travessão), e o
  // "ausente omite a linha" nunca disparava. Redundante quando preenchida, errada quando não.
  // ⚠️ `rotuloTipoProjeto` FICA em `notificacao-ganho.ts`, testada: se um dia a linha voltar, ela
  // volta com rótulo próprio ("Categoria"), não pendurada na Área.
  resumo.push(linha('Área', p.area));
  resumo.push(linha('Autor', p.nomeCompleto, p.email));

  // ── colapsável 1: os números por bloco (só v1/v2 com ganho) ──
  const numeros: WidgetCard[] = p.especial
    ? []
    : p.ganho.detalhe.map((d) => linha(d.rotulo, d.valor, d.nota));

  // ── colapsável 2: descrição e contexto (o "exibir mais" que o Luis pediu) ──
  const contexto: WidgetCard[] = [];
  if ((p.descricao ?? '').trim()) contexto.push(paragrafo('Descrição resumida', p.descricao));
  if (p.especial) {
    contexto.push(
      paragrafo('Por que é um projeto especial', (p.contextoEspecial ?? '').trim() || '—'),
    );
  }
  for (const t of p.ganho.textos) contexto.push(paragrafo(t.rotulo, t.texto));
  contexto.push(linha('Ferramenta', p.ferramenta, p.escopo ? `Escopo: ${p.escopo}` : null));
  contexto.push(linha('Participantes', p.participantes || '—'));
  contexto.push(linha('Data da submissão', p.dataSubmissao));

  const secoes: Record<string, unknown>[] = [{ widgets: resumo }];
  const secaoNumeros = secaoColapsavel('Números do ganho', numeros);
  if (secaoNumeros) secoes.push(secaoNumeros);
  const secaoContexto = secaoColapsavel('Descrição e contexto', contexto);
  if (secaoContexto) secoes.push(secaoContexto);
  secoes.push({
    widgets: [
      {
        buttonList: {
          buttons: [{ text: 'Abrir a ficha no dashboard', onClick: { openLink: { url: link } } }],
        },
      },
    ],
  });

  return {
    cardsV2: [
      {
        cardId: 'godocs-projeto',
        card: {
          header: { title: truncar(p.projeto || '—', LIMITE_TITULO), subtitle: subtituloDe(p) },
          sections: secoes,
        },
      },
    ],
    // Degradação: a MESMA informação em texto plano, caso o webhook recuse o card.
    fallbackTexto: fallbackTextoDe(p, link),
  };
}

/**
 * A versão texto plano do alerta — usada **só** quando o webhook recusa o card.
 *
 * ⚠️ Aqui o markup volta a ser `*asterisco*`, porque a superfície volta a ser MENSAGEM DE
 * TEXTO (ver a nota de markup acima). Não copiar `<b>` para cá.
 * ⚠️ Sem "exibir mais" possível, os textos longos ficam de FORA e sobra o link: o
 * fallback existe para o alerta EXISTIR, não para reproduzir o card.
 */
function fallbackTextoDe(p: ParamsSubmitMessage, link: string): string {
  const linhas = [
    `${subtituloDe(p)}`,
    `*${p.projeto || '—'}*`,
    '',
    `📌 *Área:* ${p.area}`,
    `👤 *Autor:* ${p.nomeCompleto} (${p.email})`,
  ];
  if (p.preAprovacao) {
    linhas.push(`👍 *Pré-aprovado por:* ${p.preAprovacao.por} em ${p.preAprovacao.em}`);
  } else if ((p.notaPreAprovacao ?? '').trim()) {
    linhas.push(`ℹ️ ${(p.notaPreAprovacao ?? '').trim()}`);
  }
  if (!p.especial) {
    linhas.push('', `📂 *Ganhos declarados:* ${p.ganho.categorias}`);
    if (p.ganho.destaque) {
      linhas.push(`💰 *${p.ganho.destaque.rotulo}:* ${p.ganho.destaque.valor}`);
    } else if (p.ganho.semNumero) {
      linhas.push('💰 *Ganho:* sem número declarado (ganho imensurável)');
    }
    for (const d of p.ganho.detalhe) linhas.push(`• ${d.rotulo}: ${d.valor}`);
  }
  linhas.push('', `🔎 *Abrir a ficha no dashboard:* ${link}`);
  return linhas.join('\n');
}

// ⚠️ `buildUpdateMessage` foi REMOVIDO em 11/08/2026 — não reimplementar aqui.
// Ele montava o "🚨 Novo fluxo de automação cadastrado – Análise Pendente" que o
// `syncUpdateToGoogle` disparava depois do analisador: era a MESMA notificação por
// submissão com outra roupa, e mantê-la anularia a mudança de o grupo só ser avisado
// quando o líder pré-aprova. Passou a ser 1 mensagem por projeto (ver
// `src/lib/notificacao-chat.ts` e a seção "Sync Google" do CLAUDE.md).

// Mensagem do widget de Ajuda & Suporte. Mão única: a pessoa envia, Luis+Kaique
// leem no espaço dedicado. O print (quando há) vai como LINK do Drive — texto plain,
// sem card (decisão D3 da spec). A linha do print é OMITIDA quando não há anexo.
export type TipoAjuda = 'duvida' | 'problema' | 'sugestao';

export function buildAjudaMessage(p: {
  tipo: TipoAjuda;
  nome: string;
  email: string;
  mensagem: string;
  pagina?: string | null;
  printLink?: string | null;
  data: string;
}): string {
  // Cabeçalho BEM distinto por tipo (emoji inconfundível + rótulo MAIÚSCULO), pra
  // bater o olho no Chat e saber na hora se é dúvida, erro ou sugestão.
  const CABECALHO: Record<TipoAjuda, string> = {
    duvida: '❓ *DÚVIDA no GoDocs*',
    problema: '\u{1F41E} *PROBLEMA / ERRO no GoDocs*',
    sugestao: '\u{1F4A1} *SUGESTÃO DE MELHORIA no GoDocs*',
  };
  const cabecalho = CABECALHO[p.tipo];

  const lines = [
    SEPARATOR,
    '',
    cabecalho,
    '',
    `\u{1F464} *De:* ${p.nome} (${p.email})`,
    `\u{1F4C4} *Página:* ${p.pagina || '—'}`,
    `\u{1F552} *Quando:* ${p.data}`,
    '',
    `\u{1F4DD} *Mensagem:*`,
    p.mensagem,
  ];

  if (p.printLink) {
    lines.push('', `\u{1F5BC}️ *Print:* ${p.printLink}`);
  }

  lines.push('', SEPARATOR);
  return lines.join('\n');
}
