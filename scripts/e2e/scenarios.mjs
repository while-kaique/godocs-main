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

  // ── Grupo A (cont.) — cartesiano financeiro: custo evitado × custo externo ──

  // A4) Saving + custo evitado MISTO (mensal + pontual juntos → label "Misto").
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 8 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Plano mensal de integração', valor: 200, recorrencia: 'mensal', justificativa: 'Mensalidade de SaaS de integração cancelada após o n8n interno.' },
        { nome: 'Licença anual de conector', valor: 3600, recorrencia: 'pontual', justificativa: 'Licença anual de conector que deixou de ser renovada (pagamento pontual anual).' },
      ],
    };
    const c = calcSaving(saving); // 200 + 3600/12 = 500
    cenarios.push({
      key: 'saving-custo-evitado-misto',
      nome: tag('Integração de pedidos multi-canal'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Consolidação automática de pedidos de vários canais.' },
      doc: DOC_BASE('Integração de Pedidos', {
        oque: 'Consolida pedidos de marketplace, site e atacado num só fluxo.',
        fluxo: 'n8n coleta de cada canal, normaliza e grava no ERP.',
        deps: 'n8n, APIs dos canais, ERP.',
        config: 'Credenciais dos canais no n8n.',
        atencao: 'Conflitos de SKU vão para revisão.',
      }),
      briefing: `Projeto: integração de pedidos multi-canal no n8n. Determinístico, sem IA.
Antes: 1 Analista Pleno gastava 40h/mês consolidando pedidos manualmente; agora 8h/mês. Alguém já fazia = sim.
Custos evitados (DOIS itens): (1) um plano MENSAL de integração de R$200/mês que foi cancelado; (2) uma LICENÇA ANUAL de conector de R$3600 (pagamento pontual anual) que deixou de ser renovada.
Não há custo externo novo.`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel }, // "Misto"
      },
    });
  }

  // A6) Saving + custo evitado MENSAL + custo externo (soma evitado, subtrai externo).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 50, horas_depois: 10 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Ferramenta mensal de RPA', valor: 240, recorrencia: 'mensal', justificativa: 'Mensalidade de RPA cancelada após migrar para o fluxo interno.' },
      ],
      custo_externo_mensal: 300,
    };
    const c = calcSaving(saving); // horasReais + 240 - 300
    cenarios.push({
      key: 'saving-ce-mensal-cx',
      nome: tag('Sincronização de estoque com API paga'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Sincronização automática de estoque entre sistemas.' },
      doc: DOC_BASE('Sincronização de Estoque', {
        oque: 'Mantém o estoque sincronizado entre ERP e marketplaces.',
        fluxo: 'n8n lê o ERP, aplica regras e atualiza os canais via API.',
        deps: 'n8n, ERP, APIs dos marketplaces (uma delas paga).',
        config: 'Tokens no n8n.',
        atencao: 'Uma das APIs de marketplace custa R$300/mês.',
      }),
      briefing: `Projeto: sincronização de estoque no n8n. Determinístico, sem IA.
Antes: 1 Analista Pleno gastava 50h/mês; agora 10h/mês. Alguém já fazia = sim.
Custo evitado MENSAL: uma ferramenta de RPA de R$240/mês foi cancelada (soma ao saving).
Custo externo NOVO: uma API de marketplace paga custa R$300/mês (subtrai do saving).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Custo Externo Mensal': 300,
          'Saving Reais': c.savingReais, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel },
      },
    });
  }

  // A7) Saving + custo evitado PONTUAL (÷12) + custo externo.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Júnior', horas_antes: 30, horas_depois: 10 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Licença anual de scraper', valor: 6000, recorrencia: 'pontual', justificativa: 'Licença anual de R$6000 que deixou de ser renovada.' },
      ],
      custo_externo_mensal: 300,
    };
    const c = calcSaving(saving); // horasReais + 6000/12 - 300 = horasReais + 500 - 300
    cenarios.push({
      key: 'saving-ce-pontual-cx',
      nome: tag('Coleta de preços com proxy pago'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Coleta automática de preços de concorrentes.' },
      doc: DOC_BASE('Coleta de Preços', {
        oque: 'Coleta preços de concorrentes diariamente.',
        fluxo: 'Script Python navega e extrai preços via proxy.',
        deps: 'Python, serviço de proxy (pago).',
        config: 'Credenciais do proxy no .env.',
        atencao: 'O serviço de proxy custa R$300/mês.',
      }),
      briefing: `Projeto: coleta de preços em Python. Determinístico, sem IA.
Antes: 1 Analista Júnior gastava 30h/mês; agora 10h/mês. Alguém já fazia = sim.
Custo evitado PONTUAL: uma licença anual de scraper de R$6000 (pagamento pontual anual) deixou de ser renovada.
Custo externo NOVO: serviço de proxy de R$300/mês (subtrai do saving).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Custo Externo Mensal': 300,
          'Saving Reais': c.savingReais, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel },
      },
    });
  }

  // A8) Saving + custo evitado MISTO + custo externo (todas as parcelas juntas).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Assistente', horas_antes: 20, horas_depois: 4 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'SaaS mensal de formulários', valor: 120, recorrencia: 'mensal', justificativa: 'Mensalidade de SaaS cancelada.' },
        { nome: 'Pacote anual de créditos', valor: 1200, recorrencia: 'pontual', justificativa: 'Pacote anual de créditos que não foi renovado.' },
      ],
      custo_externo_mensal: 150,
    };
    const c = calcSaving(saving); // (120 + 1200/12) - 150 = (120+100) - 150
    cenarios.push({
      key: 'saving-ce-misto-cx',
      nome: tag('Onboarding digital de fornecedores'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Automação do cadastro e validação de fornecedores.' },
      doc: DOC_BASE('Onboarding de Fornecedores', {
        oque: 'Cadastra e valida fornecedores automaticamente.',
        fluxo: 'n8n recebe o formulário, valida documentos e cria no ERP.',
        deps: 'n8n, ERP, serviço de validação (pago).',
        config: 'Credenciais no n8n.',
        atencao: 'O serviço de validação custa R$150/mês.',
      }),
      briefing: `Projeto: onboarding de fornecedores no n8n. Determinístico, sem IA.
Antes: 1 Assistente gastava 20h/mês; agora 4h/mês. Alguém já fazia = sim.
Custos evitados (MISTO): (1) SaaS MENSAL de formulários R$120/mês cancelado; (2) pacote ANUAL de créditos R$1200 (pontual) não renovado.
Custo externo NOVO: serviço de validação R$150/mês (subtrai).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais,
          'Custo Evitado': c.custoEvitadoMensal, 'Custo Externo Mensal': 150,
          'Saving Reais': c.savingReais, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Custo Mensal ou Pontual': c.recorrLabel }, // "Misto"
      },
    });
  }

  // ── Grupo C (cont.) ──

  // C2) Saving + custo evitado + RECEITA PONTUAL (receita cheia na col X).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Sênior', horas_antes: 24, horas_depois: 4 }],
      tem_custo_evitado: 'sim',
      custo_evitado_itens: [
        { nome: 'Consultoria mensal', valor: 300, recorrencia: 'mensal', justificativa: 'Consultoria mensal dispensada após a automação.' },
      ],
    };
    const receita = { tipo_saving: 'pontual', valor_ganho_mensal: 18000, racional: 'Recuperação pontual de R$18000 numa ação única.' };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'saving-receita-pontual',
      nome: tag('Recuperação fiscal automatizada'),
      tipos_projeto: ['saving', 'receita_incremental'],
      meta: { ...metaPadrao, descricao_breve: 'Automação da recuperação de créditos fiscais.' },
      doc: DOC_BASE('Recuperação Fiscal', {
        oque: 'Identifica e processa créditos fiscais recuperáveis.',
        fluxo: 'n8n cruza notas, identifica créditos e gera os pedidos.',
        deps: 'n8n, base fiscal, ERP.',
        config: 'Regras fiscais no n8n.',
        atencao: 'Casos ambíguos vão para o contador.',
      }),
      briefing: `Projeto: recuperação fiscal no n8n. Determinístico, sem IA.
SAVING: 1 Analista Sênior gastava 24h/mês; agora 4h/mês. Alguém já fazia = sim. Custo evitado MENSAL: consultoria de R$300/mês dispensada.
RECEITA INCREMENTAL PONTUAL: a ação recuperou R$18000 uma única vez (evento pontual, não recorrente).`,
      saving,
      receita,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Custo Evitado': c.custoEvitadoMensal,
          'Saving Reais': c.savingReais, 'Receita Mensal': receita.valor_ganho_mensal,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Receita': 'pontual', 'Tipos Projeto': 'saving, receita_incremental' },
      },
    });
  }

  // ── Grupo D — complexidade (classificação do analisador) ────────────────────
  // O nível exato é julgamento do LLM; o gate (IA Sim/Não) garante o piso.

  // D1) inteligencia — saving onde a IA CLASSIFICA na execução.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 8 }],
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'complexidade-inteligencia',
      nome: tag('Triagem inteligente de e-mails'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Classificação automática de e-mails por IA.' },
      doc: DOC_BASE('Triagem de E-mails', {
        oque: 'Lê os e-mails da caixa compartilhada e CLASSIFICA cada um por assunto usando IA, roteando ao time certo.',
        fluxo: 'Script Python puxa os e-mails e, para cada um, chama o LLM (Claude) que classifica o assunto; o roteamento segue a classificação.',
        deps: 'Python, API de e-mail, LLM (Claude).',
        config: 'Chaves de API no .env.',
        atencao: 'A IA classifica; o humano só confere casos de baixa confiança.',
      }),
      briefing: `Projeto: triagem de e-mails em Python. A AUTOMAÇÃO USA IA NA EXECUÇÃO: para cada e-mail, um LLM (Claude) CLASSIFICA o assunto e isso decide o roteamento. A IA é uma funcionalidade do projeto (classifica/gera).
SAVING: 1 Analista Pleno gastava 40h/mês triando manualmente; agora 8h/mês. Alguém já fazia = sim. Sem custo evitado/externo.
Quando o agente perguntar se a automação usa IA em algum passo, a resposta é SIM (a IA classifica os e-mails).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal' },
      },
    });
  }

  // D2) autonomia — agente que recebe a tarefa, DECIDE e resolve sozinho.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 6 }],
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'complexidade-autonomia',
      nome: tag('Atendente autônomo de suporte N1'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Agente que resolve chamados de suporte sozinho.' },
      doc: DOC_BASE('Atendente Autônomo N1', {
        oque: 'Recebe o chamado de suporte, DECIDE a solução e responde o cliente sozinho, de ponta a ponta, sem humano no loop.',
        fluxo: 'O agente lê o chamado, consulta a base, decide a ação (responder, escalar, executar) e age sozinho; só escala o que foge da alçada.',
        deps: 'Python, LLM (Claude) com ferramentas, base de conhecimento, API do helpdesk.',
        config: 'Ferramentas e políticas do agente versionadas no repo.',
        atencao: 'O agente age autonomamente; auditoria amostral semanal.',
      }),
      briefing: `Projeto: atendente autônomo de suporte N1. É um AGENTE AUTÔNOMO: recebe o chamado, DECIDE a solução e RESOLVE sozinho, de ponta a ponta, sem humano conduzindo. Usa IA (Claude) para decidir e agir.
SAVING: 1 Analista Pleno gastava 40h/mês com N1; agora 6h/mês (só auditoria). Alguém já fazia = sim. Sem custo evitado/externo.
Quando o agente perguntar se usa IA, a resposta é SIM (a IA decide e age sozinha).`,
      saving,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal' },
      },
    });
  }

  // D3) inteligencia × receita — IA GERA conteúdo para aumentar conversão.
  {
    const receita = { tipo_saving: 'mensal', valor_ganho_mensal: 6000, racional: '60 conversões adicionais/mês a R$100 de margem.' };
    cenarios.push({
      key: 'complexidade-inteligencia-receita',
      nome: tag('Geração de descrições de produto por IA'),
      tipos_projeto: ['receita_incremental'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Geração automática de descrições de produto por IA.' },
      doc: DOC_BASE('Descrições por IA', {
        oque: 'GERA descrições de produto otimizadas por IA para aumentar a conversão da loja.',
        fluxo: 'Para cada produto sem descrição, o LLM (Claude) gera o texto otimizado e publica.',
        deps: 'Python, LLM (Claude), API da loja.',
        config: 'Chaves de API e tom de voz no repo.',
        atencao: 'Revisão por amostragem do time de conteúdo.',
      }),
      briefing: `Projeto: geração de descrições de produto. A AUTOMAÇÃO USA IA COMO FUNCIONALIDADE: um LLM (Claude) GERA as descrições otimizadas (a IA gera conteúdo).
RECEITA INCREMENTAL: as descrições otimizadas geram ~60 conversões adicionais/mês com margem R$100 → R$6000/mês recorrente.
Sem economia de horas relevante. Quando perguntado se usa IA, a resposta é SIM (a IA gera as descrições).`,
      receita,
      expected: {
        hard: { 'Receita Mensal': receita.valor_ganho_mensal, 'Status': 'Pendente', 'Especial?': 'Não' },
        soft: { 'Tipo de Receita': 'mensal', 'Tipos Projeto': 'receita_incremental' },
      },
    });
  }

  // D4) autonomia × saving+receita — agente autônomo de outbound.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Sênior', horas_antes: 20, horas_depois: 4 }],
    };
    const receita = { tipo_saving: 'mensal', valor_ganho_mensal: 4000, racional: '40 agendamentos/mês a R$100 de margem.' };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'complexidade-autonomia-savrec',
      nome: tag('Agente autônomo de prospecção'),
      tipos_projeto: ['saving', 'receita_incremental'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Agente que prospecta e agenda reuniões sozinho.' },
      doc: DOC_BASE('Prospecção Autônoma', {
        oque: 'Agente autônomo que prospecta leads, DECIDE a abordagem e agenda reuniões sozinho, de ponta a ponta.',
        fluxo: 'O agente seleciona leads, decide a mensagem, conversa e agenda sem intervenção humana.',
        deps: 'Python, LLM (Claude) com ferramentas, CRM, calendário.',
        config: 'Políticas e ICP no repo.',
        atencao: 'Agente age sozinho; SDR só revisa agendados.',
      }),
      briefing: `Projeto: agente autônomo de prospecção. AGENTE AUTÔNOMO que prospecta, DECIDE a abordagem e agenda reuniões SOZINHO, de ponta a ponta, sem humano conduzindo. Usa IA (Claude) para decidir e agir.
SAVING: 1 Analista Sênior gastava 20h/mês prospectando; agora 4h/mês. Alguém já fazia = sim. Sem custo evitado/externo.
RECEITA INCREMENTAL: gera ~40 agendamentos/mês com margem R$100 → R$4000/mês recorrente.
Quando perguntado se usa IA, a resposta é SIM (a IA decide e age sozinha).`,
      saving,
      receita,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Receita Mensal': receita.valor_ganho_mensal, 'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Tipo de Saving': 'mensal', 'Tipo de Receita': 'mensal' },
      },
    });
  }

  // ── Grupo F — edição / Memorial anterior ────────────────────────────────────
  // Bases DEDICADAS (baseOnly): existem só para serem editadas. A edição faz
  // UPDATE in-place na MESMA linha, então a validação standalone da base é pulada
  // (a linha, ao final, reflete o estado pós-edição). O memorial pré-edição é
  // capturado em tempo de run (run.mjs, via getMeuProjeto) e comparado contra a
  // coluna "Memorial anterior" (AF) da linha editada.

  // F1 — edição LEVE (só recalcula horas via iniciar-saving; sem reabrir conversa).
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 8 }],
    };
    cenarios.push({
      key: 'base-edicao-leve',
      baseOnly: true,
      nome: tag('Base — conciliação (edição leve)'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Base para edição leve de horas.' },
      doc: DOC_BASE('Conciliação (base leve)', {
        oque: 'Concilia extratos com o ERP diariamente.', fluxo: 'n8n baixa o OFX e casa por valor/data.',
        deps: 'n8n, API do banco.', config: 'Credenciais no n8n.', atencao: 'Divergências para revisão.',
      }),
      briefing: `Projeto: conciliação bancária no n8n. Determinístico, sem IA.
Antes: 1 Analista Pleno gastava 40h/mês; agora 8h/mês. Alguém já fazia = sim. Sem custo evitado/externo.`,
      saving,
      expected: { hard: {}, soft: {} }, // baseOnly: não valida standalone (linha será sobrescrita)
    });
  }
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 4 }], // 8 → 4
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'edicao-leve',
      edicaoDe: 'base-edicao-leve',
      editVia: 'saving', // recalcula horas, não reabre a conversa
      tipos_projeto: ['saving'],
      briefing: `Mesma conciliação, agora com ganho maior: o Analista Pleno caiu de 40h para 4h/mês (antes era 8h). Alguém já fazia = sim.`,
      saving,
      memorialCheck: true, // valida AF == memorial pré-edição e memorial novo ≠ antigo
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Memorial anterior': '(preenchido na edição)' },
      },
    });
  }

  // F2 — edição PESADA: reabre a conversa do agente (atualizar-metadados com doc
  // nova) → o agente re-conversa e gera um MEMORIAL NOVO; o antigo vai p/ AF.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 30, horas_depois: 10 }],
    };
    cenarios.push({
      key: 'base-edicao-memorial',
      baseOnly: true,
      nome: tag('Base — relatórios (memorial novo)'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, descricao_breve: 'Base para edição que gera memorial novo.' },
      doc: DOC_BASE('Relatórios Gerenciais (base)', {
        oque: 'Gera relatórios gerenciais diários automaticamente.',
        fluxo: 'n8n agrega dados e monta os relatórios.',
        deps: 'n8n, data warehouse.', config: 'Conexões no n8n.', atencao: 'Falhas geram alerta.',
      }),
      briefing: `Projeto: relatórios gerenciais no n8n. Determinístico, sem IA.
Antes: 1 Analista Pleno gastava 30h/mês montando relatórios; agora 10h/mês. Alguém já fazia = sim. Sem custo evitado/externo.`,
      saving,
      expected: { hard: {}, soft: {} },
    });
  }
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 30, horas_depois: 6 }], // 10 → 6
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'edicao-memorial',
      edicaoDe: 'base-edicao-memorial',
      editVia: 'doc', // reabre a conversa com doc nova → memorial novo
      tipos_projeto: ['saving'],
      // Doc/briefing NOVOS: mudança significativa que gera nova conversa e novo memorial.
      editDoc: DOC_BASE('Relatórios Gerenciais (revisado)', {
        oque: 'Gera relatórios gerenciais diários E AGORA TAMBÉM consolida os dados de duas novas fontes (financeiro e logística), ampliando o escopo.',
        fluxo: 'n8n agrega dados das fontes (incluindo as duas novas), monta os relatórios e distribui por e-mail.',
        deps: 'n8n, data warehouse, APIs de financeiro e logística.', config: 'Conexões no n8n.', atencao: 'Falhas geram alerta.',
      }),
      briefing: `Mesma automação de relatórios, agora REVISADA: passou a consolidar também duas novas fontes (financeiro e logística), ampliando o escopo. Continua determinístico, sem IA.
Com a ampliação, o Analista Pleno caiu de 30h para 6h/mês (antes da edição era 10h). Alguém já fazia = sim. Sem custo evitado/externo.`,
      saving,
      memorialCheck: true,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Memorial anterior': '(preenchido na edição)' },
      },
    });
  }

  // F3 — edição com RECLASSIFICAÇÃO: base automacao (sem IA) → edição adiciona IA
  // como funcionalidade → analisador reclassifica para "inteligencia". Memorial novo.
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 50, horas_depois: 10 }],
    };
    cenarios.push({
      key: 'base-edicao-reclass',
      baseOnly: true,
      nome: tag('Base — tickets (reclassificação)'),
      tipos_projeto: ['saving'],
      meta: { ...metaPadrao, ferramenta: 'Python', descricao_breve: 'Base automacao para reclassificação por IA.' },
      doc: DOC_BASE('Roteamento de Tickets (base, sem IA)', {
        oque: 'Roteia tickets por REGRAS FIXAS (palavras-chave), sem IA.',
        fluxo: 'Script Python lê a fila e roteia por regras determinísticas de palavra-chave.',
        deps: 'Python, API do helpdesk.', config: 'Tabela de regras no repo.', atencao: 'Regras revisadas mensalmente.',
      }),
      briefing: `Projeto: roteamento de tickets em Python. DETERMINÍSTICO, SEM IA — roteia por regras fixas de palavra-chave.
Antes: 1 Analista Pleno gastava 50h/mês roteando; agora 10h/mês. Alguém já fazia = sim. Sem custo evitado/externo.
Quando perguntado se a automação usa IA em algum passo, a resposta é NÃO (são regras fixas).`,
      saving,
      expected: { hard: {}, soft: {} },
    });
  }
  {
    const saving = {
      tipo_saving: 'mensal',
      alguem_fazia: 'sim',
      linhas: [{ cargo: 'Analista Pleno', horas_antes: 50, horas_depois: 8 }], // 10 → 8
    };
    const c = calcSaving(saving);
    cenarios.push({
      key: 'edicao-reclass',
      edicaoDe: 'base-edicao-reclass',
      editVia: 'doc',
      tipos_projeto: ['saving'],
      editDoc: DOC_BASE('Roteamento de Tickets (revisado, com IA)', {
        oque: 'Agora CLASSIFICA cada ticket por assunto usando IA (Claude) e roteia pela classificação — não é mais só regra fixa.',
        fluxo: 'Script Python lê a fila e, para cada ticket, o LLM (Claude) classifica o assunto; o roteamento segue a classificação da IA.',
        deps: 'Python, API do helpdesk, LLM (Claude).', config: 'Chaves de API no repo.', atencao: 'Casos de baixa confiança vão para revisão.',
      }),
      briefing: `Mesma automação de tickets, agora REVISADA: passou a CLASSIFICAR cada ticket por assunto usando IA (Claude) — antes era só regra fixa. AGORA A IA É FUNCIONALIDADE do projeto (classifica na execução).
Com a melhoria, o Analista Pleno caiu de 50h para 8h/mês (antes da edição era 10h). Alguém já fazia = sim. Sem custo evitado/externo.
Quando perguntado se a automação usa IA em algum passo, a resposta agora é SIM (a IA classifica os tickets).`,
      saving,
      memorialCheck: true,
      expected: {
        hard: {
          'Saving Horas': c.horas, 'Horas em Reais': c.horasReais, 'Saving Reais': c.savingReais,
          'Status': 'Pendente', 'Especial?': 'Não',
        },
        soft: { 'Memorial anterior': '(preenchido na edição)' },
      },
    });
  }

  // ── Metadados de complexidade (validação separada do expected financeiro) ────
  // alvo: nível que o cenário tenta induzir (revisão humana do usuário).
  // gateHard: 'automacao' → AC deve ser exatamente 'automacao' (gate IA=Não);
  //           'nao-automacao' → AC deve ser ≠ 'automacao' (gate IA=Sim);
  //           null → não validar (especial não passa pelo analisador).
  const complexidadePorKey = {
    'complexidade-inteligencia': { alvo: 'inteligencia', gateHard: 'nao-automacao' },
    'complexidade-autonomia': { alvo: 'autonomia', gateHard: 'nao-automacao' },
    'complexidade-inteligencia-receita': { alvo: 'inteligencia', gateHard: 'nao-automacao' },
    'complexidade-autonomia-savrec': { alvo: 'autonomia', gateHard: 'nao-automacao' },
    'edicao-reclass': { alvo: 'inteligencia', gateHard: 'nao-automacao' },
  };
  for (const c of cenarios) {
    if (c.especial) {
      c.complexidade = { alvo: 'especial', gateHard: null }; // analisador não roda p/ especial
    } else {
      c.complexidade = complexidadePorKey[c.key] ?? { alvo: 'automacao', gateHard: 'automacao' };
    }
  }

  return cenarios;
}
