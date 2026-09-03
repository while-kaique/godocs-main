// O TEXTO que o Gomoon entrega por DM no Google Chat (D21, 06/08/2026).
//
// FONTE ÚNICA do aviso ao líder. Módulo PURO (nenhum I/O, nenhum `process.env`) — a
// montagem do payload e o envio ficam em `gomoon-lideres.functions.ts`; aqui só mora
// a redação.
//
// ⚠️ QUEM REDIGE É O GODOCS, QUEM ENTREGA É O GOMOON. O texto viaja PRONTO no
// campo `mensagem.texto` do payload (§3/§13 do contrato) porque:
//  • o `total` é a SOMA dos liderados, a lista precisa de bullets, o plural muda a
//    frase — pedir isso a um template do outro lado significaria um mini-engine lá e
//    a cópia morando em dois repos;
//  • mudar uma vírgula do texto passa a ser deploy NOSSO, não deles.
// O Gomoon mantém o template interno como FALLBACK (se `mensagem` faltar, ele
// renderiza o dele) — é o que permite os dois lados deployarem em qualquer ordem.
//
// ⚠️ **O ANÚNCIO GLOBAL SAIU DAQUI (D24, 06/08/2026).** A mensagem única de abertura
// da feature passou a ser responsabilidade do GOMOON: eles guardam o texto e fazem o
// disparo. O GoDocs não manda mais anúncio nenhum — `TEXTO_ANUNCIO_PRE_APROVACAO`,
// `ANUNCIO_VERSAO`/`ANUNCIO_CHAVE`, `montarPayloadAnuncio`, `anunciarPreAprovacao` e a
// rota `/api/admin/anunciar-pre-aprovacao` foram REMOVIDOS. **Não reimplementar aqui.**
// O texto acordado (com os ajustes do chefe do Luis: sem a lista das 3 perguntas, com
// a opção "reprova", "coordenação+ vai direto para a validação do time de RPA") está
// registrado em `docs/integracao-gomoon-chat.md` — é lá que se confere o que foi
// combinado, e é o Gomoon quem versiona a entrega.
//
// ⚠️ Markup: **HTML de CARD**, não o `*asterisco*` de mensagem de texto. O Google Chat
// tem DUAS sintaxes que não se conversam, e o Gomoon entrega o nosso texto dentro de um
// `cardsV2`/`TextParagraph`:
//   • mensagem de texto (campo `text`) → `*negrito*`, `_itálico_`, `~riscado~`;
//   • card (`TextParagraph`)           → `<b>`, `<i>`, `<u>`, `<s>` e `<br>`.
// Asterisco dentro de card NÃO é interpretado — vira asterisco literal na tela (foi
// exatamente o que chegou no 1º disparo de staging: "*Você tem projeto…*" cru). Se um
// dia a entrega virar mensagem de texto simples, este arquivo TEM de voltar ao
// asterisco: a sintaxe segue a superfície, não o gosto.
// ⚠️ **`<a href>` NÃO funciona** (v3 do doc do Gomoon, 06/08/2026): qualquer tag fora
// da lista acima — ou com atributo — sai ESCAPADA, aparece como texto na tela. É
// proposital do lado deles (markup inesperado quebraria o cartão inteiro do líder).
// A URL vai crua. `\n` está comprovadamente preservado pelo card, por isso não usamos
// `<br>`. `•` e emoji são caracteres literais.
//
// ⚠️ O aviso ao líder REPETE o link de propósito (decisão do Luis, 06/08/2026): o
// cartão do Gomoon monta um botão "Abrir a fila" a partir do campo `url`, então o
// endereço aparece 2× na DM. (O título já NÃO duplica mais: na v3 do doc deles o
// cartão passou a trazer só o nosso texto, e o resumo foi para o `fallbackText`, que
// alimenta a notificação do celular e não renderiza no corpo.)
// ⚠️ NENHUM VALOR EM R$ nos textos (§7.1 do contrato) — DM se lê por cima do ombro.
// Nome, e-mail e CONTAGEM de projetos são tudo o que pode aparecer.

/** Primeiro nome, para a saudação ("Oi, Lucas!" em vez de "Oi, Lucas Queiroz!"). */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

const plural = (n: number, palavra: string) => `${n} ${palavra}${n > 1 ? 's' : ''}`;

/**
 * Aviso recorrente ao líder (bot → líder), já renderizado. Função PURA.
 *
 * ⚠️ **Enxuto por pedido do LUCAS QUEIROZ — o líder que recebe a DM** (06/08/2026).
 * Duas linhas saíram, e as duas por motivo dele, não por gosto meu:
 *  • *"São três perguntas rápidas por projeto, e você pode pré-aprovar ou pedir
 *    ajuste na própria tela."* → **"não precisa falar das 3 perguntas aí"**; o que a
 *    tela pede ele descobre na tela. (O mesmo corte foi pedido no texto de abertura.)
 *  • *"Situação em DD/MM às HHh. Se você já decidiu depois disso, pode ignorar esta
 *    mensagem."* → **"se ele já decidiu, a mensagem não chegaria pra ele"**. A
 *    ressalva vinha do §7.2 do contrato (o número envelhece entre o disparo e a
 *    leitura), mas na prática o snapshot já exclui quem decidiu, e a linha lia como
 *    sistema em dúvida sobre o próprio dado. Se um dia a defasagem incomodar de
 *    verdade, a volta dela é DECISÃO — e some com a função `dataHoraBRT`, que saiu
 *    junto (está no histórico do git).
 * Sobrou o que ele resumiu como *"é você ir lá pré-aprovar e pronto, acabou"*:
 * título, quem está esperando e o link.
 *
 * ⚠️ NÃO há linha de link: quem leva o líder à fila é o botão "Abrir a fila" que o
 * cartão monta do campo `url` — ver o comentário no fim da função.
 *
 * Três formas, porque a frase única ficava errada nos extremos:
 *  • vários liderados → "N projetos da sua equipe" + bullets;
 *  • um liderado → nomeia a pessoa e dispensa a lista de 1 item;
 *  • um projeto → concordância no singular ("está aguardando").
 */
export function renderMensagemLider(lider: {
  nome: string | null;
  url: string;
  liderados: { nome: string; projetos_pendentes: number }[];
}): string {
  const total = lider.liderados.reduce((s, d) => s + d.projetos_pendentes, 0);
  const primeiro = primeiroNome(lider.nome);
  const saudacao = primeiro ? `Oi, ${primeiro}! ` : 'Oi! ';

  const linhas: string[] = ['<b>Você tem projeto para pré-aprovar no GoDocs</b> 📋', ''];

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
      // O travessão do bullet é do modelo do Luis — não é dos que ele mandou tirar
      // (aqueles eram os que eu tinha metido na prosa do anúncio).
      ...lider.liderados.map((d) => `• ${d.nome} — ${plural(d.projetos_pendentes, 'projeto')}`),
    );
  }

  // ⚠️ SEM linha de link (pedido do Luis, 06/08/2026, olhando o print do disparo): o
  // cartão do Gomoon já monta o botão "Abrir a fila" a partir do campo `url`, e a
  // linha `👉 <url>` fazia o mesmo endereço aparecer 2× na DM. **Quem leva o líder até
  // a fila é o BOTÃO** — se um dia a entrega deixar de ser cartão (não haveria botão),
  // esta linha tem de voltar junto, senão a DM fica sem caminho nenhum.
  return linhas.join('\n');
}

/**
 * Aviso ao líder do DONO DO PROJETO PAI quando uma NOVA FEATURE (projeto vinculado) é
 * submetida no projeto dele (estágio 2 da pré-aprovação). Função PURA.
 *
 * Copy PRÓPRIA (pedido do Luis): tem de deixar CLARO que se refere a uma feature nova
 * implementada no projeto DELE, não a um projeto solto de um liderado. Sem valores em R$
 * (mesma régua §7.1) e sem travessão/hífen como separador (só a grafia correta de
 * "pré-aprovação" leva hífen). Markup HTML de cartão (`<b>`), sem `<a href>` (D22) — quem
 * leva à fila é o botão "Abrir a fila" que o cartão monta do campo `url`.
 */
export function renderMensagemLiderFeature(dados: {
  nome: string | null;
  autorNome: string;
  projetoPaiNome: string;
  featureNome: string;
}): string {
  const primeiro = primeiroNome(dados.nome);
  const saudacao = primeiro ? `Oi, ${primeiro}! ` : 'Oi! ';
  const autor = (dados.autorNome ?? '').trim() || 'Alguém da equipe';
  const pai = (dados.projetoPaiNome ?? '').trim() || 'um projeto seu';
  const feature = (dados.featureNome ?? '').trim();

  const linhas: string[] = [
    '<b>Nova feature para pré-aprovar no GoDocs</b> 🧩',
    '',
    `${saudacao}${autor} implementou uma nova feature no projeto <b>${pai}</b> e ela aguarda a sua pré-aprovação.`,
  ];
  if (feature) linhas.push('', `Feature: <b>${feature}</b>`);
  return linhas.join('\n');
}
