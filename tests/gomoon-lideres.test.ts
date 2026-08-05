// Integração GoDocs → Gomoon (D17): o snapshot diário das pendências de pré-aprovação.
//
// O que estes testes seguram (invariantes do contrato — docs/integracao-gomoon-chat.md):
//  • NENHUM valor em R$ no payload (§7.1) — é o que impede vazar saving numa DM.
//  • Dia sem pendência dispara IGUAL, com `lideres: []` (§2) — silêncio seria
//    indistinguível de cron morto.
//  • Chave de idempotência `godocs:<email>:<YYYY-MM-DD>` no dia de BRASÍLIA (§4).
//  • `ambiente` deriva do GODOCS_ENV — é a ÚNICA proteção contra a staging cutucar
//    líder de verdade (§6).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/integrations/db/client.server', () => ({
  getPendenciasPorLider: vi.fn(),
  // `derivarNomeDeEmail` (auth.functions) importa daqui — só precisa existir.
  getAdminByEmail: vi.fn(),
}));

import { getPendenciasPorLider } from '@/integrations/db/client.server';
import {
  montarPayloadLideresPendentes,
  montarPayloadAnuncio,
  dataChaveBRT,
  notificarLideresPendentes,
  anunciarPreAprovacao,
  type LinhaPendencia,
} from '@/lib/gomoon-lideres.functions';
import { ANUNCIO_CHAVE } from '@/lib/gomoon-mensagens';

const mPendencias = getPendenciasPorLider as unknown as ReturnType<typeof vi.fn>;

const OPTS = {
  ambiente: 'producao' as const,
  geradoEm: '2026-08-05T12:00:00.000Z',
  appUrl: 'https://godocs.devgogroup.com',
};

const linha = (over: Partial<LinhaPendencia>): LinhaPendencia => ({
  lider_email: 'lucas.queiroz@gocase.com',
  lider_nome: 'Lucas Queiroz',
  liderado_email: 'ana@gocase.com',
  liderado_nome: 'Ana Souza',
  projetos_pendentes: 1,
  ...over,
});

describe('montarPayloadLideresPendentes — formato do contrato (§3)', () => {
  it('agrupa por líder e devolve o esqueleto do contrato', () => {
    const p = montarPayloadLideresPendentes(
      [
        linha({ liderado_email: 'ana@gocase.com', liderado_nome: 'Ana Souza', projetos_pendentes: 2 }),
        linha({ liderado_email: 'bruno@gocase.com', liderado_nome: 'Bruno Lima', projetos_pendentes: 3 }),
        linha({
          lider_email: 'kelly@gocase.com',
          lider_nome: 'Kelly Santos',
          liderado_email: 'fablicia@gocase.com',
          liderado_nome: 'Fablícia Lima',
        }),
      ],
      OPTS,
    );

    expect(p.origem).toBe('godocs');
    expect(p.ambiente).toBe('producao');
    expect(p.gerado_em).toBe(OPTS.geradoEm);
    expect(p.lideres).toHaveLength(2);

    const lucas = p.lideres.find((l) => l.email === 'lucas.queiroz@gocase.com')!;
    expect(lucas.nome).toBe('Lucas Queiroz');
    expect(lucas.url).toBe('https://godocs.devgogroup.com/aprovacoes');
    expect(lucas.liderados).toHaveLength(2);
    // Ordem: mais projetos primeiro (é a ordem que a mensagem do Gomoon lista).
    expect(lucas.liderados.map((d) => d.email)).toEqual(['bruno@gocase.com', 'ana@gocase.com']);
    expect(lucas.liderados[0]).toEqual({
      nome: 'Bruno Lima',
      email: 'bruno@gocase.com',
      projetos_pendentes: 3,
    });
  });

  it('a chave de idempotência é godocs:<email>:<YYYY-MM-DD> (§4)', () => {
    const p = montarPayloadLideresPendentes([linha({})], OPTS);
    expect(p.lideres[0].idempotency_key).toBe('godocs:lucas.queiroz@gocase.com:2026-08-05');
  });

  it('NÃO manda o total pré-calculado — o Gomoon soma (§2)', () => {
    const p = montarPayloadLideresPendentes([linha({}), linha({ liderado_email: 'b@gocase.com' })], OPTS);
    expect(p.lideres[0]).not.toHaveProperty('total');
    expect(p.lideres[0]).not.toHaveProperty('projetos_pendentes');
  });

  it('⚠️ NENHUM valor em R$ atravessa o payload (§7.1)', () => {
    const p = montarPayloadLideresPendentes([linha({}), linha({ lider_email: 'x@gocase.com' })], OPTS);
    const bruto = JSON.stringify(p);
    for (const proibido of ['saving', 'reais', 'R$', 'ganho', 'receita', 'custo', 'memorial']) {
      expect(bruto.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
    // Só as 6 chaves do líder + as 3 do liderado existem. `mensagem` (o texto pronto)
    // entra no mesmo JSON, então a varredura acima cobre a DM também.
    expect(Object.keys(p.lideres[0]).sort()).toEqual([
      'email',
      'idempotency_key',
      'liderados',
      'mensagem',
      'nome',
      'url',
    ]);
    expect(Object.keys(p.lideres[0].liderados[0]).sort()).toEqual(['email', 'nome', 'projetos_pendentes']);
    expect(Object.keys(p.lideres[0].mensagem)).toEqual(['texto']);
  });

  it('⚠️ a mensagem do líder vai PRONTA no payload e casa com a lista de liderados (§13)', () => {
    const p = montarPayloadLideresPendentes(
      [
        linha({ liderado_email: 'ana@gocase.com', liderado_nome: 'Ana Souza', projetos_pendentes: 2 }),
        linha({ liderado_email: 'bruno@gocase.com', liderado_nome: 'Bruno Lima', projetos_pendentes: 3 }),
      ],
      OPTS,
    );
    const texto = p.lideres[0].mensagem.texto;

    // Saudação pelo PRIMEIRO nome, total somado por nós e a MESMA ordem dos bullets.
    expect(texto).toContain('Oi, Lucas!');
    expect(texto).toContain('*5 projetos* da sua equipe');
    expect(texto.indexOf('• Bruno Lima — 3 projetos')).toBeLessThan(
      texto.indexOf('• Ana Souza — 2 projetos'),
    );
    // O link é o do próprio item — nunca um hardcode que ignore a staging.
    expect(texto).toContain(p.lideres[0].url);
  });

  it('normaliza e-mail (caixa) e deriva o nome do liderado quando o banco não tem', () => {
    const p = montarPayloadLideresPendentes(
      [linha({ lider_email: 'Lucas.Queiroz@Gocase.com', liderado_email: 'ana.paula@gocase.com', liderado_nome: '  ' })],
      OPTS,
    );
    expect(p.lideres[0].email).toBe('lucas.queiroz@gocase.com');
    expect(p.lideres[0].liderados[0]).toEqual({
      nome: 'Ana Paula',
      email: 'ana.paula@gocase.com',
      projetos_pendentes: 1,
    });
  });

  it('descarta linha sem e-mail ou sem projeto — `liderados` nunca vazio (§3)', () => {
    const p = montarPayloadLideresPendentes(
      [
        linha({ lider_email: '   ' }),
        linha({ liderado_email: null }),
        linha({ projetos_pendentes: 0 }),
        linha({ lider_email: 'valido@gocase.com' }),
      ],
      OPTS,
    );
    expect(p.lideres).toHaveLength(1);
    expect(p.lideres[0].email).toBe('valido@gocase.com');
    expect(p.lideres[0].liderados.length).toBeGreaterThan(0);
  });

  it('lista vazia devolve `lideres: []` (o POST acontece assim mesmo — §2)', () => {
    const p = montarPayloadLideresPendentes([], OPTS);
    expect(p.lideres).toEqual([]);
    expect(p.origem).toBe('godocs');
  });

  it('⚠️ APP_BASE_URL com CAMINHO não vaza para o link do líder', () => {
    // A staging tem `APP_BASE_URL=https://godocs-staging.devgogroup.com/meus-projetos`
    // (o disparo de e-mails usa o link inteiro). Concatenar dava `/meus-projetos/
    // aprovacoes` — rota inexistente: o líder cairia num 404 vindo da DM.
    const p = montarPayloadLideresPendentes([linha({})], {
      ...OPTS,
      appUrl: 'https://godocs-staging.devgogroup.com/meus-projetos',
    });
    expect(p.lideres[0].url).toBe('https://godocs-staging.devgogroup.com/aprovacoes');
  });

  it('appUrl inválida cai no default de produção, nunca num link quebrado', () => {
    const p = montarPayloadLideresPendentes([linha({})], { ...OPTS, appUrl: 'nao-e-url' });
    expect(p.lideres[0].url).toBe('https://godocs.devgogroup.com/aprovacoes');
  });

  it('a url é a mesma para todos e não carrega token (§5)', () => {
    const p = montarPayloadLideresPendentes([linha({}), linha({ lider_email: 'b@gocase.com' })], OPTS);
    expect(new Set(p.lideres.map((l) => l.url)).size).toBe(1);
    expect(p.lideres[0].url).not.toMatch(/[?&](token|t|key)=/);
  });
});

describe('dataChaveBRT — o dia é o de Brasília, não o UTC', () => {
  it('22h de Brasília ainda é o MESMO dia (em UTC já seria o seguinte)', () => {
    // 2026-08-06T01:00:00Z = 05/08 às 22h em Brasília.
    expect(dataChaveBRT('2026-08-06T01:00:00.000Z')).toBe('2026-08-05');
  });

  it('o horário do cron (09h BRT = 12h UTC) cai no dia esperado', () => {
    expect(dataChaveBRT('2026-08-05T12:00:00.000Z')).toBe('2026-08-05');
  });
});

describe('notificarLideresPendentes — envio', () => {
  const fetchMock = vi.fn();
  const envAntigo = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.GOMOON_TOKEN = 'tok-secreto';
    process.env.GOMOON_LIDERES_URL = 'https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes';
    delete process.env.GODOCS_ENV;
    mPendencias.mockResolvedValue([linha({})]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envAntigo };
  });

  const resposta202 = (resultados: unknown[]) => ({
    ok: true,
    status: 202,
    text: async () => JSON.stringify({ ok: true, resultados }),
  });

  it('faz o POST com bearer token e o payload do contrato', async () => {
    fetchMock.mockResolvedValue(resposta202([{ email: 'lucas.queiroz@gocase.com', ok: true }]));
    const r = await notificarLideresPendentes();

    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
    expect(r.lideres).toBe(1);
    expect(r.projetos).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gomoon.gogroupbr.com/api/godocs/lideres-pendentes');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-secreto');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body).origem).toBe('godocs');
  });

  it('dia sem pendência DISPARA assim mesmo, com lideres: [] (§2)', async () => {
    mPendencias.mockResolvedValue([]);
    fetchMock.mockResolvedValue(resposta202([]));
    const r = await notificarLideresPendentes();

    expect(r.ok).toBe(true);
    expect(r.lideres).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).lideres).toEqual([]);
  });

  it('⚠️ na STAGING o campo `ambiente` sai "staging" (única proteção do §6)', async () => {
    process.env.GODOCS_ENV = 'staging';
    fetchMock.mockResolvedValue(resposta202([{ ok: true }]));
    const r = await notificarLideresPendentes();

    expect(r.ambiente).toBe('staging');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).ambiente).toBe('staging');
  });

  it('sem GODOCS_ENV o ambiente é "producao"', async () => {
    fetchMock.mockResolvedValue(resposta202([{ ok: true }]));
    const r = await notificarLideresPendentes();
    expect(r.ambiente).toBe('producao');
  });

  it('dry-run NÃO envia nada e devolve o payload para conferência', async () => {
    const r = await notificarLideresPendentes({ dry: true });
    expect(r.ok).toBe(true);
    expect(r.dry).toBe(true);
    expect(r.payload?.lideres).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem GOMOON_TOKEN não envia e diz por quê (não lança)', async () => {
    delete process.env.GOMOON_TOKEN;
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/GOMOON_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('`ja_entregue` (cron repetido) NÃO é falha — é o comportamento correto (§4)', async () => {
    fetchMock.mockResolvedValue(
      resposta202([{ email: 'lucas.queiroz@gocase.com', ok: true, codigo: 'ja_entregue' }]),
    );
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(true);
    expect(r.falhas).toEqual([]);
    expect(r.ja_entregues).toBe(1);
  });

  it('registra quem NÃO entrou na fila, com o código do Gomoon (§3)', async () => {
    fetchMock.mockResolvedValue(
      resposta202([
        { email: 'lucas.queiroz@gocase.com', ok: true },
        { email: 'sumido@gocase.com', ok: false, codigo: 'usuario_desconhecido' },
      ]),
    );
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(true);
    expect(r.falhas).toEqual([{ email: 'sumido@gocase.com', codigo: 'usuario_desconhecido' }]);
  });

  it('HTTP 401/400 volta como ok:false com o status (não lança)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'token invalido' });
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.erro).toContain('token invalido');
  });

  it('falha de rede volta como ok:false (o cron nunca estoura)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('ECONNREFUSED');
  });

  it('falha do banco volta como ok:false, sem enviar nada', async () => {
    mPendencias.mockRejectedValue(new Error('db fora'));
    const r = await notificarLideresPendentes();
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('db fora');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Anúncio de abertura (uma vez, para a empresa) ────────────────────────────
// O que estes testes seguram: o anúncio é um EVENTO ÚNICO com chave SEM data (§13),
// dry por DEFAULT (um POST distraído falaria com a empresa toda) e sem R$ no texto.

describe('anunciarPreAprovacao — o disparo único', () => {
  const fetchMock = vi.fn();
  const envAntigo = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.GOMOON_TOKEN = 'tok-secreto';
    delete process.env.GOMOON_ANUNCIO_URL;
    delete process.env.GODOCS_ENV;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envAntigo };
  });

  const resposta202 = (resultados: unknown[]) => ({
    ok: true,
    status: 202,
    text: async () => JSON.stringify({ ok: true, resultados }),
  });

  it('⚠️ SEM opts é DRY — enviar exige { dry: false } explícito', async () => {
    const r = await anunciarPreAprovacao();
    expect(r.dry).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.payload?.anuncio.mensagem.texto).toContain('Novidade no GoDocs');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a chave de idempotência é SEM DATA (entrega 1× por pessoa, para sempre — §13)', () => {
    const p = montarPayloadAnuncio({ ambiente: 'producao', geradoEm: '2026-08-06T12:00:00.000Z' });
    expect(p.anuncio.idempotency_key).toBe(ANUNCIO_CHAVE);
    expect(p.anuncio.idempotency_key).toBe('godocs:anuncio:pre-aprovacao-lider:v1');
    // Se um YYYY-MM-DD vazar para cá, o anúncio vira aviso diário e a empresa recebe
    // o mesmo texto todo dia.
    expect(p.anuncio.idempotency_key).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('a audiência é resolvida pelo Gomoon (destinatarios: "todos" — decisão 06/08/2026)', () => {
    const p = montarPayloadAnuncio({ ambiente: 'producao', geradoEm: '2026-08-06T12:00:00.000Z' });
    expect(p.anuncio.destinatarios).toBe('todos');
    expect(p.origem).toBe('godocs');
  });

  it('⚠️ NENHUM valor em R$ no texto do anúncio (§7.1)', () => {
    // A lista de palavras do aviso diário não serve aqui: o anúncio EXPLICA que o líder
    // confere "o ganho declarado". O que não pode é VALOR.
    const texto = montarPayloadAnuncio({ ambiente: 'producao', geradoEm: '2026-08-06T12:00:00.000Z' })
      .anuncio.mensagem.texto;
    expect(texto).not.toContain('R$');
    expect(texto).not.toMatch(/\d[\d.,]*\s*(reais|mil)/i);
  });

  it('envia com bearer no endpoint do ANÚNCIO (não no do aviso diário)', async () => {
    fetchMock.mockResolvedValue(resposta202([{ email: 'a@gocase.com', ok: true }]));
    const r = await anunciarPreAprovacao({ dry: false });

    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
    expect(r.itens).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gomoon.gogroupbr.com/api/godocs/anuncio');
    expect(init.headers.Authorization).toBe('Bearer tok-secreto');
    expect(JSON.parse(init.body).anuncio.idempotency_key).toBe(ANUNCIO_CHAVE);
  });

  it('⚠️ na STAGING o campo `ambiente` sai "staging" (única proteção — e aqui o risco é a empresa toda)', async () => {
    process.env.GODOCS_ENV = 'staging';
    fetchMock.mockResolvedValue(resposta202([{ ok: true }]));
    const r = await anunciarPreAprovacao({ dry: false });
    expect(r.ambiente).toBe('staging');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).ambiente).toBe('staging');
  });

  it('repetir o disparo NÃO é falha — conta `ja_entregues` (§13)', async () => {
    fetchMock.mockResolvedValue(
      resposta202([
        { email: 'a@gocase.com', ok: true, codigo: 'ja_entregue' },
        { email: 'b@gocase.com', ok: true },
      ]),
    );
    const r = await anunciarPreAprovacao({ dry: false });
    expect(r.ok).toBe(true);
    expect(r.ja_entregues).toBe(1);
    expect(r.falhas).toEqual([]);
  });

  it('falhas são reportadas e a lista é cortada em 20 (broadcast não cabe na resposta)', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => ({
      email: `f${i}@gocase.com`,
      ok: false,
      codigo: 'usuario_desconhecido',
    }));
    fetchMock.mockResolvedValue(resposta202(muitas));
    const r = await anunciarPreAprovacao({ dry: false });
    expect(r.falhas_total).toBe(25);
    expect(r.falhas).toHaveLength(20);
    expect(r.falhas[0]).toEqual({ email: 'f0@gocase.com', codigo: 'usuario_desconhecido' });
  });

  it('sem GOMOON_TOKEN não envia e diz por quê (não lança)', async () => {
    delete process.env.GOMOON_TOKEN;
    const r = await anunciarPreAprovacao({ dry: false });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/GOMOON_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP ruim e falha de rede voltam como ok:false (nunca lança)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'token invalido' });
    expect((await anunciarPreAprovacao({ dry: false })).ok).toBe(false);

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await anunciarPreAprovacao({ dry: false });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('ECONNREFUSED');
  });
});
