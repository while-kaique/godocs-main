// Validação pura da Etapa 1 (Envio) — participantes/papéis + campos do projeto.
// Guarda a decisão D2/RF-103 (edição de legado relaxa escopo/status/ferramenta) sem
// regredir a submissão NOVA (RF-106). Função pura extraída de submeter.tsx.
import { describe, it, expect } from 'vitest';
import { validarEtapa1, type FormData } from '@/lib/submeter/constants';

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
    especial: false,
    contextoEspecial: '',
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
