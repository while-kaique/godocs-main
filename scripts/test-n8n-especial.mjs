// Disparo de teste para o webhook do n8n — simula a submissão de um PROJETO ESPECIAL.
// Espelha exatamente o payload de submeterParaValidacao quando especial=true:
// sem saving/receita, tipos_projeto=['especial'], status "Pendente", e os campos
// novos `especial` + `contexto_especial`. Não dispara o update (analisador é pulado).
import { readFileSync } from 'node:fs';

// .env mínimo (sem dependência externa)
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

const nomeProjeto = `TESTE n8n ESPECIAL — disparo manual (ignorar) ${new Date().toISOString().slice(0, 16)}`;

// Documentação (só a parte de doc — projeto especial não tem saving/receita).
const documentacao = {
  nome_projeto: nomeProjeto,
  o_que_faz: 'Reestrutura a base de conhecimento interna para consumo por agentes de IA.',
  execucao: 'Pipeline manual disparado pelo time de Dados.',
  dependencias: 'Acesso ao Drive corporativo e à API de embeddings.',
  fluxo: '1. Coleta documentos\n2. Normaliza e indexa\n3. Expõe para os agentes',
  configurar_antes: 'Definir credenciais do Drive e da API de embeddings.',
  atencao: 'Projeto fundacional — alto impacto estratégico, sem ganho financeiro direto.',
};

// ouTraco: campos de texto/categóricos vazios chegam como "—" (igual ao backend).
const ouTraco = (v) => (v != null && String(v).trim() !== '' ? v : '—');

const payloadEspecial = {
  projeto_id: 'teste-especial-0001',
  responsavel_nome: 'Luis Albuquerque',
  responsavel_email: 'luis.albuquerque@gocase.com',
  area: 'Tecnologia',
  ferramenta: 'Claude + GoDeploy',
  escopo: 'interno',
  membros: ['Luis Albuquerque'],
  nome_projeto: nomeProjeto,
  descricao_breve: 'Disparo de teste de PROJETO ESPECIAL para conferir o layout no Sheets. Pode ignorar/apagar.',
  data_criacao_projeto: new Date().toISOString().slice(0, 10),
  tipos_projeto: ['especial'],
  // ── Campos novos do projeto especial ──
  especial: true,
  contexto_especial: ouTraco(
    'Projeto de altíssimo impacto que não gera saving nem receita direta, mas é a fundação ' +
      'que viabiliza dezenas de automações futuras e destrava a estratégia de IA do grupo.',
  ),
  status: 'Pendente',
  // ── Campos financeiros: vazios/zerados (especial não passa por saving/receita) ──
  saving_horas: 0,
  saving_reais: 0,
  tipo_saving: ouTraco(undefined),
  memorial_calculo: ouTraco(undefined),
  alguem_fazia: ouTraco(undefined),
  custo_externo_mensal: 0,
  saving_linhas: JSON.stringify([]),
  receita_valor_mensal: 0,
  tipo_receita: ouTraco(undefined),
  receita_memorial: ouTraco(undefined),
  ganho_total_mensal: 0,
  documentacao,
};

async function disparar(label, url, payload, method = 'POST') {
  if (!url) {
    console.log(`\n⚠️  ${label}: URL não configurada no .env — pulando.`);
    return;
  }
  console.log(`\n── ${label} (${method}) ──`);
  console.log('Payload enviado:');
  console.log(JSON.stringify(payload, null, 2));
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    console.log(`→ HTTP ${resp.status}`);
    console.log(`→ Resposta: ${text || '(vazia)'}`);
  } catch (e) {
    console.log(`→ ERRO: ${e.message}`);
  }
}

await disparar('Projeto ESPECIAL → N8N_WEBHOOK_URL', N8N, payloadEspecial, 'POST');
console.log('\n✅ Disparo concluído.');
