// Validação pura da Etapa 2 (Dados do Projeto) + prontidão para o processamento em
// background da documentação. Guarda a regra de arquivos/existentes/invalidado (F1: remover
// um arquivo já enviado exige re-upload, pois o servidor guarda a doc como texto único
// concatenado) e os campos mínimos que liberam o disparo em background (F2). Funções puras
// extraídas de submeter.tsx.
import { describe, it, expect } from 'vitest';
import {
  validarEtapa2,
  camposMinimosDocProntos,
  type FormData,
} from '@/lib/submeter/constants';

const HOJE = '2026-07-22';

// Form base VÁLIDO na Etapa 2 (campos preenchidos). Arquivos/existentes são passados à parte.
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
    nomeProjeto: 'Automação de Relatórios',
    dataCriacao: '2026-01-10',
    tipoProjeto: [],
    descricaoBreve: 'x'.repeat(60),
    usaAiProxy: 'sim',
    especial: false,
    contextoEspecial: '',
    ...over,
  };
}

function opts(over: Partial<Parameters<typeof validarEtapa2>[1]> = {}) {
  return {
    arquivosCount: 1,
    nomesExistentesCount: 0,
    docExistenteInvalidado: false,
    hojeISO: HOJE,
    ...over,
  };
}

describe('validarEtapa2 — campos', () => {
  it('form completo com 1 arquivo novo passa sem erros', () => {
    expect(validarEtapa2(baseForm(), opts())).toEqual({});
  });

  it('nome curto bloqueia', () => {
    const errs = validarEtapa2(baseForm({ nomeProjeto: 'ab' }), opts());
    expect(errs.nomeProjeto).toBeTruthy();
  });

  it('contexto com menos de 60 chars bloqueia', () => {
    const errs = validarEtapa2(baseForm({ descricaoBreve: 'curto' }), opts());
    expect(errs.descricaoBreve).toBeTruthy();
  });

  it('AI Proxy não respondido bloqueia', () => {
    const errs = validarEtapa2(baseForm({ usaAiProxy: '' }), opts());
    expect(errs.usaAiProxy).toBeTruthy();
  });

  it('data no futuro bloqueia; data válida passa', () => {
    expect(validarEtapa2(baseForm({ dataCriacao: '2027-01-01' }), opts()).dataCriacao).toBeTruthy();
    expect(validarEtapa2(baseForm({ dataCriacao: '2023-12-31' }), opts()).dataCriacao).toBeTruthy();
    expect(validarEtapa2(baseForm({ dataCriacao: HOJE }), opts()).dataCriacao).toBeUndefined();
  });
});

describe('validarEtapa2 — regra de arquivos (F1)', () => {
  it('sem arquivos novos e sem existentes → exige selecionar', () => {
    const errs = validarEtapa2(baseForm(), opts({ arquivosCount: 0, nomesExistentesCount: 0 }));
    expect(errs.documentacao).toContain('Selecione');
  });

  it('só arquivos existentes (edição, nada removido) → passa', () => {
    const errs = validarEtapa2(
      baseForm(),
      opts({ arquivosCount: 0, nomesExistentesCount: 1, docExistenteInvalidado: false }),
    );
    expect(errs.documentacao).toBeUndefined();
  });

  it('existentes ainda listados MAS invalidados (removeu 1 de vários) e sem upload → exige re-upload', () => {
    const errs = validarEtapa2(
      baseForm(),
      opts({ arquivosCount: 0, nomesExistentesCount: 1, docExistenteInvalidado: true }),
    );
    expect(errs.documentacao).toContain('removeu');
  });

  it('invalidado mas com upload novo → passa (a doc será regerada)', () => {
    const errs = validarEtapa2(
      baseForm(),
      opts({ arquivosCount: 2, nomesExistentesCount: 0, docExistenteInvalidado: true }),
    );
    expect(errs.documentacao).toBeUndefined();
  });
});

describe('camposMinimosDocProntos — gatilho do background (F2, gatilho enxuto)', () => {
  it('form completo → pronto', () => {
    expect(camposMinimosDocProntos(baseForm())).toBe(true);
  });

  it('sem escopo (Etapa 1 incompleta) → não pronto', () => {
    expect(camposMinimosDocProntos(baseForm({ escopo: '' }))).toBe(false);
  });

  it('nome curto → não pronto', () => {
    expect(camposMinimosDocProntos(baseForm({ nomeProjeto: 'ab' }))).toBe(false);
  });

  // "Adiantar o background": o gatilho deliberadamente NÃO espera pelos campos da Etapa 2
  // (descrição e AI Proxy), que a pessoa digita/responde por último — assim o processamento
  // arranca assim que o arquivo é anexado, com folga para terminar antes do clique em avançar.
  it('descrição ainda curta, mas Etapa 1 pronta → PRONTO (não segura o disparo)', () => {
    expect(camposMinimosDocProntos(baseForm({ descricaoBreve: 'curto' }))).toBe(true);
  });

  it('AI Proxy ainda não respondido, mas Etapa 1 pronta → PRONTO (não segura o disparo)', () => {
    expect(camposMinimosDocProntos(baseForm({ usaAiProxy: '' }))).toBe(true);
  });
});
