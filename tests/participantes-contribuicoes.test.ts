// "O que essa pessoa fez?" — o texto curto por participante (Etapa 1).
//
// Duas metades, e o teste guarda as duas:
//  1. COLETA (formulário): `montarMembrosContribuicoes` monta o payload e
//     `contribuicoesFaltando`/`validarEtapa1` travam o avanço. A trava é do FRONT de
//     propósito (o zod do backend só limita o teto) — ver a nota em `chat.functions.ts`.
//  2. EXIBIÇÃO (abas do admin): `montarContribuicoesPorProjeto` transforma as linhas
//     cruas do banco no mapa que os cartões de `/especiais` e `/aprovacoes-pendentes`
//     consomem — essas telas listam do ESPELHO da planilha, onde o texto não existe.
import { describe, it, expect } from 'vitest';
import {
  CONTRIBUICAO_MIN,
  CONTRIBUICAO_MAX,
  DESCRICAO_PAPEL,
  montarMembrosContribuicoes,
  contribuicoesFaltando,
  contribuicaoEhDescricaoDePapel,
  contribuicoesCopiadas,
  validarEtapa1,
  type FormData,
} from '@/lib/submeter/constants';
import {
  montarContribuicoesPorProjeto,
  rotuloPapelParticipante,
} from '@/lib/participantes-contribuicoes';
import { rotuloColuna } from '@/lib/coluna-rotulo';

const TEXTO_OK = 'Montou os fluxos no n8n e validou com o time Fiscal';

// Form base VÁLIDO com equipe de uma pessoa — o mesmo molde dos outros testes de etapa.
function baseForm(over: Partial<FormData> = {}): FormData {
  return {
    escopo: 'interno',
    prodStatus: 'sim',
    nome: '',
    email: 'dono@gocase.com',
    ferramentas: ['Python'],
    ferramentaOutra: '',
    servicoExterno: '',
    emEquipe: 'sim',
    participantes: ['ana@gocase.com'],
    participantesPapeis: { 'ana@gocase.com': 'coexecutor' },
    participantesContribuicoes: { 'ana@gocase.com': TEXTO_OK },
    ganhoCategorias: ['saving_efetivado'],
    nomeProjeto: '',
    descricaoBreve: '',
    usaAiProxy: '',
    contrafactualAfetadosTipo: 'pessoa',
    contrafactualAfetados: [],
    vinculo: 'novo',
    paiId: '',
    paiNome: '',
    paiProdStatus: '',
    ...over,
  };
}

describe('montarMembrosContribuicoes', () => {
  it('descarta quem saiu da equipe (chave órfã não vai ao banco)', () => {
    const out = montarMembrosContribuicoes(['ana@gocase.com'], {
      'ana@gocase.com': TEXTO_OK,
      'quem-saiu@gocase.com': 'texto de alguém que foi removido',
    });
    expect(out).toEqual({ 'ana@gocase.com': TEXTO_OK });
  });

  it('faz trim e ignora texto vazio (como o mapa de papéis ignora papel não escolhido)', () => {
    const out = montarMembrosContribuicoes(['ana@gocase.com', 'bru@gocase.com'], {
      'ana@gocase.com': `  ${TEXTO_OK}  `,
      'bru@gocase.com': '   ',
    });
    expect(out).toEqual({ 'ana@gocase.com': TEXTO_OK });
  });

  it('corta no teto — o banco nunca recebe mais que CONTRIBUICAO_MAX', () => {
    const out = montarMembrosContribuicoes(['ana@gocase.com'], {
      'ana@gocase.com': 'x'.repeat(CONTRIBUICAO_MAX + 40),
    });
    expect(out['ana@gocase.com']).toHaveLength(CONTRIBUICAO_MAX);
  });
});

describe('contribuicoesFaltando', () => {
  it('acusa vazio e texto curto, na ordem dos participantes', () => {
    const faltando = contribuicoesFaltando(
      ['ana@gocase.com', 'bru@gocase.com', 'caio@gocase.com'],
      { 'ana@gocase.com': TEXTO_OK, 'bru@gocase.com': 'ajudou' },
    );
    expect(faltando).toEqual(['bru@gocase.com', 'caio@gocase.com']);
  });

  it('texto exatamente no mínimo passa (o piso é inclusivo)', () => {
    const faltando = contribuicoesFaltando(['ana@gocase.com'], {
      'ana@gocase.com': 'a'.repeat(CONTRIBUICAO_MIN),
    });
    expect(faltando).toEqual([]);
  });
});

describe('validarEtapa1 — a descrição do que cada um fez é obrigatória', () => {
  it('bloqueia a submissão NOVA quando falta o texto de alguém', () => {
    const errs = validarEtapa1(
      baseForm({
        participantes: ['ana@gocase.com', 'bru@gocase.com'],
        participantesPapeis: {
          'ana@gocase.com': 'coexecutor',
          'bru@gocase.com': 'contribuidor',
        },
        participantesContribuicoes: { 'ana@gocase.com': TEXTO_OK },
      }),
      { modoEdicao: false },
    );
    expect(errs.participantesContribuicoes).toBeTruthy();
    // Erro em campo PRÓPRIO: a mensagem de papel/coautor fala de outra coisa.
    expect(errs.participantes).toBeUndefined();
  });

  it('bloqueia também na EDIÇÃO (mesma régua dos papéis, D2/RF-102)', () => {
    const errs = validarEtapa1(
      baseForm({ participantesContribuicoes: { 'ana@gocase.com': 'fez o bot' } }),
      { modoEdicao: true },
    );
    expect(errs.participantesContribuicoes).toBeTruthy();
  });

  it('não cobra o texto enquanto o PAPEL ainda falta (uma cobrança por vez)', () => {
    const errs = validarEtapa1(
      baseForm({ participantesPapeis: {}, participantesContribuicoes: {} }),
      { modoEdicao: false },
    );
    expect(errs.participantes).toContain('papel');
    expect(errs.participantesContribuicoes).toBeUndefined();
  });

  it('libera quando todos têm papel e texto', () => {
    const errs = validarEtapa1(baseForm(), { modoEdicao: false });
    expect(errs.participantes).toBeUndefined();
    expect(errs.participantesContribuicoes).toBeUndefined();
  });

  it('projeto individual não pede nada disso', () => {
    const errs = validarEtapa1(
      baseForm({
        emEquipe: 'nao',
        participantes: [],
        participantesPapeis: {},
        participantesContribuicoes: {},
      }),
      { modoEdicao: false },
    );
    expect(errs.participantesContribuicoes).toBeUndefined();
  });
});

// Guard anti-cópia (caso Smart Replan, 25/08/2026): o submissor colou a DESCRIÇÃO do
// papel da legenda nos 3 campos "o que essa pessoa fez". Tem 20+ chars, então passava
// pelo gate de tamanho — mas não diz nada.
describe('contribuicaoEhDescricaoDePapel', () => {
  it('pega a descrição de cada papel colada verbatim', () => {
    expect(contribuicaoEhDescricaoDePapel(DESCRICAO_PAPEL.contribuidor)).toBe(true);
    expect(contribuicaoEhDescricaoDePapel(DESCRICAO_PAPEL.coexecutor)).toBe(true);
    expect(contribuicaoEhDescricaoDePapel(DESCRICAO_PAPEL.planejador)).toBe(true);
  });

  it('ignora ponto final, caixa e espaço a mais (o núcleo comparável colapsa isso)', () => {
    const t = '  AUXILIOU O TIME COM PLANEJAMENTO, DECISÕES TÉCNICAS OU IDEIAS, SEM ATUAR DIRETAMENTE NA EXECUÇÃO  ';
    expect(contribuicaoEhDescricaoDePapel(t)).toBe(true);
  });

  it('texto real do que a pessoa fez NÃO é bloqueado', () => {
    expect(contribuicaoEhDescricaoDePapel(TEXTO_OK)).toBe(false);
    expect(contribuicaoEhDescricaoDePapel('montou os fluxos e revisou os testes')).toBe(false);
  });

  it('vazio não arma', () => {
    expect(contribuicaoEhDescricaoDePapel('')).toBe(false);
    expect(contribuicaoEhDescricaoDePapel('   ')).toBe(false);
  });
});

describe('contribuicoesCopiadas', () => {
  it('lista quem colou a descrição, na ordem dos participantes', () => {
    const copiadas = contribuicoesCopiadas(
      ['ana@gocase.com', 'bru@gocase.com', 'caio@gocase.com'],
      {
        'ana@gocase.com': TEXTO_OK,
        'bru@gocase.com': DESCRICAO_PAPEL.contribuidor,
        'caio@gocase.com': DESCRICAO_PAPEL.planejador, // colou a legenda de OUTRO papel — também não vale
      },
    );
    expect(copiadas).toEqual(['bru@gocase.com', 'caio@gocase.com']);
  });
});

describe('validarEtapa1 — cópia da descrição do papel é barrada', () => {
  it('bloqueia quando o texto só repete o papel (mesmo com 20+ chars)', () => {
    const errs = validarEtapa1(
      baseForm({
        participantes: ['ana@gocase.com'],
        participantesPapeis: { 'ana@gocase.com': 'contribuidor' },
        participantesContribuicoes: { 'ana@gocase.com': DESCRICAO_PAPEL.contribuidor },
      }),
      { modoEdicao: false },
    );
    expect(errs.participantesContribuicoes).toContain('repete o texto do papel');
  });

  it('não bloqueia um texto real do que a pessoa fez', () => {
    const errs = validarEtapa1(
      baseForm({
        participantesContribuicoes: { 'ana@gocase.com': TEXTO_OK },
      }),
      { modoEdicao: false },
    );
    expect(errs.participantesContribuicoes).toBeUndefined();
  });
});

describe('rotuloPapelParticipante', () => {
  it('traduz os 3 papéis atuais', () => {
    expect(rotuloPapelParticipante('coexecutor')).toBe('Coautor');
    expect(rotuloPapelParticipante('planejador')).toBe('Participante');
    expect(rotuloPapelParticipante('contribuidor')).toBe('Contribuidor');
  });

  it('papéis LEGADOS caem em "Contribuidor" (mesma regra do sync)', () => {
    expect(rotuloPapelParticipante('idealizador')).toBe('Contribuidor');
    expect(rotuloPapelParticipante('referencia_tecnica')).toBe('Contribuidor');
  });

  it('vazio é ausência; desconhecido volta cru (melhor que sumir com a informação)', () => {
    expect(rotuloPapelParticipante('')).toBeNull();
    expect(rotuloPapelParticipante(null)).toBeNull();
    expect(rotuloPapelParticipante('papel_do_futuro')).toBe('papel_do_futuro');
  });
});

describe('montarContribuicoesPorProjeto (abas do admin)', () => {
  it('respeita a ordem de `membros` e anexa avulso no fim', () => {
    const mapa = montarContribuicoesPorProjeto([
      {
        id: 'p1',
        membros: JSON.stringify(['ana@gocase.com', 'bru@gocase.com']),
        membros_papeis: JSON.stringify({
          'ana@gocase.com': 'coexecutor',
          'bru@gocase.com': 'planejador',
        }),
        membros_contribuicoes: JSON.stringify({
          'bru@gocase.com': 'revisou as regras fiscais',
          'ana@gocase.com': TEXTO_OK,
          'fora@gocase.com': 'saiu da lista de membros mas tem texto',
        }),
      },
    ]);
    expect(mapa.p1.map((c) => c.email)).toEqual([
      'ana@gocase.com',
      'bru@gocase.com',
      'fora@gocase.com',
    ]);
    expect(mapa.p1[0]).toEqual({ email: 'ana@gocase.com', papel: 'Coautor', texto: TEXTO_OK });
    // Sem papel gravado → `null`, e o cartão simplesmente não desenha o chip.
    expect(mapa.p1[2].papel).toBeNull();
  });

  it('projeto sem texto nenhum NÃO entra no mapa (legado não vira fileira de "—")', () => {
    const mapa = montarContribuicoesPorProjeto([
      {
        id: 'legado-1',
        membros: JSON.stringify(['ana@gocase.com']),
        membros_papeis: null,
        membros_contribuicoes: JSON.stringify({ 'ana@gocase.com': '   ' }),
      },
      { id: 'legado-2', membros: null, membros_papeis: null, membros_contribuicoes: null },
    ]);
    expect(mapa).toEqual({});
  });

  it('JSON corrompido não derruba a tela (o mapper é defensivo)', () => {
    const mapa = montarContribuicoesPorProjeto([
      {
        id: 'p2',
        membros: '{isso não é json',
        membros_papeis: '[1,2,3]',
        membros_contribuicoes: JSON.stringify({ 'ana@gocase.com': TEXTO_OK }),
      },
    ]);
    expect(mapa.p2).toEqual([{ email: 'ana@gocase.com', papel: null, texto: TEXTO_OK }]);
  });
});

describe('rotuloColuna — a ficha fala a língua do formulário', () => {
  it('as colunas de papel aparecem como Coautor / Participante', () => {
    expect(rotuloColuna('Participantes')).toBe('Coautor');
    expect(rotuloColuna('Participantes 2')).toBe('Participante');
  });

  it('casa com cabeçalho digitado à mão (acento/caixa/espaço tolerantes)', () => {
    expect(rotuloColuna('PARTICIPANTES 2')).toBe('Participante');
    expect(rotuloColuna('  participantes  ')).toBe('Coautor');
  });

  it('coluna sem override volta como está (não inventa rótulo)', () => {
    expect(rotuloColuna('Contribuidor')).toBe('Contribuidor');
    expect(rotuloColuna('Saving Reais')).toBe('Saving Reais');
  });
});
