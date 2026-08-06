// Os TEXTOS que o Gomoon entrega por DM no Google Chat (D21, 06/08/2026).
//
// FONTE ÚNICA das duas mensagens da pré-aprovação do líder. Módulo PURO (nenhum
// I/O, nenhum `process.env`) — a montagem do payload e o envio ficam em
// `gomoon-lideres.functions.ts`; aqui só mora a redação.
//
// ⚠️ QUEM REDIGE É O GODOCS, QUEM ENTREGA É O GOMOON. O texto viaja PRONTO no
// campo `mensagem.texto` do payload (§3/§13 do contrato) porque:
//  • o `total` é a SOMA dos liderados, a lista precisa de bullets, o plural muda a
//    frase e a data sai em fuso de Brasília — pedir isso a um template do outro lado
//    significaria um mini-engine lá e a cópia morando em dois repos;
//  • mudar uma vírgula do texto passa a ser deploy NOSSO, não deles.
// O Gomoon mantém o template interno como FALLBACK (se `mensagem` faltar, ele
// renderiza o dele) — é o que permite os dois lados deployarem em qualquer ordem.
//
// ⚠️ Markup: **HTML de CARD**, não o `*asterisco*` de mensagem de texto (06/08/2026).
// O Google Chat tem DUAS sintaxes que não se conversam, e o Gomoon entrega o nosso
// texto dentro de um `cardsV2`/`TextParagraph`:
//   • mensagem de texto (campo `text`) → `*negrito*`, `_itálico_`, `~riscado~`;
//   • card (`TextParagraph`)           → `<b>`, `<i>`, `<u>`, `<s>`, `<a href>`.
// Asterisco dentro de card NÃO é interpretado — vira asterisco literal na tela (foi
// exatamente o que chegou no 1º disparo de staging: "*Você tem projeto…*" cru). Se um
// dia a entrega virar mensagem de texto simples, este arquivo TEM de voltar ao
// asterisco: a sintaxe segue a superfície, não o gosto.
// `\n` está comprovadamente preservado pelo card do Gomoon (conferido no print do
// disparo de 06/08) — por isso não usamos `<br>`. `•` e emoji são caracteres literais.
// Sem Markdown de link (`[texto](url)` não renderiza); a URL vai crua ou em `<a href>`.
//
// ⚠️ O aviso ao líder NÃO repete título nem link: o card do Gomoon já traz o cabeçalho
// ("📋 Pré-aprovação pendente") e o botão "Abrir a fila" (que usa o `url` do payload,
// campo separado). Escrever os dois aqui duplicava a frase e o link na mesma DM. O
// ANÚNCIO mantém o título, porque lá o cabeçalho do card é genérico ("GoDocs").
// ⚠️ NENHUM VALOR EM R$ nos textos (§7.1 do contrato) — DM se lê por cima do ombro.
// Nome, e-mail e CONTAGEM de projetos são tudo o que pode aparecer.

/**
 * Versão do anúncio de abertura. A chave de idempotência do Gomoon entrega esse
 * texto **uma vez por pessoa, para sempre** — então mexer na redação NÃO reenvia
 * nada. Só um `v2` explícito reabre o disparo (e aí todo mundo recebe de novo).
 */
export const ANUNCIO_VERSAO = 'v1';

/** `godocs:anuncio:<assunto>:<versão>` — SEM data, ao contrário do aviso diário (§13). */
export const ANUNCIO_CHAVE = `godocs:anuncio:pre-aprovacao-lider:${ANUNCIO_VERSAO}`;

/**
 * Anúncio de abertura da feature — uma vez, para a empresa.
 *
 * ⚠️ Cada afirmação daqui foi conferida contra o código (06/08/2026); as duas que
 * costumam envelhecer:
 *  • *"cargo de coordenação para cima"* é a **D20** (`ehCargoDeLideranca`,
 *    `src/lib/cargo-lideranca.ts`) — supervisor NÃO isenta. Se a régua mudar, este
 *    texto muda junto.
 *  • *"o que corrigir fica visível em Meus Projetos"* é o que o app realmente faz
 *    (`src/routes/meus-projetos.tsx`): o autor VÊ o selo e o texto do líder no card,
 *    mas **ninguém o avisa** (não há DM nem e-mail para o autor). Por isso a frase
 *    diz "fica visível", não "você recebe" — não prometer aviso que não existe.
 *  • A entrada da fila é a FAIXA da página inicial ("Pré-aprovações do meu time"),
 *    não um item de menu: não existe menu "GoDocs → Pré-aprovações".
 */
export const TEXTO_ANUNCIO_PRE_APROVACAO = [
  '<b>Novidade no GoDocs: os projetos agora passam por uma pré-aprovação do líder</b> 🚀',
  '',
  'Todo projeto submetido no GoDocs passa a ter uma <b>pré-aprovação do líder direto</b> ' +
    'antes de chegar à validação do time de RPA & IA.',
  '',
  '<b>Como funciona</b>',
  '• Você submete o projeto normalmente — o formulário não mudou.',
  '• Seu líder é avisado por aqui e abre a fila dele pela faixa <b>Pré-aprovações do meu time</b>, ' +
    'na página inicial do GoDocs.',
  '• Ele responde três perguntas rápidas (o projeto move um indicador da área? a área ' +
    'sentiria falta se ele parasse de rodar? o ganho declarado faz sentido?) e então ' +
    '<b>pré-aprova</b> ou <b>pede um ajuste</b>.',
  '• Pediu ajuste? O que precisa ser corrigido fica visível no seu projeto em ' +
    '<b>Meus Projetos</b> — é só editar e reenviar.',
  '',
  '<b>O que muda para você</b>',
  '• A pré-aprovação <b>não substitui</b> a validação do time de RPA & IA: ela vem antes e ' +
    'traz o olhar de quem conhece a rotina da área.',
  '• Quem tem cargo de coordenação para cima não passa por essa etapa — o projeto segue ' +
    'direto para a validação.',
  '• A relação líder ↔ liderado vem do organograma da TeamGuide. Se o seu líder aparecer ' +
    'errado, fale com a gente: uma vez ajustado lá, as próximas submissões já saem certas.',
  '',
  'Dúvidas? Chame o time de RPA & IA ou use o botão de ajuda dentro do GoDocs.',
].join('\n');

/**
 * `DD/MM às HHh` no fuso de **Brasília**. Função pura.
 *
 * A hora sai do `gerado_em`, não é fixa em "09h": o cron roda às 09h BRT, mas o
 * disparo manual (`/api/admin/notificar-lideres`) roda a qualquer hora — carimbar
 * 09h ali seria mentira dentro da própria DM. `en-GB` + `h23` para o formato não
 * depender do ICU do runtime (`pt-BR` com só `hour` devolve "09 h" em algumas
 * versões, e `hour12:false` sozinho pode devolver "24" à meia-noite).
 */
export function dataHoraBRT(iso: string): string {
  const d = new Date(iso);
  const valida = Number.isNaN(d.getTime()) ? new Date() : d;
  const dia = valida.toLocaleDateString('en-GB', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(valida);
  return `${dia} às ${hora}h`;
}

/** Primeiro nome, para a saudação ("Oi, Lucas!" em vez de "Oi, Lucas Queiroz!"). */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

const plural = (n: number, palavra: string) => `${n} ${palavra}${n > 1 ? 's' : ''}`;

/**
 * Aviso recorrente ao líder (bot → líder), já renderizado. Função PURA.
 *
 * Três formas, porque a frase única ficava errada nos extremos:
 *  • vários liderados → "N projetos da sua equipe" + bullets;
 *  • um liderado → nomeia a pessoa e dispensa a lista de 1 item;
 *  • um projeto → concordância no singular ("está aguardando").
 *
 * A linha da data existe porque o número pode envelhecer entre o disparo e a
 * leitura (§7.2): se outro líder decidir no meio, a tela mostra menos projetos que
 * a DM. Com a data ao lado isso é informação; sem ela, parece sistema quebrado.
 */
export function renderMensagemLider(
  lider: {
    nome: string | null;
    url: string;
    liderados: { nome: string; projetos_pendentes: number }[];
  },
  geradoEm: string,
): string {
  const total = lider.liderados.reduce((s, d) => s + d.projetos_pendentes, 0);
  const primeiro = primeiroNome(lider.nome);
  const saudacao = primeiro ? `Oi, ${primeiro}! ` : 'Oi! ';

  const linhas: string[] = [];

  if (lider.liderados.length === 1) {
    const so = lider.liderados[0];
    const verbo = total > 1 ? 'estão aguardando' : 'está aguardando';
    linhas.push(
      `${saudacao}<b>${plural(total, 'projeto')}</b> de <b>${so.nome}</b> ${verbo} a sua pré-aprovação.`,
    );
  } else {
    linhas.push(
      `${saudacao}<b>${plural(total, 'projeto')}</b> da sua equipe estão aguardando a sua pré-aprovação:`,
      '',
      ...lider.liderados.map((d) => `• ${d.nome} — ${plural(d.projetos_pendentes, 'projeto')}`),
    );
  }

  linhas.push(
    '',
    'São três perguntas rápidas por projeto, e você pode <b>pré-aprovar</b> ou <b>pedir ajuste</b> na própria tela.',
    '',
    `<i>Situação em ${dataHoraBRT(geradoEm)}. Se você já decidiu depois disso, pode ignorar esta mensagem.</i>`,
  );

  return linhas.join('\n');
}
