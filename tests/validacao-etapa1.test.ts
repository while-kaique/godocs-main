// Validação pura da Etapa 1 (Envio) — participantes/papéis + campos do projeto.
// Guarda a decisão D2/RF-103 (edição de legado relaxa escopo/status/ferramenta) sem
// regredir a submissão NOVA (RF-106). Função pura extraída de submeter.tsx.
import { describe, it, expect } from 'vitest';
import {
  validarEtapa1,
  coautoresSelecionados,
  limitarCoautorUnico,
  type FormData,
} from '@/lib/submeter/constants';

// Form base VÁLIDO para submissão nova (todos os campos preenchidos, sem equipe).
function baseForm(over: Partial<FormData> = {}): FormData {
  return {
    escopo: 'interno',
    prodStatus: 'sim',
    nome: '',
    email: 'dono@gocase.com',
    ferramenta: 'Python',
    ferramentaOutra: '',
    servicoExterno: '',
    emEquipe: 'nao',
    participantes: [],
    participantesPapeis: {},
    nomeProjeto: '',
    dataCriacao: '',
    tipoProjeto: [],
    descricaoBreve: '',
    usaAiProxy: '',
    contrafactualAfetadosTipo: 'pessoa',
    contrafactualAfetados: [],
    especial: false,
    contextoEspecial: '',
    especialDashboard: '',
    especialGanhoOrganizacional: '',
    ...over,
  };
}

describe('validarEtapa1 — submissão NOVA (modoEdicao=false, RF-106)', () => {
  it('form completo e válido passa sem erros', () => {
    expect(validarEtapa1(baseForm(), { modoEdicao: false })).toEqual({});
  });

  it('bloqueia por ferramenta ausente (validação cheia)', () => {
    const errs = validarEtapa1(baseForm({ ferramenta: '' }), { modoEdicao: false });
    expect(errs.ferramenta).toBeTruthy();
  });

  it('bloqueia por escopo ausente', () => {
    const errs = validarEtapa1(baseForm({ escopo: '' }), { modoEdicao: false });
    expect(errs.escopo).toBeTruthy();
  });

  it('bloqueia projeto fora de produção', () => {
    const errs = validarEtapa1(baseForm({ prodStatus: 'dev' }), { modoEdicao: false });
    expect(errs.prodStatus).toBeTruthy();
  });

  it('externo exige nome do serviço', () => {
    const errs = validarEtapa1(
      baseForm({ escopo: 'externo', ferramenta: '', servicoExterno: '' }),
      { modoEdicao: false },
    );
    expect(errs.servicoExterno).toBeTruthy();
  });
});

describe('validarEtapa1 — EDIÇÃO de legado (modoEdicao=true, RF-103/D2)', () => {
  it('legado sem ferramenta/escopo/status passa (só participantes é o foco)', () => {
    const legado = baseForm({ escopo: '', prodStatus: '', ferramenta: '', emEquipe: 'nao' });
    expect(validarEtapa1(legado, { modoEdicao: true })).toEqual({});
  });

  it('prodStatus fora de produção NÃO trava em edição', () => {
    const errs = validarEtapa1(baseForm({ prodStatus: 'dev' }), { modoEdicao: true });
    expect(errs.prodStatus).toBeUndefined();
  });

  it('ainda exige identidade detectada (e-mail da conta)', () => {
    const errs = validarEtapa1(baseForm({ email: '' }), { modoEdicao: true });
    expect(errs.email).toBeTruthy();
  });

  // A ferramenta virou EDITÁVEL na Etapa 1 da edição (a stack muda: Vercel → GoDeploy).
  // Trocar de uma opção da lista para outra não pode gerar erro nenhum.
  it('trocar a ferramenta na edição não gera erro', () => {
    const errs = validarEtapa1(baseForm({ ferramenta: 'Claude + GoDeploy' }), { modoEdicao: true });
    expect(errs).toEqual({});
  });
});

// "Outros" sem o nome gravaria a string literal "Outros" na planilha — é o único pedaço
// da ferramenta cobrado nos DOIS modos (a ferramenta em si segue opcional no legado).
describe('validarEtapa1 — "Outros" exige o nome da ferramenta nos DOIS modos', () => {
  for (const modoEdicao of [false, true]) {
    it(`bloqueia "Outros" sem especificar (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({ ferramenta: 'Outros', ferramentaOutra: '  ' }),
        { modoEdicao },
      );
      expect(errs.ferramentaOutra).toBeTruthy();
    });

    it(`aceita "Outros" com o nome preenchido (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({ ferramenta: 'Outros', ferramentaOutra: 'Retool' }),
        { modoEdicao },
      );
      expect(errs.ferramentaOutra).toBeUndefined();
    });
  }

  it('escopo externo não é cobrado pela regra do "Outros"', () => {
    const errs = validarEtapa1(
      baseForm({ escopo: 'externo', ferramenta: 'Outros', ferramentaOutra: '', servicoExterno: 'Zapier' }),
      { modoEdicao: true },
    );
    expect(errs.ferramentaOutra).toBeUndefined();
  });
});

describe('validarEtapa1 — participantes/papéis exigidos nos DOIS modos (RF-101/RF-102)', () => {
  for (const modoEdicao of [false, true]) {
    it(`em equipe sem participante bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(baseForm({ emEquipe: 'sim', participantes: [] }), { modoEdicao });
      expect(errs.participantes).toBeTruthy();
    });

    it(`participante com domínio inválido bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['fulano@gmail.com'],
          participantesPapeis: { 'fulano@gmail.com': 'coexecutor' },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain('@gocase');
    });

    it(`participante sem papel escolhido bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['a@gocase.com'],
          participantesPapeis: { 'a@gocase.com': '' },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBe('Escolha o papel de cada participante');
    });

    it(`participante válido com papel passa quanto a participantes (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['a@gocase.com'],
          participantesPapeis: { 'a@gocase.com': 'contribuidor' },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });
  }
});

// Coautor ÚNICO por projeto (decisão de produto 30/07/2026): 1 autor (o submissor) +
// no máximo 1 Coautor. Vale nos DOIS modos (submissão nova e edição de legado).
describe('Coautor único por projeto', () => {
  for (const modoEdicao of [false, true]) {
    it(`bloqueia 2 participantes marcados como Coautor (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['a@gocase.com', 'b@gocase.com'],
          participantesPapeis: { 'a@gocase.com': 'coexecutor', 'b@gocase.com': 'coexecutor' },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain('1 Coautor');
    });

    it(`aceita 1 Coautor + demais em outros papéis (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['a@gocase.com', 'b@gocase.com', 'c@gocase.com'],
          participantesPapeis: {
            'a@gocase.com': 'coexecutor',
            'b@gocase.com': 'planejador',
            'c@gocase.com': 'contribuidor',
          },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });

    it(`aceita projeto SEM Coautor (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: 'sim',
          participantes: ['a@gocase.com', 'b@gocase.com'],
          participantesPapeis: { 'a@gocase.com': 'planejador', 'b@gocase.com': 'contribuidor' },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });
  }
});

describe('coautoresSelecionados / limitarCoautorUnico (helpers puros)', () => {
  it('lista só os participantes marcados como Coautor, na ordem da lista', () => {
    const participantes = ['a@gocase.com', 'b@gocase.com', 'c@gocase.com'];
    const papeis = {
      'a@gocase.com': 'planejador',
      'b@gocase.com': 'coexecutor',
      'c@gocase.com': 'coexecutor',
    } as const;
    expect(coautoresSelecionados(participantes, { ...papeis })).toEqual([
      'b@gocase.com',
      'c@gocase.com',
    ]);
  });

  it('seed com vários Coautores: mantém o primeiro e limpa o papel dos demais', () => {
    const participantes = ['a@gocase.com', 'b@gocase.com', 'c@gocase.com'];
    const papeis = {
      'a@gocase.com': 'coexecutor',
      'b@gocase.com': 'coexecutor',
      'c@gocase.com': 'coexecutor',
    } as const;
    expect(limitarCoautorUnico(participantes, { ...papeis })).toEqual({
      'a@gocase.com': 'coexecutor',
      'b@gocase.com': '',
      'c@gocase.com': '',
    });
  });

  it('seed já conforme (0 ou 1 Coautor) volta inalterado', () => {
    const participantes = ['a@gocase.com', 'b@gocase.com'];
    const papeis = { 'a@gocase.com': 'coexecutor', 'b@gocase.com': 'contribuidor' } as const;
    const entrada = { ...papeis };
    expect(limitarCoautorUnico(participantes, entrada)).toBe(entrada);
  });
});
