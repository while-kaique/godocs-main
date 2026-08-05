// Os TEXTOS das DMs da pré-aprovação (D21) — `src/lib/gomoon-mensagens.ts`.
//
// O que estes testes seguram:
//  • quem redige é o GODOCS: o texto vai PRONTO no payload, então o plural, o total e
//    a data são responsabilidade nossa e têm de estar certos (do outro lado não há
//    engine de template para consertar);
//  • a data/hora sai em fuso de BRASÍLIA e do `gerado_em` — não é fixa em "09h";
//  • NENHUM valor em R$ (§7.1 do contrato).
import { describe, it, expect } from 'vitest';

import {
  renderMensagemLider,
  dataHoraBRT,
  primeiroNome,
  TEXTO_ANUNCIO_PRE_APROVACAO,
  ANUNCIO_CHAVE,
} from '@/lib/gomoon-mensagens';

const URL = 'https://godocs.devgogroup.com/aprovacoes';
const GERADO = '2026-08-06T12:00:00.000Z'; // 09h de Brasília
const lider = (liderados: { nome: string; projetos_pendentes: number }[], nome: string | null = 'Lucas Queiroz') => ({
  nome,
  url: URL,
  liderados,
});

describe('renderMensagemLider — as três formas', () => {
  it('vários liderados: total somado + bullets na ordem recebida', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 3 },
        { nome: 'Ana Souza', projetos_pendentes: 2 },
      ]),
      GERADO,
    );
    expect(t).toContain('*Você tem projeto para pré-aprovar no GoDocs* 📋');
    expect(t).toContain('Oi, Lucas! *5 projetos* da sua equipe estão aguardando a sua pré-aprovação:');
    expect(t).toContain('• Bruno Lima — 3 projetos');
    expect(t).toContain('• Ana Souza — 2 projetos');
    expect(t).toContain(`👉 ${URL}`);
  });

  it('um liderado: nomeia a pessoa e NÃO abre lista de 1 item', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 3 }]), GERADO);
    expect(t).toContain('Oi, Lucas! *3 projetos* de *Ana Souza* estão aguardando a sua pré-aprovação.');
    expect(t).not.toContain('•');
  });

  it('um projeto só: concordância no singular', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 1 }]), GERADO);
    expect(t).toContain('*1 projeto* de *Ana Souza* está aguardando');
    expect(t).not.toContain('1 projetos');
    expect(t).not.toContain('estão aguardando');
  });

  it('bullet no singular quando o liderado tem 1 projeto', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 2 },
        { nome: 'Ana Souza', projetos_pendentes: 1 },
      ]),
      GERADO,
    );
    expect(t).toContain('• Ana Souza — 1 projeto\n');
    expect(t).toContain('• Bruno Lima — 2 projetos');
  });

  it('líder sem nome no banco: saudação sem nome, nunca "Oi, null!"', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 1 }], null), GERADO);
    expect(t).toContain('Oi! *1 projeto*');
    expect(t).not.toMatch(/null|undefined/);
  });

  it('carrega a data do snapshot em Brasília (§7.2) e a ressalva de que o número envelhece', () => {
    const t = renderMensagemLider(lider([{ nome: 'Ana Souza', projetos_pendentes: 1 }]), GERADO);
    expect(t).toContain('_Situação em 06/08 às 09h.');
    expect(t).toContain('pode ignorar esta mensagem._');
  });

  it('usa a URL do item — o link da staging não pode virar o de produção', () => {
    const t = renderMensagemLider(
      { nome: 'Lucas', url: 'https://godocs-staging.devgogroup.com/aprovacoes', liderados: [{ nome: 'Ana', projetos_pendentes: 1 }] },
      GERADO,
    );
    expect(t).toContain('👉 https://godocs-staging.devgogroup.com/aprovacoes');
    expect(t).not.toContain('godocs.devgogroup.com/aprovacoes');
  });

  it('⚠️ NENHUM valor em R$ atravessa a mensagem (§7.1)', () => {
    const t = renderMensagemLider(
      lider([
        { nome: 'Bruno Lima', projetos_pendentes: 3 },
        { nome: 'Ana Souza', projetos_pendentes: 2 },
      ]),
      GERADO,
    );
    for (const proibido of ['R$', 'saving', 'reais', 'ganho', 'receita', 'custo', 'memorial']) {
      expect(t.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
});

describe('dataHoraBRT — fuso de Brasília, hora do disparo', () => {
  it('o cron das 09h BRT (12h UTC)', () => {
    expect(dataHoraBRT('2026-08-06T12:00:00.000Z')).toBe('06/08 às 09h');
  });

  it('22h de Brasília ainda é o MESMO dia (em UTC já seria o seguinte)', () => {
    expect(dataHoraBRT('2026-08-07T01:00:00.000Z')).toBe('06/08 às 22h');
  });

  it('meia-noite é 00h, nunca 24h', () => {
    expect(dataHoraBRT('2026-08-06T03:00:00.000Z')).toBe('06/08 às 00h');
  });

  it('data inválida não estoura nem imprime "Invalid Date"', () => {
    expect(dataHoraBRT('nao-e-data')).toMatch(/^\d{2}\/\d{2} às \d{2}h$/);
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

describe('TEXTO_ANUNCIO_PRE_APROVACAO — o que ele PROMETE tem de existir no app', () => {
  it('não promete aviso ao autor: diz que o ajuste FICA VISÍVEL em Meus Projetos', () => {
    // O app mostra o parecer no card de "Meus Projetos", mas NÃO avisa o autor (não há
    // DM nem e-mail para ele). "você recebe o que precisa corrigir" seria promessa falsa.
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).toContain('fica visível no seu projeto em *Meus Projetos*');
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).not.toMatch(/você recebe/i);
  });

  it('a isenção descrita é a D20 (coordenação para cima), sem citar supervisor', () => {
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).toContain('cargo de coordenação para cima');
    expect(TEXTO_ANUNCIO_PRE_APROVACAO.toLowerCase()).not.toContain('supervisor');
  });

  it('não manda o líder a um menu que não existe — a entrada é a faixa da home', () => {
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).toContain('*Pré-aprovações do meu time*');
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).not.toContain('GoDocs → Pré-aprovações');
  });

  it('não deixou placeholder de redação para trás', () => {
    expect(TEXTO_ANUNCIO_PRE_APROVACAO).not.toMatch(/<[A-ZÀ-Ú ]+>|\{\{|TODO/);
  });

  it('a versão da chave acompanha o texto — mexer na redação não reenvia nada', () => {
    expect(ANUNCIO_CHAVE.endsWith(':v1')).toBe(true);
  });
});
