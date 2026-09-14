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
// ⚠️ Os CONTROLES de filtro saíram da tela e foram para o painel que abre (14/09/2026):
// eram oito campos sempre visíveis, ocupando quatro linhas antes do primeiro projeto. A
// tela segue dona do ESTADO e da composição (`aplicarFiltros`, as contagens); o painel é
// dono dos campos. Cada guard abaixo aponta para o arquivo onde a coisa guardada MORA.
const painel = ler('src/components/dashboard/painel-filtros.tsx');
// ⚠️ O campo de data do formulário MUDOU DE LUGAR na v2: a "data de criação" da
// Etapa 2 saiu (a data que vale passa a ser a de SUBMISSÃO) e quem usa o calendário
// agora é o "desde quando" do saving efetivado, na Etapa 3. O guard é o mesmo — o campo
// não pode voltar ao `type="date"` do sistema operacional — só o arquivo é outro.
const step3 = ler('src/lib/submeter/step3-ganhos.tsx');
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

  it('oferece as dimensões do painel', () => {
    expect(painel).toContain('<SeletorPeriodo');
    // ⚠️ A dimensão "natureza" (Especiais × Padrão) SAIU em 14/09/2026 — todo projeto tem
    // nota agora, então separar por natureza não responde pergunta de triagem nenhuma.
    expect(painel).not.toMatch(/especial: v as FiltroEspecial/);
    // ⚠️ As categorias de ganho vêm EXPANDIDAS: pílula que abre popover dentro de um painel
    // já aberto é um clique a mais para revelar 4 caixas que cabem na tela.
    expect(painel).toMatch(/<FiltroCategorias\s+expandido/);
    // ⚠️ O Segmentado "Ganho" ("Com saving" × "Com receita", escolha única da v1) SAIU em
    // 09/09/2026 e foi SUBSTITUÍDO pela pílula das 4 categorias da v2, multi-seleção que soma.
    // Decisão do Luis: "Era so mudar os que ja tinha e adaptalos devidamente" — não é pílula nova
    // ao lado da velha, é troca.
    expect(painel).toContain('<FiltroCategorias');
    expect(painel).toMatch(/categorias: proximas/);
    expect(painel).not.toMatch(/ganho: v as FiltroGanho/);
    expect(painel).toContain('Todas as áreas');
    // ⚠️ O filtro de PRÉ-STATUS saiu em 14/09/2026: `Pré-aprovado` virou um STATUS, então
    // filtrar por "Pré-pendente" passou a ser filtrar por "Pendente". O parecer inteiro do
    // líder segue na ficha.
    expect(painel).not.toContain('Qualquer pré-status');
  });

  it('"Limpar filtros" preserva a fila de status escolhida', () => {
    expect(painel).toContain('...FILTROS_VAZIOS, status: f.status');
  });

  // ⚠️ Com os campos fechados num painel, recorte ligado vira recorte INVISÍVEL: a lista
  // encolhe e ninguém sabe por quê. As pílulas do que está ligado são o que impede isso,
  // e cada uma desliga a própria dimensão.
  it('o que está filtrando aparece em pílulas, e cada uma desliga a sua dimensão', () => {
    expect(painel).toContain('descreverFiltrosAtivos(filtros)');
    expect(painel).toContain('limparDimensao(f, c.chave)');
  });

  it('a paginação volta ao início quando qualquer filtro muda', () => {
    expect(dashboard).toMatch(/setPagina\(1\);\s*\}, \[filtros, buscaAplicada, porPagina\]\)/);
  });
});

// ⚠️ A Etapa 3 NÃO tem mais campo de data. O "desde quando o ganho vale" (que usava o
// `CampoData` deste calendário, com teto em hoje) saiu em 02/09/2026, quando o valor do
// saving virou o PAR antes/agora — a tela pergunta "quanto era e quanto é agora", não
// quando começou. Os dois testes que viviam aqui checavam aquele campo.
//
// O canário fica, virado do avesso: se um campo de data voltar à Etapa 3, ele tem de vir
// pelo `CampoData` (nunca pelo `type="date"` nativo, que foi o motivo do calendário
// próprio existir) — e é isso que este teste garante, sem exigir que o campo exista.
describe('Etapa 3 — data, se voltar, vem pelo calendário do GoDocs', () => {
  it('não usa o input de data nativo', () => {
    expect(step3).not.toMatch(/^\s*type="date"/m)
  })

  it('se houver <CampoData, ele tem teto (o GoDocs documenta ganho JÁ realizado)', () => {
    if (step3.includes('<CampoData')) {
      expect(step3).toContain('maximo=')
    }
  })
})

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
    expect(dashboard).toMatch(/semearLote\(idsVisiveis\.split\(["']{1},["']{1}\)\)/);
    // ⚠️ Depende dos IDS, não do array: reordenar a mesma página não pode refazer o lote.
    expect(dashboard).toMatch(/\}, \[idsVisiveis\]\)/);
  });
});
