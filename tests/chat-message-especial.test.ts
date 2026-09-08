// O CARD do "Alerta de Automações" (`buildSubmitMessage`, `src/lib/google/chat.ts`).
//
// ⚠️ O alerta era uma mensagem de TEXTO de ~20 linhas e virou um **card (cardsV2)** em
// 08/09/2026. Dois defeitos e um pedido moveram isto:
//
//  1. **Campos zerados** — o card lia `savingHoras`/`savingReais`/`tipoSaving` e a receita
//     do blob do chat, que são colunas da **v1**; o formulário determinístico da v2 nunca
//     as escreve (grava `ganho_categorias` + os 4 blocos + os 3 `impacto_*`). Resultado:
//     "R$ 0,00" e "0 horas" em projeto com ganho declarado e aprovado. Hoje o número vem
//     resumido de `notificacao-ganho.ts`, que decide a geração pelo `ganho_categorias`.
//  2. **"Tipos: —"** — a linha lia `tipos_projeto` (vocabulário da v1). Virou o eixo TIPO
//     da categorização (`categoria_projeto`), e AUSENTE agora OMITE a linha em vez de
//     mostrar "—" (o analisador escreve essa coluna DEPOIS da submissão).
//  3. **Compactar com "exibir mais"** (pedido do Luis) — só a seção `collapsible` do
//     cardsV2 dá isso; texto plano não tem como esconder nada.
//
// Estes testes trancam o CONTRATO do payload (nada de comparar strings inteiras: o card é
// estrutura) e a régua de cada um dos 3 pontos acima.
import { describe, it, expect } from 'vitest';
import { buildSubmitMessage, linkDashboardProjeto } from '@/lib/google/chat';
import { resumirGanhoV1, type ResumoGanho } from '@/lib/notificacao-ganho';

const GANHO_V1: ResumoGanho = resumirGanhoV1({
  tiposProjeto: ['saving'],
  savingHoras: 120,
  savingReais: 5000,
  tipoSaving: 'mensal',
});

const base = {
  projeto: 'Automação X',
  area: 'Operações',
  ferramenta: 'n8n',
  escopo: 'interno',
  nomeCompleto: 'Fulano de Tal',
  email: 'fulano@gocase.com',
  participantes: 'Beltrano',
  descricao: 'Descrição do projeto.',
  dataSubmissao: '08/07/2026',
  modo: 'novo' as const,
  ganho: GANHO_V1,
};

// ─── Helpers de leitura do payload ───────────────────────────────────────────

type Card = { cardsV2: unknown[]; fallbackTexto: string };

function card(msg: ReturnType<typeof buildSubmitMessage>): Record<string, any> {
  if (typeof msg === 'string') throw new Error('esperava CARD, veio texto');
  return (msg.cardsV2[0] as any).card;
}

/** Todo o texto do card concatenado (para asserts de "contém"/"não contém"). */
function textoDoCard(msg: ReturnType<typeof buildSubmitMessage>): string {
  return JSON.stringify(card(msg));
}

function secoes(msg: ReturnType<typeof buildSubmitMessage>): Record<string, any>[] {
  return card(msg).sections as Record<string, any>[];
}

function secaoPorHeader(msg: ReturnType<typeof buildSubmitMessage>, header: string) {
  return secoes(msg).find((s) => s.header === header);
}

/** A 1ª seção — a que fica VISÍVEL sem clicar em nada. */
function visivel(msg: ReturnType<typeof buildSubmitMessage>): string {
  return JSON.stringify(secoes(msg)[0]);
}

// ─── Forma do payload ────────────────────────────────────────────────────────

describe('buildSubmitMessage — é um card, com fallback de texto', () => {
  it('devolve cardsV2 com UM card e o texto de degradação', () => {
    const msg = buildSubmitMessage(base) as Card;
    expect(Array.isArray(msg.cardsV2)).toBe(true);
    expect(msg.cardsV2).toHaveLength(1);
    // ⚠️ O fallback não é decoração: o card usa `collapsible`, e se o webhook recusar um
    // campo do schema o alerta NÃO PODE deixar de sair (`sendChatNotification` degrada).
    expect(typeof msg.fallbackTexto).toBe('string');
    expect(msg.fallbackTexto.length).toBeGreaterThan(20);
  });

  it('o nome do projeto é o TÍTULO e o estado é o subtítulo', () => {
    const c = card(buildSubmitMessage(base));
    expect(c.header.title).toBe('Automação X');
    expect(String(c.header.subtitle)).toMatch(/submiss/i);
  });

  it('markup do card é HTML (<b>), NUNCA *asterisco* — são 2 sintaxes que não se conversam', () => {
    // Ver D22: o 1º disparo do Gomoon chegou com asterisco literal na tela porque a
    // superfície era CARD e o texto usava a sintaxe de MENSAGEM.
    const t = textoDoCard(buildSubmitMessage(base));
    expect(t).toContain('<b>');
    expect(t).not.toMatch(/\*[A-ZÁÉÍÓÚÂÊÔÃÕÇa-z]/);
  });

  it('o link vai em BOTÃO, não em <a href> (tag com atributo sai escapada no card)', () => {
    const msg = buildSubmitMessage({ ...base, projetoId: 'proj-42' });
    const t = textoDoCard(msg);
    expect(t).not.toContain('<a href');
    expect(t).toContain('openLink');
    expect(t).toContain('/dashboard?projeto=proj-42');
  });
});

// ─── Compactação: o "exibir mais" ────────────────────────────────────────────

describe('buildSubmitMessage — compacto, com "exibir mais"', () => {
  it('a descrição fica atrás de uma seção COLAPSÁVEL, não na área visível', () => {
    const msg = buildSubmitMessage(base);
    expect(visivel(msg)).not.toContain('Descrição do projeto.');
    const contexto = secaoPorHeader(msg, 'Descrição e contexto');
    expect(contexto?.collapsible).toBe(true);
    expect(JSON.stringify(contexto)).toContain('Descrição do projeto.');
  });

  it('seção colapsável não vaza o 1º widget (uncollapsibleWidgetsCount = 0)', () => {
    // Com 1 aqui, a descrição apareceria aberta e o pedido do Luis estaria desfeito.
    for (const s of secoes(buildSubmitMessage(base))) {
      if (s.collapsible) expect(s.uncollapsibleWidgetsCount).toBe(0);
    }
  });

  it('a área VISÍVEL leva o essencial: ganho, categorias, área e autor', () => {
    const v = visivel(buildSubmitMessage(base));
    expect(v).toContain('R$');
    expect(v).toContain('Saving');
    expect(v).toContain('Operações');
    expect(v).toContain('Fulano de Tal');
  });

  it('texto muito longo é truncado (protege o tamanho do payload do card)', () => {
    const descricao = 'x'.repeat(4000);
    const t = textoDoCard(buildSubmitMessage({ ...base, descricao }));
    expect(t).not.toContain('x'.repeat(2000));
    expect(t).toContain('…');
  });

  it('nome de projeto quilométrico não estoura o título do card', () => {
    const nome = 'Projeto '.repeat(40);
    const c = card(buildSubmitMessage({ ...base, projeto: nome }));
    expect(String(c.header.title).length).toBeLessThanOrEqual(91);
  });
});

// ─── O bug #1: números da v2 ──────────────────────────────────────────────────

describe('buildSubmitMessage — o ganho vem do resumo, não das colunas da v1', () => {
  const GANHO_V2: ResumoGanho = {
    geracao: 'v2',
    categorias: 'Saving efetivado · Custo evitado',
    destaque: { rotulo: 'Impacto líquido mensal', valor: 'R$ 5.900,00', nota: 'bruto R$ 7.000,00' },
    detalhe: [{ rotulo: 'Saving efetivado (Mensal)', valor: 'R$ 4.000,00' }],
    textos: [{ rotulo: 'Evidência do saving', texto: 'Contrato encerrado em 07/2026.' }],
    semNumero: false,
  };

  it('projeto da v2 mostra o impacto declarado, não R$ 0,00', () => {
    const msg = buildSubmitMessage({ ...base, ganho: GANHO_V2 });
    expect(visivel(msg)).toContain('R$ 5.900,00');
    expect(visivel(msg)).toContain('Saving efetivado · Custo evitado');
    expect(textoDoCard(msg)).not.toContain('R$ 0,00');
  });

  it('o detalhe por bloco fica na colapsável "Números do ganho"', () => {
    const msg = buildSubmitMessage({ ...base, ganho: GANHO_V2 });
    const numeros = secaoPorHeader(msg, 'Números do ganho');
    expect(numeros?.collapsible).toBe(true);
    expect(JSON.stringify(numeros)).toContain('Saving efetivado (Mensal)');
  });

  it('os textos do ganho (evidência/racional) vão para a colapsável de contexto', () => {
    const msg = buildSubmitMessage({ ...base, ganho: GANHO_V2 });
    expect(JSON.stringify(secaoPorHeader(msg, 'Descrição e contexto'))).toContain(
      'Contrato encerrado em 07/2026.',
    );
  });

  it('ganho SEM número declara isso em palavras, nunca como R$ 0,00', () => {
    // É o caso legítimo do ganho imensurável — "R$ 0,00" ali se lê como bug do sistema.
    const semNumero: ResumoGanho = {
      geracao: 'v2',
      categorias: 'Ganho imensurável',
      destaque: null,
      detalhe: [],
      textos: [],
      semNumero: true,
    };
    const msg = buildSubmitMessage({ ...base, ganho: semNumero });
    expect(visivel(msg)).toMatch(/[Ss]em número/);
    expect(textoDoCard(msg)).not.toContain('R$ 0,00');
    // Sem número não há o que colapsar na seção de números.
    expect(secaoPorHeader(msg, 'Números do ganho')).toBeUndefined();
  });
});

// ─── O bug #2: a linha "Tipos" ────────────────────────────────────────────────

describe('buildSubmitMessage — o TIPO do projeto (era "Tipos: —")', () => {
  it('slug conhecido vira rótulo legível', () => {
    const t = textoDoCard(buildSubmitMessage({ ...base, tipoProjeto: 'automacao' }));
    expect(t).toContain('Automação');
    expect(t).not.toContain('automacao');
  });

  it('ausente OMITE a linha — não vira "—" (o analisador escreve isso depois)', () => {
    const semTipo = textoDoCard(buildSubmitMessage(base));
    expect(semTipo).not.toContain('Tipo:');
  });

  it('valor fora da escala aparece como veio (mostra o que existe)', () => {
    const t = textoDoCard(buildSubmitMessage({ ...base, tipoProjeto: 'coisa-nova' }));
    expect(t).toContain('coisa-nova');
  });
});

// ─── Projeto especial ─────────────────────────────────────────────────────────

describe('buildSubmitMessage — projeto especial', () => {
  const especial = { ...base, especial: true, contextoEspecial: 'Pesquisa sem número, valor estratégico.' };

  it('OMITE a seção de números e destaca o porquê é especial', () => {
    const msg = buildSubmitMessage(especial);
    expect(secaoPorHeader(msg, 'Números do ganho')).toBeUndefined();
    expect(visivel(msg)).not.toContain('R$');
    expect(textoDoCard(msg)).toContain('Por que é um projeto especial');
    expect(textoDoCard(msg)).toContain('Pesquisa sem número, valor estratégico.');
  });

  it('o subtítulo diz que é especial e que a avaliação é humana', () => {
    const c = card(buildSubmitMessage(especial));
    expect(String(c.header.subtitle)).toMatch(/especial/i);
    expect(String(c.header.subtitle)).toMatch(/humana/i);
  });

  it('especial sem contexto cai no traço (nunca campo em branco)', () => {
    const msg = buildSubmitMessage({ ...especial, contextoEspecial: '' });
    expect(textoDoCard(msg)).toContain('Por que é um projeto especial');
    expect(textoDoCard(msg)).toContain('—');
  });

  it('metadados que ainda fazem sentido continuam no card', () => {
    const t = textoDoCard(buildSubmitMessage(especial));
    expect(t).toContain('Automação X');
    expect(t).toContain('Fulano de Tal');
    expect(t).toContain('Descrição do projeto.');
  });
});

// ─── Nota de "não há parecer de líder" ────────────────────────────────────────
//
// Quando ninguém vai pré-aprovar (autor é liderança / não tem líder / TeamGuide fora), o
// aviso sai na submissão MESMO ASSIM — com uma linha CURTA dizendo por quê (o texto vem
// de `notificacao-chat.ts`, encurtado a pedido do Luis em 08/09/2026).
describe('buildSubmitMessage — nota da pré-aprovação', () => {
  const NOTA = 'O autor é líder: pré-aprovado direto.';

  it('a nota aparece no card do fluxo normal, na área VISÍVEL', () => {
    expect(visivel(buildSubmitMessage({ ...base, notaPreAprovacao: NOTA }))).toContain(NOTA);
  });

  it('a nota aparece também no card do especial', () => {
    const msg = buildSubmitMessage({
      ...base,
      especial: true,
      contextoEspecial: 'Pesquisa.',
      notaPreAprovacao: NOTA,
    });
    expect(visivel(msg)).toContain(NOTA);
  });

  it('nota vazia/ausente não inventa linha nenhuma', () => {
    const semNota = JSON.stringify(buildSubmitMessage(base));
    expect(JSON.stringify(buildSubmitMessage({ ...base, notaPreAprovacao: '' }))).toBe(semNota);
    expect(JSON.stringify(buildSubmitMessage({ ...base, notaPreAprovacao: null }))).toBe(semNota);
    expect(semNota).not.toContain('Pré-aprovação do líder');
  });
});

// ─── Link do dashboard (substitui o link da planilha) ────────────────────────
describe('link do dashboard nas mensagens do Chat', () => {
  it('linkDashboardProjeto monta /dashboard?projeto=<id> (encodado) e cai na raiz sem id', () => {
    expect(linkDashboardProjeto('abc123')).toMatch(/\/dashboard\?projeto=abc123$/);
    expect(linkDashboardProjeto('a b/c')).toContain('/dashboard?projeto=a%20b%2Fc');
    expect(linkDashboardProjeto()).toMatch(/\/dashboard$/);
    expect(linkDashboardProjeto(null)).toMatch(/\/dashboard$/);
  });

  it('o card não cita mais a planilha', () => {
    const t = textoDoCard(buildSubmitMessage({ ...base, projetoId: 'proj-42' }));
    expect(t).not.toContain('docs.google.com/spreadsheets');
    expect(t).not.toContain('Link da planilha');
  });

  it('o especial e a pré-aprovação também levam o link com o id', () => {
    expect(textoDoCard(buildSubmitMessage({ ...base, projetoId: 'esp-7', especial: true }))).toContain(
      '/dashboard?projeto=esp-7',
    );
    expect(
      textoDoCard(
        buildSubmitMessage({
          ...base,
          projetoId: 'pa-9',
          preAprovacao: { por: 'Alguém', em: '20/08/2026 10:00' },
        }),
      ),
    ).toContain('/dashboard?projeto=pa-9');
  });
});

// ─── Card disparado PELA pré-aprovação do líder ──────────────────────────────
describe('buildSubmitMessage — projeto pré-aprovado pelo líder', () => {
  const parecer = { por: 'Lucas Gonçalves Queiroz', em: '11/08/2026 14:32' };

  it('o subtítulo anuncia a PRÉ-APROVAÇÃO, não o "aguardando análise" de sempre', () => {
    const c = card(buildSubmitMessage({ ...base, preAprovacao: parecer }));
    expect(String(c.header.subtitle)).toMatch(/pré-aprovad/i);
  });

  it('cita quem pré-aprovou e quando, na área visível', () => {
    const v = visivel(buildSubmitMessage({ ...base, preAprovacao: parecer }));
    expect(v).toContain('Lucas Gonçalves Queiroz');
    expect(v).toContain('11/08/2026 14:32');
  });

  it('os dados do projeto e o ganho continuam no card (é ele que a triagem lê)', () => {
    const msg = buildSubmitMessage({ ...base, preAprovacao: parecer });
    expect(textoDoCard(msg)).toContain('Automação X');
    expect(textoDoCard(msg)).toContain('Fulano de Tal');
    expect(visivel(msg)).toContain('R$');
  });

  it('o fallback de texto também carrega o parecer (é o que sai se o card for recusado)', () => {
    const msg = buildSubmitMessage({ ...base, preAprovacao: parecer }) as Card;
    expect(msg.fallbackTexto).toContain('Lucas Gonçalves Queiroz');
    expect(msg.fallbackTexto).toContain('/dashboard');
  });
});
