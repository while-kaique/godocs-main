// Cenários de teste pré-definidos para simulação do fluxo de submissão.

export type TestScenario = {
  id: string;
  label: string;
  description: string;
  icon: string;
  formData: {
    responsavel_nome: string;
    responsavel_email: string;
    area: string;
    area_id?: string;
    ferramenta: string;
    escopo: 'interno' | 'externo';
    servico_externo?: string;
    membros: string[];
    nome_projeto: string;
    data_criacao: string;
    tipos_projeto: ('saving' | 'receita_incremental')[];
    tipo_projeto: 'saving' | 'receita_incremental';
    descricao_breve: string;
  };
  docs: { base64: string; filename: string }[];
  savingForm?: {
    tipo_saving: 'mensal' | 'pontual';
    linhas: { cargo: string; horas_antes: number; horas_depois: number }[];
    custo_externo_mensal?: number;
  };
  receitaForm?: {
    tipo_saving: 'mensal' | 'pontual';
    valor_ganho_mensal?: number;
    racional?: string;
  };
};

// Documento fake — um mini script Python para o extrator analisar
const FAKE_DOC_CONTENT = `# Automação de Relatórios Diários

## Descrição
Script Python que roda todo dia às 7h via cron job no servidor interno.
Consulta a API do ERP (SAP B1) para puxar os pedidos do dia anterior,
gera um relatório em PDF e envia por email para a equipe comercial.

## Fluxo
1. Cron job dispara o script às 07:00
2. Conecta na API SAP B1 (Service Layer) com credenciais do .env
3. Consulta pedidos com status "aprovado" das últimas 24h
4. Agrupa por região e calcula totais
5. Gera PDF com ReportLab (template em templates/relatorio.html)
6. Envia email via SMTP do Google Workspace (smtp.gmail.com:587)
7. Loga resultado no banco PostgreSQL (tabela log_execucoes)

## Dependências
- Python 3.11, requests, reportlab, psycopg2, python-dotenv
- API SAP B1 Service Layer (endpoint: https://sap.empresa.com/b1s/v2)
- SMTP Google Workspace
- PostgreSQL 15 (servidor: db.empresa.internal)

## Variáveis de ambiente
- SAP_URL, SAP_USER, SAP_PASSWORD
- SMTP_USER, SMTP_PASSWORD
- DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
- EMAIL_DESTINATARIOS (lista separada por vírgula)

## Riscos
- Se a API do SAP estiver fora, o script falha silenciosamente (só loga)
- Não tem retry automático
- O template do PDF está hardcoded e não suporta mais de 500 linhas
`;

const FAKE_DOC_MINIMAL = `Automação simples que puxa dados de uma planilha.`;

function toBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

export const SCENARIOS: TestScenario[] = [
  {
    id: 'completo-saving',
    label: 'Completo (saving)',
    description: 'Todos os campos preenchidos, tipo saving, doc técnico completo',
    icon: '💰',
    formData: {
      responsavel_nome: 'Teste Simulação',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'Tecnologia',
      ferramenta: 'Python + SAP B1 API',
      escopo: 'interno',
      membros: ['dev1@gogroup.com.br', 'dev2@gogroup.com.br'],
      nome_projeto: `Teste Saving ${Date.now()}`,
      data_criacao: '2025-01-15',
      tipos_projeto: ['saving'],
      tipo_projeto: 'saving',
      descricao_breve: 'Automação de relatórios diários que consulta o ERP e envia por email, substituindo processo manual de 3 analistas.',
    },
    docs: [{ base64: toBase64(FAKE_DOC_CONTENT), filename: 'documentacao.md' }],
    savingForm: {
      tipo_saving: 'mensal',
      linhas: [
        { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 },
        { cargo: 'Estagiário', horas_antes: 20, horas_depois: 0 },
      ],
    },
  },
  {
    id: 'completo-receita',
    label: 'Completo (receita)',
    description: 'Todos os campos preenchidos, tipo receita incremental',
    icon: '📈',
    formData: {
      responsavel_nome: 'Teste Simulação',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'E-commerce',
      ferramenta: 'n8n + OpenAI API',
      escopo: 'interno',
      membros: [],
      nome_projeto: `Teste Receita ${Date.now()}`,
      data_criacao: '2025-03-01',
      tipos_projeto: ['receita_incremental'],
      tipo_projeto: 'receita_incremental',
      descricao_breve: 'IA que gera descrições de produtos automaticamente, aumentando a taxa de conversão em 15%.',
    },
    docs: [{ base64: toBase64(FAKE_DOC_CONTENT), filename: 'projeto.md' }],
    receitaForm: {
      tipo_saving: 'mensal',
      valor_ganho_mensal: 25000,
      racional: 'Aumento de 15% na taxa de conversão representa R$25k/mês em receita incremental.',
    },
  },
  {
    id: 'completo-ambos',
    label: 'Completo (ambos)',
    description: 'Saving + receita incremental juntos',
    icon: '🎯',
    formData: {
      responsavel_nome: 'Teste Simulação',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'Operações',
      ferramenta: 'Power Automate + Python',
      escopo: 'externo',
      servico_externo: 'Consultoria XYZ',
      membros: ['analista@gogroup.com.br'],
      nome_projeto: `Teste Ambos ${Date.now()}`,
      data_criacao: '2025-02-10',
      tipos_projeto: ['saving', 'receita_incremental'],
      tipo_projeto: 'saving',
      descricao_breve: 'Automação que reduz trabalho manual E gera receita via upsell automático.',
    },
    docs: [{ base64: toBase64(FAKE_DOC_CONTENT), filename: 'spec.md' }],
    savingForm: {
      tipo_saving: 'mensal',
      linhas: [{ cargo: 'Analista Júnior', horas_antes: 30, horas_depois: 5 }],
      custo_externo_mensal: 500,
    },
    receitaForm: {
      tipo_saving: 'mensal',
      valor_ganho_mensal: 10000,
      racional: 'Upsell automático gera R$10k/mês em vendas adicionais.',
    },
  },
  {
    id: 'minimo',
    label: 'Mínimo',
    description: 'Só dados obrigatórios — força o agente a perguntar tudo',
    icon: '📎',
    formData: {
      responsavel_nome: 'Teste Mínimo',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'RPA',
      ferramenta: 'UiPath',
      escopo: 'interno',
      membros: [],
      nome_projeto: `Teste Mínimo ${Date.now()}`,
      data_criacao: '2025-06-01',
      tipos_projeto: ['saving'],
      tipo_projeto: 'saving',
      descricao_breve: '',
    },
    docs: [{ base64: toBase64(FAKE_DOC_MINIMAL), filename: 'nota.txt' }],
  },
  {
    id: 'sem-arquivos',
    label: 'Sem arquivos',
    description: 'Array docs vazio — testa validação do backend (deve dar erro)',
    icon: '🚫',
    formData: {
      responsavel_nome: 'Teste Sem Arquivo',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'Financeiro',
      ferramenta: 'Excel VBA',
      escopo: 'interno',
      membros: [],
      nome_projeto: `Teste Sem Docs ${Date.now()}`,
      data_criacao: '2025-04-01',
      tipos_projeto: ['saving'],
      tipo_projeto: 'saving',
      descricao_breve: 'Projeto sem documentação enviada.',
    },
    docs: [],
  },
  {
    id: 'parcial',
    label: 'Dados parciais',
    description: 'Alguns campos preenchidos, descrição curta, doc genérico',
    icon: '🧩',
    formData: {
      responsavel_nome: 'Teste Parcial',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'Marketing',
      ferramenta: 'n8n',
      escopo: 'interno',
      membros: [],
      nome_projeto: `Teste Parcial ${Date.now()}`,
      data_criacao: '2025-05-01',
      tipos_projeto: ['saving'],
      tipo_projeto: 'saving',
      descricao_breve: 'Automação de envio de emails para clientes.',
    },
    docs: [{ base64: toBase64('Script que envia emails. Usa a API do Brevo.'), filename: 'readme.txt' }],
  },
  {
    id: 'duplicado',
    label: 'Duplicado',
    description: 'Usa nome fixo "Projeto Duplicado Teste" — testa detecção de duplicata na submissão',
    icon: '👯',
    formData: {
      responsavel_nome: 'Teste Duplicado',
      responsavel_email: 'teste@gogroup.com.br',
      area: 'Tecnologia',
      ferramenta: 'Python',
      escopo: 'interno',
      membros: [],
      nome_projeto: 'Projeto Duplicado Teste',
      data_criacao: '2025-01-01',
      tipos_projeto: ['saving'],
      tipo_projeto: 'saving',
      descricao_breve: 'Projeto com nome fixo para testar detecção de duplicata.',
    },
    docs: [{ base64: toBase64(FAKE_DOC_MINIMAL), filename: 'doc.txt' }],
  },
];

// Dados mock para "pular" direto para saving/receita (doc já preenchida)
export const MOCK_COLETADO_COMPLETO = {
  nome_projeto: 'Automação de Relatórios Diários',
  o_que_faz: 'Consulta a API do SAP B1, gera relatório PDF com os pedidos do dia anterior e envia por email para a equipe comercial. Substitui o processo manual de 3 analistas que compilavam dados manualmente.',
  execucao: 'Cron job diário às 07:00 no servidor interno.',
  dependencias: 'Python 3.11, SAP B1 Service Layer API, SMTP Google Workspace, PostgreSQL 15, ReportLab.',
  fluxo: '1. Cron dispara às 07:00\n2. Conecta na API SAP B1\n3. Consulta pedidos aprovados (últimas 24h)\n4. Agrupa por região e calcula totais\n5. Gera PDF com ReportLab\n6. Envia email via SMTP\n7. Loga resultado no PostgreSQL',
  configurar_antes: 'SAP_URL, SAP_USER, SAP_PASSWORD, SMTP_USER, SMTP_PASSWORD, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, EMAIL_DESTINATARIOS',
  atencao: 'API SAP fora = falha silenciosa (só loga). Sem retry automático. Template PDF hardcoded, não suporta mais de 500 linhas.',
};

export const MOCK_SAVING_FORM = {
  tipo_saving: 'mensal' as const,
  linhas: [
    { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 },
    { cargo: 'Estagiário', horas_antes: 20, horas_depois: 0 },
  ],
};

export const MOCK_RECEITA_FORM = {
  tipo_saving: 'mensal' as const,
  valor_ganho_mensal: 25000,
  racional: 'Aumento de 15% na conversão = R$25k/mês.',
};
