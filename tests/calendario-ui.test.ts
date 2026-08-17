// Fiação da UI do calendário e da barra de filtros.
//
// O projeto não tem harness de render (mesma limitação de `dashboard-loadings-ui.test.ts`),
// então o smoke da camada visual é feito sobre o FONTE. O que estes testes seguram é
// justamente o que voltaria calado: a tela refiltrando por fora da fonte única, o campo da
// Etapa 2 voltando ao `type="date"` do sistema operacional, e o piso de acessibilidade do
// calendário (tabindex móvel, Esc, foco visível).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const dashboard = ler('src/routes/_authenticated/dashboard.tsx');
const step2 = ler('src/lib/submeter/step2.tsx');
const calendario = ler('src/components/calendario/calendario.tsx');

describe('/dashboard — barra de filtros', () => {
  it('filtra pela fonte única, sem refiltrar status por fora', () => {
    expect(dashboard).toContain('aplicarFiltros(projetos, filtros)');
    // O filtro de status por `pilulaDe` na tela era o caminho antigo: hoje ele compõe com
    // os demais dentro de `aplicarFiltros`, senão a contagem e a lista discordam.
    expect(dashboard).not.toContain('pilulaDe(p.statusChave) === filtro');
  });

  it('as contagens das pílulas respeitam os demais filtros', () => {
    expect(dashboard).toContain('contarPorPilula(projetos, filtros)');
    expect(dashboard).toContain('totalSemStatus(projetos, filtros)');
  });

  it('oferece as cinco dimensões novas', () => {
    expect(dashboard).toContain('<SeletorPeriodo');
    expect(dashboard).toMatch(/especial: v as FiltroEspecial/);
    expect(dashboard).toMatch(/ganho: v as FiltroGanho/);
    expect(dashboard).toContain('Todas as áreas');
    expect(dashboard).toContain('Qualquer pré-status');
    // ⚠️ O rótulo do estado sai da fonte única que o chip da linha usa — filtro e célula
    // não podem chamar o mesmo estado por nomes diferentes.
    expect(dashboard).toContain('ROTULO_ESTADO_PARECER[estado]');
  });

  it('"Limpar filtros" preserva a fila de status escolhida', () => {
    expect(dashboard).toContain('...FILTROS_VAZIOS, status: f.status');
  });

  it('a paginação volta ao início quando qualquer filtro muda', () => {
    expect(dashboard).toMatch(/setPagina\(1\);\s*\}, \[filtros, buscaAplicada, porPagina\]\)/);
  });
});

describe('Etapa 2 — campo de data', () => {
  it('usa o calendário do GoDocs, não o do sistema operacional', () => {
    expect(step2).toContain('<CampoData');
    // Regex ancorada na linha: o comentário do arquivo CITA o `type="date"` que saiu.
    expect(step2).not.toMatch(/^\s*type="date"/m);
  });

  it('mantém a janela permitida (2024 → hoje) e o formato ISO do schema', () => {
    expect(step2).toContain('minimo="2024-01-01"');
    expect(step2).toContain('maximo={hojeIso()}');
    expect(step2).toContain('updateField("dataCriacao", iso)');
  });
});

describe('calendário — piso de acessibilidade', () => {
  it('tem UMA parada de Tab que sempre existe no mês visível', () => {
    expect(calendario).toContain('tabIndex={c.iso === paradaTab ? 0 : -1}');
    expect(calendario).toContain('disponiveis[0]?.iso');
  });

  it('anda pela grade com as setas e não entra em dia bloqueado', () => {
    expect(calendario).toContain('ArrowLeft');
    expect(calendario).toContain('if (bloqueado(destino)) return;');
  });

  it('Esc fecha e o foco volta ao gatilho', () => {
    expect(calendario).toContain("e.key === 'Escape'");
    expect(calendario).toMatch(/gatilho\.current\?\.focus\(\)/);
  });

  it('o estado do dia não é dito só por cor', () => {
    expect(calendario).toContain('aria-pressed={Boolean(naFaixa)}');
    expect(calendario).toContain('rotuloDiaCompleto(c.iso)');
  });

  it('abre em portal — o cartão da Etapa 2 tem rolagem e cortaria o painel', () => {
    expect(calendario).toContain('createPortal');
  });
});

describe('carregamento do admin', () => {
  const layout = ler('src/routes/_authenticated/route.tsx');

  it('a tela NÃO espera o veredito do auth para pintar', () => {
    // O `await fetch('/api/auth/me')` dentro do beforeLoad é o que segurava a rota inteira
    // em "Verificando permissões..." por ~750 ms de overhead fixo do edge — e só então o
    // dashboard começava o próprio carregamento (duas esperas em fila para um clique).
    expect(layout).toContain('return { user: null, verificacao: buscarAuth() }');
    expect(layout).not.toMatch(/const response = await fetch\("\/api\/auth\/me"\)/);
  });

  it('quem não é admin continua sendo redirecionado (o guarda só saiu do caminho crítico)', () => {
    expect(layout).toContain('GuardaAcesso');
    expect(layout).toContain('acesso_negado: true');
  });

  it('a página visível semeia as fichas em UMA requisição', () => {
    expect(dashboard).toContain('semearLote(idsVisiveis.split(\',\'))');
    // ⚠️ Depende dos IDS, não do array: reordenar a mesma página não pode refazer o lote.
    expect(dashboard).toMatch(/\}, \[idsVisiveis\]\)/);
  });
});
