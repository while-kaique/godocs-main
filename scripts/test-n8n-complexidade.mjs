// Mock test do n8n para os 3 tipos de complexidade. Para cada tipo: cria uma
// linha via webhook de submissão e dispara o update (PATCH) com aquela
// complexidade + status "Aprovado". Verifica se a coluna Complexidade (e Status)
// recebe cada valor corretamente. NÃO testa a classificação do analisador.
//   node scripts/test-n8n-complexidade.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const N8N = env.N8N_WEBHOOK_URL;
const N8N_UPDATE = env.N8N_WEBHOOK_URL_UPDATE;
const ts = new Date().toISOString().slice(0, 16);

const COMPLEXIDADES = ['automacao', 'inteligencia', 'autonomia'];

async function disparar(label, url, payload, method) {
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  console.log(`   ${label} (${method}) → HTTP ${resp.status} | ${text || '(vazio)'}`);
}

for (const comp of COMPLEXIDADES) {
  const nome = `TESTE complexidade ${comp.toUpperCase()} (ignorar) ${ts}`;
  console.log(`\n=== ${comp.toUpperCase()} — "${nome}" ===`);

  const submit = {
    projeto_id: `teste-comp-${comp}`,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    area: 'Tecnologia',
    ferramenta: 'n8n',
    escopo: 'interno',
    membros: ['Luis Albuquerque'],
    nome_projeto: nome,
    descricao_breve: `Disparo de teste de complexidade (${comp}). Pode ignorar/apagar.`,
    data_criacao_projeto: new Date().toISOString().slice(0, 10),
    tipos_projeto: ['saving'],
    status: 'Pendente',
    saving_horas: 10,
    saving_reais: 299,
    tipo_saving: 'mensal',
    memorial_calculo: 'Memorial de teste — ignorar.',
    alguem_fazia: 'sim',
    custo_externo_mensal: 0,
    saving_linhas: JSON.stringify([
      { cargo: 'Analista Pleno', horas_antes: 10, horas_depois: 0, valor_hora: 29.9, economia_horas_mes: 10, economia_reais_mes: 299 },
    ]),
    receita_valor_mensal: 0,
    tipo_receita: '',
    receita_memorial: '',
    ganho_total_mensal: 299,
    documentacao: { nome_projeto: nome, o_que_faz: 'Teste.', execucao: 'Teste.', dependencias: 'Teste.', fluxo: 'Teste.', configurar_antes: 'Teste.', atencao: 'Teste.' },
  };

  const update = {
    projeto: nome,
    complexidade: comp,
    observacoes: `Observação de teste para complexidade ${comp}.`,
    status: 'Aprovado',
  };

  await disparar('1. submissão', N8N, submit, 'POST');
  await disparar('2. update   ', N8N_UPDATE, update, 'PATCH');
}

console.log('\n✅ 3 disparos concluídos (um por complexidade).');
