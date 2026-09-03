// T11 — Dossiê do projeto (D17), lado PURO (`src/lib/avaliacao/dossie.ts`).
//
// Prende o contrato do dossiê que o time de avaliação lê: montado das fontes que o app
// já persiste (projetos + documentacao + espelho da planilha + versões + form_events +
// cargo da TeamGuide), SEM chat, tolerante a fonte ausente/JSON podre (nunca lança) e
// declarando as LACUNAS em vez de fingir completude. Cobre também a montagem a partir de
// uma linha da planilha (mapeamento por NOME de coluna, tolerante a acento/caixa via a
// régua de `coluna-chave.ts`), a serialização em texto (R$ escondido por padrão) e o
// resumo (chars/seções/lacunas).
import { describe, it, expect } from 'vitest';

import {
  montarDossie,
  dossieDaLinhaPlanilha,
  dossieParaTexto,
  resumoDossie,
  type FontesDossie,
  type Lacuna,
} from '@/lib/avaliacao/dossie';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MEMORIAL_SAVING_MARCADOR = 'MEMORIAL_SAVING_MARCADOR_XYZ';

function projetoCompleto(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abc123',
    nome: 'Robô de Conciliação',
    descricao_breve: 'Concilia extratos bancários automaticamente.',
    responsavel_nome: 'Ana Silva',
    responsavel_email: 'ana.silva@gocase.com',
    area: 'Financeiro',
    especial: 1,
    tipos_projeto: '["especial"]',
    ferramenta: 'Python + GoDeploy',
    escopo: 'Toda a empresa',
    saving_horas: 60,
    saving_reais: 8844,
    tipo_saving: 'mensal',
    alguem_fazia: 'sim',
    custo_evitado_reais: 1200,
    custo_evitado_itens: '[{"nome":"Contrato XPTO","valor":1200,"recorrencia":"mensal"}]',
    custo_projeto_itens: '[{"nome":"API OpenAI","valor":50,"recorrencia":"mensal"}]',
    custo_externo_mensal: 100,
    ganho_total_mensal: 7321,
    memorial_calculo: 'Memorial unificado do banco',
    contrafactual_afetados: '["pessoa:joao@gocase.com","time:Fiscal"]',
    membros: '["ana.silva@gocase.com","joao@gocase.com"]',
    arquivos_links: '["https://drive.google.com/a","https://drive.google.com/b"]',
    contexto_especial: 'É especial porque X.',
    descontinuado: 0,
    atualizado_em: '2026-08-20 10:00:00',
    submitted_at: '2026-08-01 09:00:00',
    ...extra,
  };
}

function documentacaoCompleta(): string {
  return JSON.stringify({
    o_que_faz: 'Lê o extrato e casa com o ERP.',
    execucao: 'Roda todo dia às 6h.',
    fluxo: [
      { etapa: 'Baixar extrato', descricao: 'via API do banco' },
      { etapa: 'Conciliar', descricao: 'casa lançamentos' },
    ],
    dependencias: [{ servico: 'API Banco', descricao: 'token OAuth' }],
    atencao: [{ titulo: 'Feriados', descricao: 'não roda em feriado' }],
    configurar_antes: ['Criar credencial no banco'],
    saving: {
      linhas: [
        { cargo: 'Analista Financeiro', horas_antes: 60, horas_depois: 0 },
        { cargo: 'Supervisor', horas_antes: 10, horas_depois: 2 },
      ],
    },
  });
}

function espelhoCompleto(): Record<string, string> {
  return {
    'ID Projeto': 'abc123',
    Projeto: 'Robô de Conciliação',
    Status: 'Aprovado',
    Estrelas: '7',
    Classificação: 'claro_sim',
    'Motivo Reprovado': '—',
    'Motivo Reenvio': 'Ajustar a periodicidade',
    'Aprovação do Líder': 'Pré-aprovado',
    'Justificativa Aprovação do Líder': 'Parecer: Pré-aprovado por Kelly',
    Observações: 'Parecer do analisador aqui',
    'Memorial de Saving': `### Contexto\nR$ 8.844,00 de saving ${MEMORIAL_SAVING_MARCADOR}`,
    'Receita Memorial': 'Memorial de receita sem valor',
    'Receita Mensal': '2.000,00',
    'Tipo de Receita': 'Recorrente',
    Complexidade: 'Média',
    'Saving Horas Real': '40',
    'Saving Horas Escalado': '20',
    'Justificativa Saving Escalado e Real': 'Antes fazia à mão 40h; a automação cobriu 20h a mais.',
    'Alocação Ganhos': 'Mais entrega: passou a fechar o mês em D+1.',
  };
}

function versoesDuas(): FontesDossie['versoes'] {
  return [
    {
      versao_num: 1,
      acao: 'submit_inicial',
      snapshot_projeto: JSON.stringify({ nome: 'Robô de Conciliação', saving_reais: 100 }),
      created_at: '2026-08-01 09:00:00',
    },
    {
      versao_num: 2,
      acao: 'reenvio',
      snapshot_projeto: JSON.stringify({ nome: 'Robô de Conciliação', saving_reais: 250 }),
      created_at: '2026-08-20 10:00:00',
    },
  ];
}

function eventosDois(): FontesDossie['eventos'] {
  return [
    { tipo: 'submissao', fase: 'doc', dados: '{"Nome":"Robô"}', created_at: '2026-08-01 09:00:00' },
    { tipo: 'saving', fase: 'saving', dados: '{"Horas":"60"}', created_at: '2026-08-01 09:30:00' },
  ];
}

function fontesCompletas(over: Partial<FontesDossie> = {}): FontesDossie {
  return {
    projeto: projetoCompleto(),
    documentacao: documentacaoCompleta(),
    espelho: espelhoCompleto(),
    versoes: versoesDuas(),
    eventos: eventosDois(),
    cargoAutor: 'Analista',
    ...over,
  };
}

function ordenado(l: readonly Lacuna[]): Lacuna[] {
  return [...l].sort();
}

// ── montarDossie ────────────────────────────────────────────────────────────

describe('montarDossie — presença das fontes', () => {
  it('projeto null E espelho null → null (não há do que montar)', () => {
    expect(montarDossie(fontesCompletas({ projeto: null, espelho: null }))).toBeNull();
  });

  it('projeto null mas espelho presente → monta da planilha e declara a lacuna "projeto"', () => {
    const d = montarDossie(fontesCompletas({ projeto: null }));
    expect(d).not.toBeNull();
    expect(d!.fonte).toBe('planilha');
    expect(d!.id).toBe('abc123');
    expect(d!.lacunas).toContain('projeto');
  });

  it('fontes completas do app → fonte "app", tudo preenchido e SÓ as lacunas inevitáveis', () => {
    const d = montarDossie(fontesCompletas())!;
    expect(d).not.toBeNull();
    expect(d.fonte).toBe('app');

    // Identificação
    expect(d.id).toBe('abc123');
    expect(d.nome).toBe('Robô de Conciliação');
    expect(d.area).toBe('Financeiro');
    expect(d.autor).toEqual({ nome: 'Ana Silva', email: 'ana.silva@gocase.com', cargo: 'Analista' });

    // Submissão
    expect(d.submissao.data).toBe('2026-08-01 09:00:00');
    expect(d.submissao.versao).toBe(2);
    expect(d.submissao.reenvios).toBe(1);
    expect(d.submissao.atualizado_em).toBe('2026-08-20 10:00:00');
    expect(d.submissao.descontinuado).toBe(false);

    // Classificação
    expect(d.classificacao.especial).toBe(true);
    expect(d.classificacao.tipos).toEqual(['especial']);
    expect(d.classificacao.complexidade).toBe('Média');
    expect(d.classificacao.ferramenta).toBe('Python + GoDeploy');
    expect(d.classificacao.escopo).toBe('Toda a empresa');

    expect(d.descricao).toBe('Concilia extratos bancários automaticamente.');

    // Documentação — listas achatadas em "chave: valor"
    expect(d.documentacao.presente).toBe(true);
    expect(d.documentacao.o_que_faz).toBe('Lê o extrato e casa com o ERP.');
    expect(d.documentacao.execucao).toBe('Roda todo dia às 6h.');
    expect(d.documentacao.fluxo).toEqual([
      'Baixar extrato: via API do banco',
      'Conciliar: casa lançamentos',
    ]);
    expect(d.documentacao.dependencias).toEqual(['API Banco: token OAuth']);
    expect(d.documentacao.atencao).toEqual(['Feriados: não roda em feriado']);
    expect(d.documentacao.configurar_antes).toEqual(['Criar credencial no banco']);

    // Financeiro
    expect(d.financeiro.saving_horas).toBe(60);
    expect(d.financeiro.saving_reais).toBe(8844);
    expect(d.financeiro.tipo_saving).toBe('mensal');
    expect(d.financeiro.alguem_fazia).toBe('sim');
    expect(d.financeiro.linhas).toEqual([
      { cargo: 'Analista Financeiro', horas_antes: 60, horas_depois: 0 },
      { cargo: 'Supervisor', horas_antes: 10, horas_depois: 2 },
    ]);
    expect(d.financeiro.custo_evitado_reais).toBe(1200);
    expect(d.financeiro.custo_evitado_itens).toEqual([
      { nome: 'Contrato XPTO', valor: 1200, recorrencia: 'mensal' },
    ]);
    expect(d.financeiro.custo_projeto_itens).toEqual([
      { nome: 'API OpenAI', valor: 50, recorrencia: 'mensal' },
    ]);
    expect(d.financeiro.custo_externo_mensal).toBe(100);
    expect(d.financeiro.ganho_total_mensal).toBe(7321);
    expect(d.financeiro.receita_mensal).toBe(2000);
    expect(d.financeiro.tipo_receita).toBe('Recorrente');
    expect(d.financeiro.memorial_saving).toContain(MEMORIAL_SAVING_MARCADOR);
    expect(d.financeiro.memorial_receita).toBe('Memorial de receita sem valor');
    expect(d.financeiro.observacoes_analisador).toBe('Parecer do analisador aqui');
    expect(d.financeiro.horas_carga_real).toBe(40);
    expect(d.financeiro.horas_escala).toBe(20);
    expect(d.financeiro.justificativa_carga_escala).toBe(
      'Antes fazia à mão 40h; a automação cobriu 20h a mais.',
    );
    expect(d.financeiro.alocacao_ganhos).toBe('Mais entrega: passou a fechar o mês em D+1.');

    // Triagem (vem do espelho)
    expect(d.triagem.status).toBe('Aprovado');
    expect(d.triagem.estrelas).toBe(7);
    expect(typeof d.triagem.estrelas).toBe('number');
    expect(d.triagem.classificacao).toBe('claro_sim');
    expect(d.triagem.motivo_reprovado).toBeNull(); // "—" vira null
    expect(d.triagem.motivo_reenvio).toBe('Ajustar a periodicidade');
    expect(d.triagem.aprovacao_lider).toBe('Pré-aprovado');
    expect(d.triagem.justificativa_lider).toBe('Parecer: Pré-aprovado por Kelly');

    // Contexto
    expect(d.contexto.contrafactual_afetados).toEqual(['pessoa:joao@gocase.com', 'time:Fiscal']);
    expect(d.contexto.membros).toEqual(['ana.silva@gocase.com', 'joao@gocase.com']);
    expect(d.contexto.anexos_links).toEqual([
      'https://drive.google.com/a',
      'https://drive.google.com/b',
    ]);
    expect(d.contexto.contexto_especial).toBe('É especial porque X.');

    // Histórico
    expect(d.historico.versoes).toEqual([
      { versao_num: 1, acao: 'submit_inicial', created_at: '2026-08-01 09:00:00' },
      { versao_num: 2, acao: 'reenvio', created_at: '2026-08-20 10:00:00' },
    ]);
    expect(d.historico.eventos).toEqual([
      { tipo: 'submissao', fase: 'doc', created_at: '2026-08-01 09:00:00' },
      { tipo: 'saving', fase: 'saving', created_at: '2026-08-01 09:30:00' },
    ]);
    expect(d.historico.mudancas_ultimo_reenvio).toEqual([
      { campo: 'saving_reais', antes: 100, depois: 250 },
    ]);

    // Só o que NUNCA existe no banco (texto dos anexos) + v2 ausente.
    expect(ordenado(d.lacunas)).toEqual(ordenado(['texto_anexos', 'v2']));
  });
});

describe('montarDossie — cada fonte ausente vira LACUNA, nunca erro', () => {
  it('documentacao null → presente=false, listas vazias, lacuna "documentacao"', () => {
    const d = montarDossie(fontesCompletas({ documentacao: null }))!;
    expect(d.documentacao.presente).toBe(false);
    expect(d.documentacao.o_que_faz).toBeNull();
    expect(d.documentacao.execucao).toBeNull();
    expect(d.documentacao.fluxo).toEqual([]);
    expect(d.documentacao.dependencias).toEqual([]);
    expect(d.documentacao.atencao).toEqual([]);
    expect(d.documentacao.configurar_antes).toEqual([]);
    expect(d.financeiro.linhas).toEqual([]);
    expect(d.lacunas).toContain('documentacao');
  });

  it('espelho null → triagem toda null e lacuna "espelho"', () => {
    const d = montarDossie(fontesCompletas({ espelho: null }))!;
    expect(d.fonte).toBe('app');
    expect(d.triagem).toEqual({
      status: null,
      estrelas: null,
      classificacao: null,
      motivo_reprovado: null,
      motivo_reenvio: null,
      aprovacao_lider: null,
      justificativa_lider: null,
    });
    expect(d.lacunas).toContain('espelho');
  });

  it('versoes [] → versao 1, 0 reenvios, sem diff, lacuna "versoes"', () => {
    const d = montarDossie(fontesCompletas({ versoes: [] }))!;
    expect(d.submissao.versao).toBe(1);
    expect(d.submissao.reenvios).toBe(0);
    expect(d.historico.versoes).toEqual([]);
    expect(d.historico.mudancas_ultimo_reenvio).toBeNull();
    expect(d.lacunas).toContain('versoes');
  });

  it('cargoAutor undefined (TeamGuide não consultada) → cargo null + lacuna "teamguide"', () => {
    const d = montarDossie(fontesCompletas({ cargoAutor: undefined }))!;
    expect(d.autor.cargo).toBeNull();
    expect(d.lacunas).toContain('teamguide');
  });

  it('cargoAutor null (consultada, pessoa sem cargo) → cargo null e SEM lacuna "teamguide"', () => {
    const d = montarDossie(fontesCompletas({ cargoAutor: null }))!;
    expect(d.autor.cargo).toBeNull();
    expect(d.lacunas).not.toContain('teamguide');
  });
});

describe('montarDossie — campos v2', () => {
  it('v2 presentes no projeto → dossie.v2 preenchido e sem lacuna "v2"', () => {
    const d = montarDossie(
      fontesCompletas({
        projeto: projetoCompleto({
          saving_efetivado_valor_antes: 20000,
          saving_efetivado_valor_agora: 5000,
          saving_efetivado_frequencia: 'mensal',
          saving_efetivado_evidencia: 'Relatório de fechamento do RH',
          custo_evitado_nao_contratado: 0,
          ganho_imensuravel_racional: 'Reduz risco de multa fiscal.',
          custo_rodar_itens: '[]',
        }),
      }),
    )!;
    expect(d.v2).toEqual({
      saving_efetivado_antes: 20000,
      saving_efetivado_agora: 5000,
      saving_efetivado_frequencia: 'mensal',
      saving_efetivado_evidencia: 'Relatório de fechamento do RH',
      custo_evitado_nao_contratado: 0,
      ganho_imensuravel_racional: 'Reduz risco de multa fiscal.',
      custo_rodar_itens: [],
    });
    expect(d.lacunas).not.toContain('v2');
  });

  it('v2 ausentes → dossie.v2 undefined e lacuna "v2"', () => {
    const d = montarDossie(fontesCompletas())!;
    expect(d.v2).toBeUndefined();
    expect(d.lacunas).toContain('v2');
  });
});

describe('montarDossie — JSON malformado NUNCA lança', () => {
  it('tipos_projeto podre → tipos vazio; membros/afetados/itens podres → listas vazias', () => {
    let d: ReturnType<typeof montarDossie> = null;
    expect(() => {
      d = montarDossie(
        fontesCompletas({
          projeto: projetoCompleto({
            tipos_projeto: 'não é json',
            membros: '{quebrado',
            contrafactual_afetados: 'x,y',
            custo_evitado_itens: '[[',
            custo_projeto_itens: 'nada',
            arquivos_links: '{',
          }),
        }),
      );
    }).not.toThrow();
    expect(d).not.toBeNull();
    expect(d!.classificacao.tipos).toEqual([]);
    expect(d!.contexto.membros).toEqual([]);
    expect(d!.contexto.contrafactual_afetados).toEqual([]);
    expect(d!.contexto.anexos_links).toEqual([]);
    expect(d!.financeiro.custo_evitado_itens).toEqual([]);
    expect(d!.financeiro.custo_projeto_itens).toEqual([]);
  });

  it('documentacao "{quebrado" → presente=false + lacuna "documentacao", sem lançar', () => {
    let d: ReturnType<typeof montarDossie> = null;
    expect(() => {
      d = montarDossie(fontesCompletas({ documentacao: '{quebrado' }));
    }).not.toThrow();
    expect(d!.documentacao.presente).toBe(false);
    expect(d!.documentacao.fluxo).toEqual([]);
    expect(d!.lacunas).toContain('documentacao');
  });

  it('snapshot_projeto podre nas versões → não lança (diff cai em null ou vazio)', () => {
    let d: ReturnType<typeof montarDossie> = null;
    expect(() => {
      d = montarDossie(
        fontesCompletas({
          versoes: [
            { versao_num: 1, acao: 'submit_inicial', snapshot_projeto: '{podre', created_at: null },
            { versao_num: 2, acao: 'reenvio', snapshot_projeto: null, created_at: null },
          ],
        }),
      );
    }).not.toThrow();
    expect(d).not.toBeNull();
    expect(d!.submissao.reenvios).toBe(1);
  });
});

describe('montarDossie — mudancas_ultimo_reenvio', () => {
  it('compara as DUAS versões mais recentes por versao_num, independente da ordem de entrada', () => {
    const v = (n: number, saving: number) => ({
      versao_num: n,
      acao: n === 1 ? 'submit_inicial' : 'reenvio',
      snapshot_projeto: JSON.stringify({ nome: 'Mesmo Nome', saving_reais: saving }),
      created_at: `2026-08-0${n} 09:00:00`,
    });
    // Entrada fora de ordem: v1, v3, v2 — o diff tem de ser v2 (100) → v3 (250).
    const d = montarDossie(fontesCompletas({ versoes: [v(1, 7), v(3, 250), v(2, 100)] }))!;
    expect(d.submissao.versao).toBe(3);
    expect(d.submissao.reenvios).toBe(2);
    expect(d.historico.mudancas_ultimo_reenvio).toEqual([
      { campo: 'saving_reais', antes: 100, depois: 250 },
    ]);
  });

  it('com só 1 versão não há reenvio a comparar → null', () => {
    const d = montarDossie(fontesCompletas({ versoes: [versoesDuas()[0]] }))!;
    expect(d.submissao.reenvios).toBe(0);
    expect(d.historico.mudancas_ultimo_reenvio).toBeNull();
  });
});

// ── dossieDaLinhaPlanilha ───────────────────────────────────────────────────

describe('dossieDaLinhaPlanilha', () => {
  // Cabeçalho como está em PROD: "Lider" sem acento, "Area" sem acento (a régua é a
  // de `chaveColuna`: casa por nome exato primeiro, normalizado depois).
  function linhaPlanilha(over: Record<string, string> = {}): Record<string, string> {
    return {
      'ID Projeto': 'LEGADO-233',
      Projeto: 'Bot de Faturamento',
      Area: 'Fiscal',
      'Nome Completo': 'João Conde',
      Email: 'joao.conde@gocase.com',
      Descrição: 'Emite NF automaticamente.',
      'Especial?': 'Sim',
      'Tipos Projeto': 'Saving; Receita + Especial',
      Complexidade: 'Alta',
      Ferramenta: 'n8n',
      Escopo: 'Área',
      'Saving Horas': '120,5',
      'Saving Reais': 'R$ 1.234,56',
      'Receita Mensal': '10.000,00',
      'Ganho Total': '—',
      'Custo Evitado': '',
      'Custo Externo Mensal': '300',
      'Alguém Fazia?': 'nao',
      'Tipo de Saving': 'mensal',
      'Tipo de Receita': 'Recorrente',
      'Memorial de Saving': 'Memorial S',
      'Receita Memorial': 'Memorial R',
      Observações: 'Obs do analisador',
      Status: 'Pendente',
      Estrelas: '8',
      Classificação: 'zona_cinzenta',
      'Motivo Reprovado': '—',
      'Motivo Reenvio': 'Falta a fonte',
      'Aprovação do Lider': 'Pré-pendente',
      'Justificativa Aprovação do Lider': 'Aguardando',
      'Contexto do Projeto Especial': 'Porque sim.',
      URL: 'https://drive.google.com/x, https://drive.google.com/y\nhttps://drive.google.com/z',
      'Data Submissão': '12/05/2026',
      'Atualizado Em': '20/08/2026 10:00',
      'Saving Horas Real': '100',
      'Saving Horas Escalado': '20,5',
      'Justificativa Saving Escalado e Real': 'Justif carga',
      'Alocação Ganhos': 'Menos custo',
      ...over,
    };
  }

  it('mapeia por NOME de coluna, tolerante a acento/caixa, e converte números pt-BR', () => {
    const d = dossieDaLinhaPlanilha(linhaPlanilha())!;
    expect(d).not.toBeNull();
    expect(d.fonte).toBe('planilha');
    expect(d.id).toBe('LEGADO-233');
    expect(d.nome).toBe('Bot de Faturamento');
    expect(d.area).toBe('Fiscal'); // "Area" sem acento casa "Área"
    expect(d.autor.nome).toBe('João Conde');
    expect(d.autor.email).toBe('joao.conde@gocase.com');
    expect(d.autor.cargo).toBeNull();
    expect(d.descricao).toBe('Emite NF automaticamente.');

    expect(d.classificacao.especial).toBe(true);
    expect(d.classificacao.tipos).toEqual(['Saving', 'Receita', 'Especial']);
    expect(d.classificacao.complexidade).toBe('Alta');
    expect(d.classificacao.ferramenta).toBe('n8n');
    expect(d.classificacao.escopo).toBe('Área');

    expect(d.financeiro.saving_horas).toBe(120.5);
    expect(d.financeiro.saving_reais).toBe(1234.56); // "R$ 1.234,56"
    expect(d.financeiro.receita_mensal).toBe(10000);
    expect(d.financeiro.ganho_total_mensal).toBeNull(); // "—"
    expect(d.financeiro.custo_evitado_reais).toBeNull(); // vazio
    expect(d.financeiro.custo_externo_mensal).toBe(300);
    expect(d.financeiro.alguem_fazia).toBe('nao');
    expect(d.financeiro.tipo_saving).toBe('mensal');
    expect(d.financeiro.tipo_receita).toBe('Recorrente');
    expect(d.financeiro.memorial_saving).toBe('Memorial S');
    expect(d.financeiro.memorial_receita).toBe('Memorial R');
    expect(d.financeiro.observacoes_analisador).toBe('Obs do analisador');
    expect(d.financeiro.horas_carga_real).toBe(100);
    expect(d.financeiro.horas_escala).toBe(20.5);
    expect(d.financeiro.justificativa_carga_escala).toBe('Justif carga');
    expect(d.financeiro.alocacao_ganhos).toBe('Menos custo');
    expect(d.financeiro.linhas).toEqual([]);

    expect(d.triagem.status).toBe('Pendente');
    expect(d.triagem.estrelas).toBe(8);
    expect(d.triagem.classificacao).toBe('zona_cinzenta');
    expect(d.triagem.motivo_reprovado).toBeNull(); // "—" → null em texto
    expect(d.triagem.motivo_reenvio).toBe('Falta a fonte');
    expect(d.triagem.aprovacao_lider).toBe('Pré-pendente'); // "…do Lider" sem acento
    expect(d.triagem.justificativa_lider).toBe('Aguardando');

    expect(d.contexto.contexto_especial).toBe('Porque sim.');
    expect(d.contexto.anexos_links).toEqual([
      'https://drive.google.com/x',
      'https://drive.google.com/y',
      'https://drive.google.com/z',
    ]);
    expect(d.contexto.contrafactual_afetados).toEqual([]);
    expect(d.contexto.membros).toEqual([]);

    expect(d.submissao.data).toBe('12/05/2026');
    expect(d.submissao.atualizado_em).toBe('20/08/2026 10:00');
    expect(d.submissao.versao).toBe(1);
    expect(d.submissao.reenvios).toBe(0);
    expect(d.submissao.descontinuado).toBe(false);

    expect(d.documentacao.presente).toBe(false);
    expect(d.v2).toBeUndefined();
    expect(d.historico.versoes).toEqual([]);
    expect(d.historico.mudancas_ultimo_reenvio).toBeNull();
    expect(d.historico.eventos).toEqual([]);

    expect(ordenado(d.lacunas)).toEqual(
      ordenado(['documentacao', 'versoes', 'texto_anexos', 'v2', 'teamguide']),
    );
  });

  it('"Especial?" Não/vazio → false; Estrelas vazio → null, "0" → 0', () => {
    const nao = dossieDaLinhaPlanilha(linhaPlanilha({ 'Especial?': 'Não', Estrelas: '' }))!;
    expect(nao.classificacao.especial).toBe(false);
    expect(nao.triagem.estrelas).toBeNull();

    const vazio = dossieDaLinhaPlanilha(linhaPlanilha({ 'Especial?': '', Estrelas: '0' }))!;
    expect(vazio.classificacao.especial).toBe(false);
    expect(vazio.triagem.estrelas).toBe(0);
  });

  it('Status com "descontinuad" (qualquer caixa) → descontinuado=true', () => {
    expect(dossieDaLinhaPlanilha(linhaPlanilha({ Status: 'Descontinuado' }))!.submissao.descontinuado).toBe(true);
    expect(dossieDaLinhaPlanilha(linhaPlanilha({ Status: 'DESCONTINUADA' }))!.submissao.descontinuado).toBe(true);
    expect(dossieDaLinhaPlanilha(linhaPlanilha({ Status: 'Aprovado' }))!.submissao.descontinuado).toBe(false);
  });

  it('sem "ID Projeto" → null', () => {
    const row = linhaPlanilha();
    delete row['ID Projeto'];
    expect(dossieDaLinhaPlanilha(row)).toBeNull();
    expect(dossieDaLinhaPlanilha(linhaPlanilha({ 'ID Projeto': '' }))).toBeNull();
  });
});

// ── dossieParaTexto ─────────────────────────────────────────────────────────

describe('dossieParaTexto', () => {
  const TITULOS = [
    '## Identificação',
    '## Descrição',
    '## Documentação',
    '## Financeiro',
    '## Triagem',
    '## Histórico',
    '## Fontes ausentes',
  ];

  it('traz todas as seções e, sem comReais, esconde R$, os valores e o memorial de saving', () => {
    const d = montarDossie(fontesCompletas())!;
    const txt = dossieParaTexto(d);
    for (const t of TITULOS) expect(txt).toContain(t);

    expect(txt).not.toContain('R$');
    // saving_reais=8844 e ganho_total_mensal=7321 não podem aparecer em forma alguma.
    expect(txt).not.toMatch(/8[.,]?844/);
    expect(txt).not.toMatch(/7[.,]?321/);
    // O memorial de saving traz R$ → sai e entra a marca de omissão.
    expect(txt).not.toContain(MEMORIAL_SAVING_MARCADOR);
    expect(txt).toContain('[memorial com valores omitidos]');
    expect(txt).not.toContain('chat_messages');

    // Mesmo comportamento com comReais explícito em false.
    const txtFalse = dossieParaTexto(d, { comReais: false });
    expect(txtFalse).not.toContain('R$');
    expect(txtFalse).not.toContain(MEMORIAL_SAVING_MARCADOR);
  });

  it('com comReais:true mostra saving_reais formatado e o memorial de saving', () => {
    const d = montarDossie(fontesCompletas())!;
    const txt = dossieParaTexto(d, { comReais: true });
    for (const t of TITULOS) expect(txt).toContain(t);
    expect(txt).toMatch(/8[.,]?844/);
    expect(txt).toContain(MEMORIAL_SAVING_MARCADOR);
    expect(txt).not.toContain('[memorial com valores omitidos]');
    expect(txt).not.toContain('chat_messages');
  });

  it('a última seção lista as lacunas por extenso', () => {
    const d = montarDossie(fontesCompletas({ documentacao: null, espelho: null, cargoAutor: undefined }))!;
    const txt = dossieParaTexto(d);
    const idx = txt.indexOf('## Fontes ausentes');
    expect(idx).toBeGreaterThan(-1);
    const cauda = txt.slice(idx);
    // É a ÚLTIMA seção: nenhum outro título depois dela.
    expect(cauda.indexOf('## ', 3)).toBe(-1);
    for (const l of d.lacunas) expect(cauda).toContain(l);
    expect(cauda).toContain('documentacao');
    expect(cauda).toContain('espelho');
    expect(cauda).toContain('teamguide');
  });

  it('dossiê da planilha também serializa com todas as seções e sem R$', () => {
    const d = dossieDaLinhaPlanilha({
      'ID Projeto': 'P1',
      Projeto: 'X',
      'Saving Reais': 'R$ 9.876,00',
      'Memorial de Saving': 'R$ 9.876,00 MARCA_PLANILHA',
    })!;
    const txt = dossieParaTexto(d);
    for (const t of TITULOS) expect(txt).toContain(t);
    expect(txt).not.toContain('R$');
    expect(txt).not.toMatch(/9[.,]?876/);
    expect(txt).not.toContain('MARCA_PLANILHA');
  });
});

// ── resumoDossie ────────────────────────────────────────────────────────────

describe('resumoDossie', () => {
  it('chars = tamanho do texto, seções presentes e lacunas espelham o dossiê', () => {
    const d = montarDossie(fontesCompletas())!;
    const r = resumoDossie(d);
    expect(r.chars).toBe(dossieParaTexto(d).length);
    expect(r.secoes_presentes).toContain('documentacao');
    expect(r.secoes_presentes).toContain('financeiro');
    expect(r.secoes_presentes).toContain('triagem');
    expect(r.lacunas).toEqual(d.lacunas);
  });

  it('documentação ausente NÃO conta como seção presente', () => {
    const d = montarDossie(fontesCompletas({ documentacao: null }))!;
    const r = resumoDossie(d);
    expect(r.secoes_presentes).not.toContain('documentacao');
    expect(r.lacunas).toContain('documentacao');
    expect(r.chars).toBe(dossieParaTexto(d).length);
  });
});
