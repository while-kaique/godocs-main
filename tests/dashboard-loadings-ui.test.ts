// Loadings do /dashboard — guardas de fiação da UI.
//
// O projeto não tem harness de render (sem @testing-library/jsdom), então o "smoke" da
// camada visual é feito sobre o FONTE: garante que a tela usa as linhas-fantasma em vez do
// spinner que apagava a estrutura, que o skeleton não é anunciado a leitor de tela (o
// estado é dito em texto na região `aria-live`) e que o layout admin liga o cache de auth
// e o prefetch da planilha. Plano: docs/plans/loadings-dashboard-admin.md.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const dashboard = ler('src/routes/_authenticated/dashboard.tsx');
const layout = ler('src/routes/_authenticated/route.tsx');
const skeleton = ler('src/components/dashboard/skeleton-linhas.tsx');

describe('T4 — skeleton no lugar do spinner', () => {
  it('a tabela renderiza SkeletonLinhas enquanto carrega', () => {
    expect(dashboard).toContain("from '@/components/dashboard/skeleton-linhas'");
    expect(dashboard).toMatch(/carregando \? \(\s*<SkeletonLinhas/);
  });

  it('não sobrou o spinner centrado dentro da tabela', () => {
    expect(dashboard).not.toMatch(/Loader2 className="mx-auto/);
  });

  it('o estado de carregamento é anunciado por TEXTO na região aria-live', () => {
    expect(dashboard).toMatch(/aria-live="polite"[\s\S]{0,200}Lendo a planilha/);
  });

  it('o skeleton é decorativo e respeita prefers-reduced-motion', () => {
    expect(skeleton).toContain('aria-hidden');
    expect(skeleton).toContain('motion-reduce:animate-none');
  });

  it('a régua fantasma é neutra — não insinua uma fila de status', () => {
    expect(skeleton).not.toContain('--go-blue');
    expect(skeleton).not.toContain('corDaRegua');
  });
});

describe('T1 — a UI sinaliza a revalidação em background', () => {
  it('mostra ícone + texto (nunca só cor) quando revalidando', () => {
    expect(dashboard).toMatch(/dados\?\.revalidando/);
    expect(dashboard).toContain('Atualizando em segundo plano');
  });
});

describe('T2/T3 — o layout admin liga cache de auth e prefetch', () => {
  it('usa os helpers de sessionStorage e limpa o cache quando o acesso cai', () => {
    expect(layout).toContain("from \"@/lib/auth-cache\"");
    expect(layout).toContain('gravarAuthCache');
    expect(layout).toContain('limparAuthCache');
  });

  it('dispara o prefetch da planilha ANTES de esperar /api/auth/me', () => {
    // Dentro do beforeLoad — a revalidação em background, declarada acima, também
    // chama /api/auth/me e não conta para esta ordem.
    const corpo = layout.slice(layout.indexOf('beforeLoad:'));
    const iPrefetch = corpo.indexOf('iniciarPrefetchDashboard(');
    const iAuth = corpo.indexOf('await fetch("/api/auth/me")');
    expect(iPrefetch).toBeGreaterThan(-1);
    expect(iAuth).toBeGreaterThan(-1);
    expect(iPrefetch).toBeLessThan(iAuth);
  });

  it('a tela consome a promise do prefetch em vez de refazer o fetch', () => {
    expect(dashboard).toContain('consumirPrefetchDashboard');
  });
});
