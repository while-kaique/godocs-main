// O TEXTO da DM ao líder (D21) — `src/lib/gomoon-mensagens.ts`.
//
// O que estes testes seguram:
//  • quem redige é o GODOCS: o texto vai PRONTO no payload, então o plural e o total
//    são responsabilidade nossa e têm de estar certos (do outro lado não há engine de
//    template para consertar);
//  • o CORTE pedido pelo Lucas (06/08/2026) — sem a frase das 3 perguntas e sem a
//    ressalva "Situação em …, pode ignorar" — não pode voltar por acidente;
//  • NENHUM valor em R$ (§7.1 do contrato);
//  • o markup é o de CARD (`<b>`/`<i>`), NÃO o `*asterisco*` de mensagem de texto — o
//    Gomoon entrega dentro de um `cardsV2`/`TextParagraph`, onde asterisco não é
//    interpretado e chega literal na tela (foi o bug do 1º disparo, 06/08/2026).
//
// ⚠️ O ANÚNCIO global NÃO mora mais aqui (D24, 06/08/2026): quem guarda o texto e
// dispara é o Gomoon. Se alguém reintroduzir `TEXTO_ANUNCIO_PRE_APROVACAO` neste
// módulo, é regressão — o combinado está em `docs/integracao-gomoon-chat.md`.
import { describe, it, expect } from 'vitest';

import { renderMensagemLider, primeiroNome } from '@/lib/gomoon-mensagens';

const URL = 'https://godocs.devgogroup.com/aprovacoes';
const lider = (
  liderados: { nome: string; projetos_pendentes: number }[],
  nome: string | null = 'Lucas Queiroz',
) => ({ nome, url: URL, liderados });

describe('renderMensagemLider — as três formas', () => {
  it('vários liderados: total somado + bullets na ordem recebida', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 3 },
        { nome: 'Ana Souza', projetos_pendentes: 2 },
      ]),
    );
    expect(t).toContain(
      'Oi, Lucas! <b>5 projetos</b> da sua equipe estão aguardando a sua pré-aprovação:',
    );
    expect(t).toContain('• Bruno Lima — 3 projetos');
    expect(t).toContain('• Ana Souza — 2 projetos');
  });

  it('um liderado: nomeia a pessoa e NÃO abre lista de 1 item', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 3 }]));
    expect(t).toContain(
      'Oi, Lucas! <b>3 projetos</b> de <b>Ana Souza</b> estão aguardando a sua pré-aprovação.',
    );
    expect(t).not.toContain('•');
  });

  it('um projeto só: concordância no singular', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 1 }]));
    expect(t).toContain('<b>1 projeto</b> de <b>Ana Souza</b> está aguardando');
    expect(t).not.toContain('1 projetos');
    expect(t).not.toContain('estão aguardando');
  });

  it('bullet no singular quando o liderado tem 1 projeto', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 2 },
        { nome: 'Ana Souza', projetos_pendentes: 1 },
      ]),
    );
    // `endsWith` (e não `toContain`) para distinguir "1 projeto" de "1 projetos":
    // sem a linha do link, o último bullet é a última linha da mensagem.
    expect(t.endsWith('• Ana Souza — 1 projeto')).toBe(true);
    expect(t).toContain('• Bruno Lima — 2 projetos');
  });

  it('líder sem nome no banco: saudação sem nome, nunca "Oi, null!"', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 1 }], null));
    expect(t).toContain('Oi! <b>1 projeto</b>');
    expect(t).not.toMatch(/null|undefined/);
  });

  it('⚠️ NÃO fala das 3 perguntas — corte pedido pelo Lucas (06/08/2026)', () => {
    // "Não precisa falar das 3 perguntas aí": o que a tela pede, ele descobre na tela.
    // A mesma frase saiu do texto de abertura, a pedido do chefe do Luis.
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 2 }]));
    expect(t.toLowerCase()).not.toContain('perguntas');
    expect(t).not.toContain('pedir ajuste');
  });

  it('⚠️ NÃO traz a ressalva "Situação em …, pode ignorar" — corte do Lucas', () => {
    // "Se ele já decidiu, a mensagem não chegaria pra ele." A linha vinha do §7.2 do
    // contrato (o número envelhece entre disparo e leitura), mas o snapshot já exclui
    // quem decidiu. Voltar com ela tem de ser DECISÃO, não regressão.
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 2 }]));
    expect(t).not.toContain('Situação em');
    expect(t).not.toContain('pode ignorar');
    expect(t).not.toContain('<i>');
  });

  it('a mensagem é curta: título e quem está esperando — nada mais', () => {
    // "É você ir lá pré-aprovar e pronto, acabou" (Lucas). Se alguém acrescentar
    // parágrafo, este teste cai — de propósito.
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 2 }]));
    expect(t.split('\n').filter((l) => l.trim()).length).toBe(2);
  });

  it('⚠️ NÃO repete o link no corpo — quem leva à fila é o BOTÃO do cartão', () => {
    // O cartão do Gomoon monta "Abrir a fila" a partir do campo `url`; a linha
    // `👉 <url>` fazia o mesmo endereço aparecer 2× na DM (o Luis viu no print e
    // mandou tirar, 06/08/2026). ⚠️ Se a entrega deixar de ser cartão — sem botão —,
    // a linha tem de VOLTAR, senão a DM fica sem caminho nenhum.
    const t = renderMensagemLider(lider([{ nome: 'Ana', projetos_pendentes: 1 }], 'Lucas'));
    expect(t.startsWith('<b>Você tem projeto para pré-aprovar no GoDocs</b> 📋')).toBe(true);
    expect(t).not.toContain(URL);
    expect(t).not.toContain('👉');
  });

  it('⚠️ markup de CARD (<b>), nunca o *asterisco* de mensagem de texto', () => {
    // Dentro de um `TextParagraph` o asterisco NÃO é interpretado: chega literal na
    // tela. Se algum dia a entrega virar mensagem de texto simples, este teste é o
    // lugar de inverter a regra — de propósito, não por acidente.
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 3 },
        { nome: 'Ana Souza', projetos_pendentes: 2 },
      ]),
    );
    expect(t).not.toContain('*');
    expect(t).not.toMatch(/_[^_]+_/);
    expect(t).toMatch(/<b>.+<\/b>/);
    // `<br>` não: o card do Gomoon preserva o `\n` (conferido no disparo de 06/08).
    expect(t).not.toContain('<br');
    // `<a href>` sai ESCAPADO no cartão deles (v3 do doc) — a URL vai crua.
    expect(t).not.toContain('<a ');
    expect(t).toContain('\n');
  });

  it('⚠️ NENHUM valor em R$ atravessa a mensagem (§7.1)', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 3 },
        { nome: 'Ana Souza', projetos_pendentes: 2 },
      ]),
    );
    for (const proibido of ['R$', 'saving', 'reais', 'ganho', 'receita', 'custo', 'memorial']) {
      expect(t.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
});

describe('primeiroNome', () => {
  it('pega só o primeiro nome e tolera vazio', () => {
    expect(primeiroNome('Lucas Queiroz')).toBe('Lucas');
    expect(primeiroNome('  Ana  Paula ')).toBe('Ana');
    expect(primeiroNome(null)).toBe('');
    expect(primeiroNome('   ')).toBe('');
  });
});
