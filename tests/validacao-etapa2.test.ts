// Validação pura da Etapa 2 (Dados do Projeto) + prontidão para o processamento em
// background da documentação. Guarda a regra de arquivos/existentes/invalidado (F1: remover
// um arquivo já enviado exige re-upload, pois o servidor guarda a doc como texto único
// concatenado) e os campos mínimos que liberam o disparo em background (F2). Funções puras
// extraídas de submeter.tsx.
import { describe, it, expect } from 'vitest';
import {
  validarEtapa2,
  camposMinimosDocProntos,
  serializarAfetados,
  desserializarAfetados,
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
    ferramentas: ['Python'],
    ferramentaOutra: '',
    servicoExterno: '',
    emEquipe: 'nao',
    participantes: [],
    participantesPapeis: {},
    participantesContribuicoes: {},
    nomeProjeto: 'Automação de Relatórios',
    ganhoCategorias: ['saving_efetivado'],
    descricaoBreve: 'x'.repeat(60),
    usaAiProxy: 'sim',
    contrafactualAfetadosTipo: 'pessoa',
    contrafactualAfetados: ['maria@gocase.com'],
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

  // ⚠️ A "data de criação" SAIU do formulário na v2 (a data que vale é a de SUBMISSÃO,
  // porque só se submete o que já está em produção). O guard de "data no futuro" não
  // desapareceu: ele migrou para o "desde quando" do saving efetivado, e vive em
  // `tests/validacao-etapa3.test.ts` (fronteira de `hojeISO`).

  describe('categorias de ganho (v2)', () => {
    it('nenhuma categoria marcada bloqueia', () => {
      const errs = validarEtapa2(baseForm({ ganhoCategorias: [] }), opts());
      expect(errs.ganhoCategorias).toBeTruthy();
    });

    it('imensurável misturado com mensurável bloqueia', () => {
      const errs = validarEtapa2(
        baseForm({ ganhoCategorias: ['saving_efetivado', 'imensuravel'] }),
        opts(),
      );
      expect(errs.ganhoCategorias).toBeTruthy();
    });

    it('as três mensuráveis combinam livremente', () => {
      const errs = validarEtapa2(
        baseForm({
          ganhoCategorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
        }),
        opts(),
      );
      expect(errs.ganhoCategorias).toBeUndefined();
    });

    it('só o imensurável passa', () => {
      const errs = validarEtapa2(baseForm({ ganhoCategorias: ['imensuravel'] }), opts());
      expect(errs.ganhoCategorias).toBeUndefined();
    });

    // Rascunho salvo em localStorage ANTES desta feature não tem a chave. Ler
    // `undefined.length` derrubava /submeter inteira ("This page didn't load").
    it('rascunho antigo sem a chave não derruba a validação', () => {
      const semChave = baseForm();
      delete (semChave as Partial<typeof semChave>).ganhoCategorias;
      expect(() => validarEtapa2(semChave, opts())).not.toThrow();
      expect(validarEtapa2(semChave, opts()).ganhoCategorias).toBeTruthy();
    });
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

// ── Contrafactual: pergunta determinística da Etapa 2 ───────────────────────
// Invariante central: obrigatório RESPONDER ≠ barrar a submissão (a reprovação é
// pós-envio, decidida pelo analisador). O PONTEIRO movido saiu do formulário — quem
// pergunta e constrói o racional é o AGENTE, na seção do memorial.
describe('validarEtapa2 — contrafactual (quem reclama)', () => {
  it('exige ao menos uma pessoa quando o filtro é por pessoa', () => {
    const errs = validarEtapa2(baseForm({ contrafactualAfetados: [] }), opts());
    expect(errs.contrafactualAfetados).toMatch(/pessoa/i);
  });

  it('exige ao menos um time quando o filtro é por time', () => {
    const errs = validarEtapa2(
      baseForm({ contrafactualAfetadosTipo: 'time', contrafactualAfetados: [] }),
      opts(),
    );
    expect(errs.contrafactualAfetados).toMatch(/time/i);
  });

  it('um time inteiro selecionado passa (não precisa marcar pessoa por pessoa)', () => {
    const errs = validarEtapa2(
      baseForm({ contrafactualAfetadosTipo: 'time', contrafactualAfetados: ['Fiscal'] }),
      opts(),
    );
    expect(errs).toEqual({});
  });

  // A pergunta "E o que piora?" foi REMOVIDA do formulário em 03/08/2026 — nunca teve
  // coluna própria no Sheets e o analisador extrai o efeito de desligar da doc/memorial.
  it('NÃO exige mais o "o que piora" (pergunta removida do formulário)', () => {
    const errs = validarEtapa2(baseForm(), opts());
    expect(errs).toEqual({});
    expect(Object.keys(errs)).not.toContain('contrafactualReclamacao');
  });

  it('NÃO exige mais nada sobre ponteiro/evidência (saiu do formulário)', () => {
    const errs = validarEtapa2(baseForm(), opts());
    expect(errs).toEqual({});
    expect(Object.keys(errs)).not.toContain('ponteiroMovido');
  });

  it('a pergunta nova NÃO entra no gatilho do processamento em background', () => {
    expect(
      camposMinimosDocProntos(
        baseForm({ contrafactualAfetados: [] }),
      ),
    ).toBe(true);
  });
});

// ── Serialização dos afetados (banco ↔ formulário) ──────────────────────────
describe('serializarAfetados / desserializarAfetados', () => {
  it('faz o round-trip de pessoas e de times', () => {
    for (const [tipo, lista] of [
      ['pessoa', ['a@gocase.com', 'b@gocase.com']],
      ['time', ['Fiscal', 'CX']],
    ] as const) {
      const bruto = serializarAfetados(tipo, [...lista]);
      expect(desserializarAfetados(bruto)).toEqual({ tipo, lista: [...lista] });
    }
  });

  it('lista vazia → string vazia (nada é gravado)', () => {
    expect(serializarAfetados('time', [])).toBe('');
    expect(serializarAfetados('pessoa', ['  '])).toBe('');
  });

  it('valor ausente/legado desserializa para pessoa + lista vazia', () => {
    expect(desserializarAfetados(null)).toEqual({ tipo: 'pessoa', lista: [] });
    expect(desserializarAfetados('')).toEqual({ tipo: 'pessoa', lista: [] });
    expect(desserializarAfetados('lixo-sem-prefixo')).toEqual({ tipo: 'pessoa', lista: [] });
  });
});
