// Disparo de teste para os webhooks do n8n — espelha exatamente o payload de
// submeterParaValidacao (principal) + analisarProjetoFn (update). Usa o stripMarkdown
// REAL do projeto para o memorial/observações chegarem como em produção.
import { readFileSync } from 'node:fs';
import { stripMarkdown } from '../src/lib/strip-markdown.ts';

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
const N8N_UPDATE = env.N8N_WEBHOOK_URL_UPDATE;

// Memorial COM markdown na origem (como o agente gera) → mostra o strip funcionando.
const memorialMarkdown = [
  '## Memorial de Cálculo',
  '',
  'Antes da automação, o processo era **100% manual**:',
  '',
  '- **Analista Pleno**: 40h/mês → 6h/mês (economia de `34h`)',
  '- **Assistente**: 20h/mês → 0h/mês (tarefa eliminada)',
  '',
  'Total economizado: **54 horas/mês**.',
  'Detalhes na [planilha de apuração](https://docs.google.com/exemplo).',
].join('\n');

const receitaMarkdownVazio = '';

const nomeProjeto = `TESTE n8n — disparo manual (ignorar) ${new Date().toISOString().slice(0, 16)}`;

const documentacao = {
  nome_projeto: nomeProjeto,
  o_que_faz: 'Automação de teste só para validar o formato no Sheets.',
  execucao: 'Roda via cron diário às 8h.',
  dependencias: 'Acesso à API X e planilha Y.',
  fluxo: '1. Lê dados\n2. Processa\n3. Escreve no destino',
  configurar_antes: 'Definir token da API X no .env.',
  atencao: 'Não rodar duas vezes no mesmo dia.',
  saving: {
    linhas: [
      { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 6, valor_hora: 29.9, economia_horas_mes: 34, economia_reais_mes: 1016.6 },
      { cargo: 'Assistente', horas_antes: 20, horas_depois: 0, valor_hora: 13.94, economia_horas_mes: 20, economia_reais_mes: 278.8 },
    ],
    economia_horas_mes: 54,
    economia_reais_mes: 1295.4,
    tipo_saving: 'mensal',
    memorial_calculo: memorialMarkdown,
  },
};

const saving = documentacao.saving;

const payloadPrincipal = {
  projeto_id: 'teste-manual-0001',
  responsavel_nome: 'Luis Albuquerque',
  responsavel_email: 'luis.albuquerque@gocase.com',
  area: 'Tecnologia',
  ferramenta: 'Python + n8n',
  escopo: 'interno',
  membros: ['Luis Albuquerque'],
  nome_projeto: nomeProjeto,
  descricao_breve: 'Disparo de teste para conferir o layout no Sheets. Pode ignorar/apagar.',
  data_criacao_projeto: new Date().toISOString().slice(0, 10),
  tipos_projeto: ['saving'],
  status: 'Pendente',
  saving_horas: saving.economia_horas_mes,
  saving_reais: saving.economia_reais_mes,
  tipo_saving: saving.tipo_saving,
  memorial_calculo: stripMarkdown(saving.memorial_calculo) ?? '',
  alguem_fazia: 'sim',
  custo_externo_mensal: 0,
  saving_linhas: JSON.stringify(saving.linhas),
  receita_valor_mensal: 0,
  tipo_receita: '',
  receita_memorial: stripMarkdown(receitaMarkdownVazio) ?? '',
  ganho_total_mensal: 1295.4,
  documentacao,
};

const observacoesMarkdown =
  'A submissão está coerente, mas **faltam detalhes** sobre o tratamento de erros e o gatilho exato. Recomenda-se alinhar com o time antes de subir.';

const payloadUpdate = {
  projeto: nomeProjeto,
  complexidade: 'automacao',
  observacoes: stripMarkdown(observacoesMarkdown) ?? '',
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

await disparar('1. Payload principal → N8N_WEBHOOK_URL', N8N, payloadPrincipal, 'POST');
await disparar('2. Update (observações/complexidade) → N8N_WEBHOOK_URL_UPDATE', N8N_UPDATE, payloadUpdate, 'PATCH');
console.log('\n✅ Disparos concluídos.');
