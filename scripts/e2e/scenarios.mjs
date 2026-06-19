// Matriz de cenários E2E. Cada cenário descreve uma submissão completa e o
// `expected` (colunas determinísticas) calculado de forma INDEPENDENTE do backend.
//
// expected.hard → asserts que FALHAM o teste se divergirem.
// expected.soft → comparados e reportados, mas não falham (rótulos ambíguos:
//                 capitalização de tipo, label Mensal/Pontual, etc.).
// O "Ganho Total" não entra aqui — o validador compara sheet × valor retornado
// pela API (submeter-validacao), pois a fórmula tem ambiguidade documentada.
import { valorHora, round2 } from './lib/cargos.mjs';

// Calcula os valores determinísticos do saving a partir da config do formulário.
function calcSaving({ linhas = [], custo_externo_mensal = 0, custo_evitado_itens = [] }) {
  const horas = round2(linhas.reduce((s, l) => s + Math.max(0, l.horas_antes - l.horas_depois), 0));
  const horasReais = round2(
    linhas.reduce((s, l) => s + Math.max(0, l.horas_antes - l.horas_depois) * valorHora(l.cargo), 0),
  );
  const custoEvitadoMensal = round2(
    custo_evitado_itens.reduce((s, it) => s + (it.recorrencia === 'pontual' ? it.valor / 12 : it.valor), 0),
  );
  const savingReais = round2(horasReais + custoEvitadoMensal - custo_externo_mensal);
  // Rótulo da recorrência do custo evitado (col S).
  let recorrLabel = '—';
  if (custo_evitado_itens.length > 0) {
    const recs = new Set(custo_evitado_itens.map((i) => i.recorrencia));
    recorrLabel = recs.size > 1 ? 'Misto' : recs.has('pontual') ? 'Pontual' : 'Mensal';
  }
  return { horas, horasReais, custoEvitadoMensal, savingReais, recorrLabel };
}

const DOC_BASE = (titulo, corpo) => `# ${titulo}

## O que faz
${corpo.oque}

## Como executa / fluxo
${corpo.fluxo}

## Dependências
${corpo.deps}

## O que configurar antes
${corpo.config}

## Pontos de atenção
${corpo.atencao}
`;

// ─── Definição dos cenários ──────────────────────────────────────────────────
// Função: recebe o runId para compor nomes únicos; devolve a lista.
export function buildScenarios(runId) {
  const tag = (t) => `[E2E-${runId}] ${t}`;

  const metaPadrao = {
    ferramenta: 'n8n',
    escopo: 'interno',
    membros: [],
    data_criacao: '2026-06-10',
  };

  const cenarios = [];

  // 1) Saving puro mensal — 1 cargo, sem custo evitado, sem externo.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 8 }],
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'saving-puro',
      nome: tag('Conciliação bancária automática'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Automação da conciliação bancária diária do financeiro.' },
      doc: DOC_BASE('Conciliação Bancária Automática', {
        oque: 'Concilia automaticamente os extratos bancários com os lançamentos do ERP todos os dias.',
        fluxo: 'Workflow n8n baixa o extrato OFX, casa por valor/data com o ERP e gera relatório de divergências.',
        deps: 'n8n, API do banco, API do ERP Omie.',
        config: 'Credenciais do banco e do ERP no n8n; agendamento diário às 6h.',
        atencao: 'Divergências acima de R$50 são marcadas para revisão manual.',
      }),
      briefing: `Projeto: automação da conciliação bancária diária, feita no n8n. Determinístico, sem IA.
Antes: 1 Analista Pleno gastava 40h/mês conciliando extratos manualmente no Excel.
Depois: 8h/mês só revisando divergências. O processo já era feito por essa pessoa (alguém fazia = sim).
Não há ferramenta paga que deixou de ser usada. Não há custo de ferramenta nova.`,
      saving,
      expected: {
        hard: {
          'Email': null, 'Nome Completo': null, 'Saving Horas': c.horas,
          'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal', 'Tipos Projeto': 'saving', 'Alguém Fazia?': 'sim', 'Ferramenta': 'n8n' },
      },
    });
  }

  // 2) Saving + custo evitado MENSAL (entra cheio).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Assistente', horas_antes: 20, horas_depois: 4 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Zapier Professional', valor: 240, recorrencia: 'mensal', justificativa: 'Plano mensal que deixou de ser pago após migrar para n8n interno.' },
      ],
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'saving-custo-evitado-mensal',
      nome: tag('Disparo de NF-e por automação'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Emissão e disparo automático de notas fiscais.' },
      doc: DOC_BASE('Disparo de NF-e', {
        oque: 'Emite e envia notas fiscais automaticamente a partir dos pedidos aprovados.',
        fluxo: 'n8n consome a fila de pedidos, chama a API da SEFAZ e envia o PDF por e-mail.',
        deps: 'n8n, API SEFAZ, SMTP.',
        config: 'Certificado A1 e credenciais no n8n.',
        atencao: 'Rejeições da SEFAZ entram em fila de retry.',
      }),
      briefing: `Projeto: emissão automática de NF-e no n8n. Determinístico, sem IA.
Antes: 1 Assistente gastava 20h/mês emitindo notas manualmente; agora 4h/mês.
Alguém já fazia = sim. Antes usávamos o Zapier Professional (R$240/mês) para parte do processo,
que foi CANCELADO após migrar para o n8n — esse é um custo evitado MENSAL de R$240.
Não há custo de ferramenta nova incorrido.`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel, 'Tipo de Saving': 'mensal' },
      },
    });
  }

  // 3) Saving + custo evitado PONTUAL (mensalizado ÷12).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Júnior', horas_antes: 30, horas_depois: 10 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Licença anual de RPA legado', valor: 6000, recorrencia: 'pontual', justificativa: 'Licença anual de R$6000 que deixou de ser renovada.' },
      ],
    };
    const c = calcSaving(saving); // custoEvitadoMensal = 6000/12 = 500
    cenarios.push({
      key: 'saving-custo-evitado-pontual',
      nome: tag('Extração de dados de portais'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Coleta automática de dados em portais governamentais.' },
      doc: DOC_BASE('Extração de Portais', {
        oque: 'Coleta dados de portais públicos e consolida numa planilha.',
        fluxo: 'n8n autentica, navega e extrai os dados agendado semanalmente.',
        deps: 'n8n, credenciais dos portais.',
        config: 'Logins dos portais no cofre do n8n.',
        atencao: 'Captcha em alguns portais exige fallback manual.',
      }),
      briefing: `Projeto: extração de dados de portais no n8n. Determinístico.
Antes: 1 Analista Júnior gastava 30h/mês; agora 10h/mês. Alguém já fazia = sim.
Antes pagávamos uma LICENÇA ANUAL de uma ferramenta de RPA legada de R$6000 (pagamento PONTUAL anual),
que deixou de ser renovada — custo evitado pontual de R$6000. Sem custo novo de ferramenta.`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel },
      },
    });
  }

  // 4) Saving + custo externo (subtrai).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 50, horas_depois: 10 }],
      custo_externo_mensal: 300,
    };
    const c = calcSaving(saving); // savingReais = horasReais - 300
    cenarios.push({
      key: 'saving-custo-externo',
      nome: tag('Classificação de tickets com API paga'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Triagem automática de tickets de suporte.' },
      doc: DOC_BASE('Triagem de Tickets', {
        oque: 'Classifica e roteia tickets de suporte automaticamente.',
        fluxo: 'Script Python lê a fila, classifica por regras e roteia ao time correto.',
        deps: 'Python, API do helpdesk, serviço externo de enriquecimento (pago).',
        config: 'Tokens de API no .env.',
        atencao: 'O serviço externo de enriquecimento custa R$300/mês.',
      }),
      briefing: `Projeto: triagem automática de tickets em Python. Determinístico.
Antes: 1 Analista Pleno gastava 50h/mês triando; agora 10h/mês. Alguém já fazia = sim.
A automação INCORRE num custo externo NOVO de R$300/mês (serviço de enriquecimento pago) — isso SUBTRAI do saving.
Não há custo evitado (nada deixou de ser pago).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Externo Mensal': 300, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal' },
      },
    });
  }

  // 5) Saving multi-cargo.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [
        { cargo: 'Supervisor', horas_antes: 12, horas_depois: 2 },
        { cargo: 'Assistente', horas_antes: 60, horas_depois: 20 },
      ],
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'saving-multicargo',
      nome: tag('Fechamento de folha assistido'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Automação de etapas do fechamento de folha.' },
      doc: DOC_BASE('Fechamento de Folha', {
        oque: 'Automatiza coleta e validação de dados para o fechamento da folha.',
        fluxo: 'n8n agrega ponto, benefícios e variáveis e gera o arquivo de importação.',
        deps: 'n8n, sistema de ponto, ERP de RH.',
        config: 'Integrações configuradas no n8n.',
        atencao: 'Exceções de ponto ainda exigem revisão do Supervisor.',
      }),
      briefing: `Projeto: automação do fechamento de folha no n8n. Determinístico.
Antes: 1 Supervisor gastava 12h/mês (agora 2h) e 1 Assistente 60h/mês (agora 20h). Alguém já fazia = sim.
Sem custo evitado e sem custo externo.`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Saving Reais': c.savingReais, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal' },
      },
    });
  }

  // 6) Receita pura mensal.
  {
    const receita = { tipo_saving: 'mensal', valor_ganho_mensal: 8000, racional: '80 vendas adicionais/mês a R$100 de margem.' };
    cenarios.push({
      key: 'receita-pura',
      nome: tag('Recuperação de carrinhos abandonados'),
      tipos_projeto: ['receita_incremental'],
      meta: { ...metaPadrao, descricao_breve: 'Recuperação automática de carrinhos abandonados.' },
      doc: DOC_BASE('Carrinhos Abandonados', {
        oque: 'Dispara fluxos de recuperação para carrinhos abandonados.',
        fluxo: 'n8n detecta abandono, envia e-mail/WhatsApp com cupom e acompanha conversão.',
        deps: 'n8n, plataforma de e-commerce, gateway de mensageria.',
        config: 'Templates e regras de cupom no n8n.',
        atencao: 'Limite de 1 cupom por cliente/semana.',
      }),
      briefing: `Projeto: recuperação de carrinhos abandonados no n8n. Determinístico.
Gera RECEITA INCREMENTAL: cerca de 80 vendas recuperadas por mês, com margem média de R$100 cada → R$8000/mês de receita incremental recorrente (mensal).
Não há economia de horas (ninguém fazia isso antes manualmente de forma relevante).`,
      receita,
      expected: {
        hard: { 'Receita Mensal': receita.valor_ganho_mensal, 'Status': 'Pendente', 'Especial?': 'Não' },
        soft: { 'Tipo de Receita': 'mensal', 'Tipos Projeto': 'receita_incremental' },
      },
    });
  }

  // 7) Receita pontual (valor cheio na col X).
  {
    const receita = { tipo_saving: 'pontual', valor_ganho_mensal: 24000, racional: 'Campanha única que gerou R$24000 de receita adicional.' };
    cenarios.push({
      key: 'receita-pontual',
      nome: tag('Campanha sazonal automatizada'),
      tipos_projeto: ['receita_incremental'],
      meta: { ...metaPadrao, descricao_breve: 'Automação de campanha sazonal pontual.' },
      doc: DOC_BASE('Campanha Sazonal', {
        oque: 'Orquestra uma campanha sazonal de ponta a ponta.',
        fluxo: 'n8n segmenta a base, dispara a campanha e consolida resultados.',
        deps: 'n8n, CRM, mensageria.',
        config: 'Segmentos e criativos no n8n.',
        atencao: 'Janela de envio limitada ao período da campanha.',
      }),
      briefing: `Projeto: campanha sazonal automatizada no n8n. Determinístico.
Gera RECEITA INCREMENTAL PONTUAL: uma campanha única que trouxe R$24000 de receita adicional (evento pontual, não recorrente).
Sem economia de horas relevante.`,
      receita,
      expected: {
        hard: { 'Receita Mensal': receita.valor_ganho_mensal, 'Status': 'Pendente', 'Especial?': 'Não' },
        soft: { 'Tipo de Receita': 'pontual' },
      },
    });
  }

  // 8) Saving + receita combinado.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Sênior', horas_antes: 24, horas_depois: 4 }],
    };
    const receita = { tipo_saving: 'mensal', valor_ganho_mensal: 5000, racional: '50 upsells/mês a R$100.' };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'saving-mais-receita',
      nome: tag('Reativação de clientes inativos'),
      tipos_projeto: ['saving', 'receita_incremental'],
      meta: { ...metaPadrao, descricao_breve: 'Reativação automática de clientes inativos.' },
      doc: DOC_BASE('Reativação de Clientes', {
        oque: 'Identifica clientes inativos e dispara fluxos de reativação.',
        fluxo: 'n8n segmenta inativos, dispara ofertas e acompanha retorno.',
        deps: 'n8n, CRM, mensageria.',
        config: 'Regras de inatividade no n8n.',
        atencao: 'Respeitar opt-out.',
      }),
      briefing: `Projeto: reativação de clientes inativos no n8n. Determinístico.
SAVING: 1 Analista Sênior gastava 24h/mês montando listas e disparos manuais; agora 4h/mês. Alguém já fazia = sim. Sem custo evitado/externo.
RECEITA: gera R$5000/mês de receita incremental recorrente (50 reativações com margem R$100).`,
      saving,
      receita,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Receita Mensal': receita.valor_ganho_mensal, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal', 'Tipo de Receita': 'mensal', 'Tipos Projeto': 'saving, receita_incremental' },
      },
    });
  }

  // 9) Projeto especial (pula saving/receita).
  {
    cenarios.push({
      key: 'especial',
      nome: tag('Plataforma interna de decisão de risco'),
      tipos_projeto: ['saving'],
      especial: true,
      contexto_especial:
        'Plataforma interna que centraliza a decisão de risco de crédito de toda a operação. ' +
        'Impacto altíssimo e difícil de mensurar em horas ou receita direta: reduz inadimplência, ' +
        'acelera aprovações e vira base para vários outros produtos. Precisa de validação humana.',
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Plataforma de decisão de risco de crédito.' },
      doc: DOC_BASE('Plataforma de Risco', {
        oque: 'Centraliza a política de risco e expõe decisões via API.',
        fluxo: 'Serviço Python recebe a solicitação, aplica a política e responde a decisão.',
        deps: 'Python, base de crédito, data warehouse.',
        config: 'Políticas versionadas no repositório.',
        atencao: 'Mudanças de política exigem aprovação do comitê.',
      }),
      briefing: `Projeto especial de altíssimo impacto, difícil de mensurar. Não há saving/receita a coletar — é só documentação e validação humana.`,
      expected: {
        hard: { 'Status': 'Pendente', 'Especial?': 'Sim' },
        soft: { 'Contexto do Projeto Especial': '(preenchido)' },
      },
    });
  }

  // 10) Edição: reabre o cenário 1 e altera as horas.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 4 }], // antes era 8 → agora 4
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'edicao-saving-puro',
      edicaoDe: 'saving-puro', // reusa o projeto criado no cenário 1
      tipos_projeto: ['saving'],
      briefing: `Mesma conciliação bancária do cenário 1, agora com ganho maior: o Analista Pleno caiu de 40h para 4h/mês (antes era 8h). Alguém já fazia = sim.`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Memorial anterior': '(preenchido na edição)' },
      },
    });
  }

  return cenarios;
}
