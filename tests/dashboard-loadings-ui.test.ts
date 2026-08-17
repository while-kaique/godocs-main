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

// A antiga T1 guardava o selo "Atualizando em segundo plano" do stale-while-revalidate.
// Aquele SWR existia para esconder uma leitura de ~2 s da planilha DENTRO do request; a
// leitura saiu do request (o dado vem do espelho no SQLite) e o selo saiu com ela. O que
// ficou no lugar — e é o que precisa de guarda — é o aviso de que o espelho está VELHO:
// sem ele, o sync pode morrer em silêncio e a triagem decide status sobre dado de horas
// atrás sem desconfiar. Ver docs/plans/sqlite-fonte-de-leitura.md.
describe('T9 — a UI avisa quando o espelho da planilha está velho', () => {
  it('mostra ícone + texto (nunca só cor) quando o sync está atrasado ou falhou', () => {
    expect(dashboard).toMatch(/dados\.espelhoVelho \|\| dados\.syncFalhou \|\| dados\.semEspelho/);
    expect(dashboard).toContain('Sem sincronizar desde');
    expect(dashboard).toContain('<AlertTriangle');
  });

  it('em dia, a legenda diz quando a planilha foi sincronizada', () => {
    expect(dashboard).toContain('Planilha sincronizada às');
  });

  it('espelho VAZIO (recém-deployado) não finge sincronização — cai no aviso', () => {
    // Sem o `!dados.semEspelho`, a tela dizia "Planilha sincronizada às <agora>" com o
    // espelho vazio, antes de a 1ª corrida do cron acontecer.
    expect(dashboard).toContain('!dados.semEspelho');
    expect(dashboard).toContain('Ainda não sincronizou com a planilha');
  });

  it('o botão "Atualizar" avisa que está sincronizando (o clique agora lê a planilha)', () => {
    expect(dashboard).toContain("'Sincronizando…'");
  });
});

describe('T2/T3 — o layout admin liga cache de auth e prefetch', () => {
  it('usa os helpers de sessionStorage e limpa o cache quando o acesso cai', () => {
    expect(layout).toContain("from \"@/lib/auth-cache\"");
    expect(layout).toContain('gravarAuthCache');
    expect(layout).toContain('limparAuthCache');
  });

  it('o prefetch da planilha não fica atrás de NENHUMA espera de auth', () => {
    // Este teste nasceu para garantir a ORDEM (prefetch antes do `await fetch(/api/auth/me)`)
    // e ficou mais forte em 17/08/2026: o `beforeLoad` deixou de esperar o auth para pintar,
    // então não há mais `await` algum antes do prefetch. O que ele guarda hoje é isso —
    // reintroduzir um `await` de auth no beforeLoad recria a fila indiana que o PR #215
    // desfez, agora com a tela inteira em "Verificando permissões...".
    const corpo = layout.slice(layout.indexOf('beforeLoad:'));
    const iPrefetch = corpo.indexOf('iniciarPrefetchDashboard(');
    expect(iPrefetch).toBeGreaterThan(-1);
    const antesDoPrefetch = corpo.slice(0, iPrefetch);
    expect(antesDoPrefetch).not.toContain('await ');
    // E o veredito viaja como PROMESSA, não como valor esperado.
    expect(corpo).toContain('verificacao: buscarAuth()');
  });

  it('a tela consome a promise do prefetch em vez de refazer o fetch', () => {
    expect(dashboard).toContain('consumirPrefetchDashboard');
  });
});
