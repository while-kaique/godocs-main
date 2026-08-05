// Validação DIRIGIDA do gate GANHO REAL × PROJETADO contra a staging.
//
// Diferente do run.mjs (que usa o LLM responder), aqui as respostas do usuário são
// SCRIPTADAS — replicam as falas REAIS do caso de origem ("Automação cadastro de novos
// cliente", 28/07/2026), porque o ponto é exercitar exatamente o caminho que falhou:
// o autor confessa que o número não foi medido e o agente gera o preview igual.
//
//   E2E_BASE_URL=https://godocs-staging.devgogroup.com node scripts/e2e/validar-ganho-projetado.mjs
//
// Cenário A (o bug): espera o GATE perguntar e, ao responder "ainda é expectativa",
//                    espera BLOQUEIO — nunca preview/complete.
// Cenário B (regressão): receita medida de verdade → precisa FECHAR normalmente.
import './lib/env.mjs';
import { BASE_URL, OWNER_EMAIL, OWNER_NOME } from './lib/env.mjs';
import { api, toBase64 } from './lib/api.mjs';

const runId = process.argv[2] || `gate-projetado-${Date.now().toString(36)}`;
const tag = (n) => `[E2E-${runId}] ${n}`;
const MAX_TURNS = 14;

let falhas = 0;
const ok = (m) => console.log(`   ✅ ${m}`);
const err = (m) => {
  falhas++;
  console.log(`   ❌ ${m}`);
};

// Documentação enxuta, no espírito do caso real: o mecanismo que gera a receita
// (o endpoint) ainda depende de implementação — sinal que o portão manda cruzar.
const DOC = (extra) => `# Landing pages de cadastro B2B

## O que faz
Cria landing pages de cadastro B2B por marca, com formulário que capta e qualifica
lojistas (CNPJ, segmento, faixa de pedido) e envia o lead ao CRM.

## Execução
Páginas estáticas (HTML/CSS/JS), uma por marca. O formulário faz POST para /api/b2b-leads.

## Dependências
RD Station; endpoint POST /api/b2b-leads; validação de CNPJ ativo; captura de UTMs.

## Configurar antes
Publicar cada landing page no site da marca; conectar o formulário ao RD Station.

## Pontos de atenção
${extra}
`;

function textoResposta(r) {
  return String(r?.content ?? r?.question ?? '');
}

// O gate se identifica de forma inequívoca: type "options", 2 opções, e a mensagem
// ancora na Etapa 1. Não casamos por texto solto para não confundir com outra pergunta.
function ehPerguntaDoGate(r) {
  const t = textoResposta(r);
  return (
    r?.type === 'options' &&
    Array.isArray(r?.options) &&
    r.options.length === 2 &&
    /Etapa 1/.test(t) &&
    /já está em produção/i.test(t)
  );
}

function ehBloqueio(r) {
  const t = textoResposta(r);
  return /não posso fechar/i.test(t) && /especial/i.test(t) && /medi[çc]ão/i.test(t);
}

async function abrirProjeto(nome, atencao) {
  const init = await api.iniciarSubmissao({
    responsavel_nome: OWNER_NOME,
    responsavel_email: OWNER_EMAIL,
    nome_projeto: tag(nome),
    tipos_projeto: ['receita_incremental'],
    descricao_breve: 'Landing pages de cadastro B2B com qualificação de lead.',
    escopo: 'interno',
    ferramenta: 'Claude',
    area_nome: 'B2B GOBEAUTE',
    data_criacao: '2026-07-27',
    docs: [{ base64: toBase64(DOC(atencao)), filename: 'documentacao.txt' }],
  });
  return { projetoId: init.projeto_id, resp: init.response };
}

// Conduz a fase de DOC até ela transicionar para receita (aprova o preview).
async function passarPelaDoc(projetoId, resp) {
  let turns = 0;
  while (resp && !resp.isComplete && resp.fase !== 'receita') {
    const t = resp.type;
    const ans =
      t === 'options'
        ? { content: resp.options[1] ?? resp.options[0], selected_option: 2 }
        : t === 'preview'
          ? { content: 'Aprovado' }
          : { content: 'Está tudo descrito na documentação enviada; pode seguir com o que está lá.' };
    process.stdout.write(`   · [${resp.fase}] ${t} → "${String(ans.content).slice(0, 42)}"\n`);
    resp = await api.enviarMensagem({
      projeto_id: projetoId,
      content: ans.content,
      ...(ans.selected_option != null ? { selected_option: ans.selected_option } : {}),
    });
    if (++turns > MAX_TURNS) throw new Error(`doc não transicionou em ${MAX_TURNS} turnos`);
  }
  return resp;
}

// ── Cenário A — o bug de origem ────────────────────────────────────────────
async function cenarioA() {
  console.log('\n━━ A) Ganho PROJETADO (reprodução do caso real) ━━');
  const { projetoId, resp: init } = await abrirProjeto(
    'Automação cadastro de novos clientes',
    'O envio ao CRM depende da implementação do endpoint POST /api/b2b-leads. Três landing pages ainda estão pendentes de finalização.',
  );
  console.log(`   projeto ${projetoId}`);
  await passarPelaDoc(projetoId, init);

  // Racional do formulário: exatamente a lógica do caso (1% escolhido "para ser piso").
  let resp = await api.iniciarReceita({
    projeto_id: projetoId,
    tipo_saving: 'mensal',
    valor_ganho_mensal: 10000,
    racional:
      'A LP leva o comprador B2B a se cadastrar e comprar direto no site. Já temos +1.000 leads/mês. ' +
      'Sendo pessimista (1% de conversão × R$ 1.000 de ticket = pedido mínimo): R$ 10 mil/mês.',
  });

  // Respostas do usuário: as falas REAIS (msgs 9 e 11 da conversa de produção).
  const falas = [
    'O mecanismo é checkout/pedido direto na própria LP: o lojista com CNPJ se cadastra, é validado e ' +
      'qualificado na hora e segue para fechar o pedido ali mesmo, sem passar por vendedor.',
    'Sobre o 1%: é uma premissa conservadora, não é um número medido — ainda não temos histórico de ' +
      'checkout self-service porque ele é justamente o que o projeto habilita. A ideia é validar com os ' +
      'primeiros meses e recalibrar.',
  ];

  let perguntouGate = false;
  let bloqueou = false;
  let vazouPreview = false;
  let turns = 0;

  while (resp && !resp.isComplete) {
    if (resp.type === 'preview' || resp.type === 'complete') {
      vazouPreview = true;
      console.log(`   ⚠️  ${resp.type} EMITIDO — texto: "${textoResposta(resp).slice(0, 120)}"`);
      break;
    }
    if (ehPerguntaDoGate(resp)) {
      perguntouGate = true;
      console.log(`   🚧 GATE perguntou: "${textoResposta(resp).slice(0, 110)}"`);
      console.log(`      opções: ${JSON.stringify(resp.options)}`);
      // Clica na 2ª: "Ainda é expectativa — não foi medido".
      resp = await api.enviarMensagem({
        projeto_id: projetoId,
        content: resp.options[1],
        selected_option: 2,
      });
      if (ehBloqueio(resp)) {
        bloqueou = true;
        console.log(`   🛑 BLOQUEIO: "${textoResposta(resp).slice(0, 160)}"`);
      } else {
        console.log(`   ⚠️  resposta pós-clique não é o bloqueio: [${resp.type}] "${textoResposta(resp).slice(0, 140)}"`);
      }
      break;
    }
    const fala = falas.shift() ?? 'Os dados informados estão corretos. Pode seguir.';
    process.stdout.write(`   · [${resp.fase}] ${resp.type} → "${fala.slice(0, 48)}…"\n`);
    resp = await api.enviarMensagem({ projeto_id: projetoId, content: fala });
    if (++turns > MAX_TURNS) break;
  }

  perguntouGate ? ok('o gate PERGUNTOU (2 botões, ancorado na Etapa 1)') : err('o gate NÃO perguntou');
  bloqueou ? ok('confirmado "é expectativa" → BLOQUEOU e ofereceu as saídas') : err('não bloqueou após confirmar expectativa');
  vazouPreview ? err('preview/complete VAZOU com ganho projetado (o bug)') : ok('nenhum preview/complete com ganho projetado');

  // A submissão tem de continuar barrada (o botão de triagem depende do chat completo).
  try {
    const sub = await api.submeterValidacao({ projeto_id: projetoId, modo: 'novo' });
    err(`submissão passou mesmo sem memorial: ganho=${sub.ganho} status=${sub.status}`);
  } catch (e) {
    ok(`submissão barrada como esperado (${e.message.slice(0, 80)})`);
  }
  return projetoId;
}

// ── Cenário B — regressão: ganho REAL fecha normalmente ────────────────────
async function cenarioB() {
  console.log('\n━━ B) Ganho REAL medido (regressão — precisa FECHAR) ━━');
  const { projetoId, resp: init } = await abrirProjeto(
    'Recuperacao de carrinhos abandonados',
    'Limite de 1 cupom por cliente por semana. O fluxo roda em produção desde março de 2026.',
  );
  console.log(`   projeto ${projetoId}`);
  await passarPelaDoc(projetoId, init);

  let resp = await api.iniciarReceita({
    projeto_id: projetoId,
    tipo_saving: 'mensal',
    valor_ganho_mensal: 8000,
    racional:
      'Roda em produção desde março de 2026. No relatório de pedidos do Metabase, o cupom de recuperação ' +
      'fechou 80 pedidos no último mês, com margem média apurada de R$ 100 cada = R$ 8.000/mês.',
  });

  const falas = [
    'Roda em produção desde março de 2026. A receita já entra: no painel "Pedidos por cupom" do Metabase ' +
      'contamos 80 pedidos fechados com o cupom de recuperação no mês passado, margem média apurada de R$ 100.',
    'Antes o carrinho abandonado simplesmente não era recuperado — ninguém abordava. Depois, esses 80 pedidos ' +
      'por mês passaram a fechar. O número é conferido no painel "Pedidos por cupom" do Metabase, todo mês.',
  ];

  let fechou = false;
  let gateApareceu = false;
  let turns = 0;

  while (resp && !resp.isComplete) {
    if (resp.type === 'complete') break;
    if (ehPerguntaDoGate(resp)) {
      gateApareceu = true;
      console.log('   🚧 gate perguntou → clicando "já acontece e foi medido"');
      resp = await api.enviarMensagem({ projeto_id: projetoId, content: resp.options[0], selected_option: 1 });
      continue;
    }
    if (resp.type === 'preview') {
      process.stdout.write('   · preview → "Aprovado"\n');
      resp = await api.enviarMensagem({ projeto_id: projetoId, content: 'Aprovado' });
      if (resp?.type === 'complete' || resp?.isComplete) fechou = true;
      continue;
    }
    const fala = falas.shift() ?? 'Os dados estão corretos e completos. Pode gerar o memorial.';
    process.stdout.write(`   · [${resp.fase}] ${resp.type} → "${fala.slice(0, 48)}…"\n`);
    resp = await api.enviarMensagem({ projeto_id: projetoId, content: fala });
    if (++turns > MAX_TURNS) break;
  }
  if (resp?.isComplete || resp?.type === 'complete') fechou = true;

  console.log(`   (gate ${gateApareceu ? 'apareceu 1×' : 'não apareceu'} neste cenário)`);
  fechou ? ok('ganho medido FECHOU o memorial — o gate não bloqueia quem fez certo') : err('ganho medido NÃO fechou (falso positivo travando o fluxo)');

  if (fechou) {
    try {
      const sub = await api.submeterValidacao({ projeto_id: projetoId, modo: 'novo' });
      // `ganho` vem como OBJETO (não número) — o valor da receita mora em valor_ganho_mensal.
      // (`ganho_total` é menor de propósito: receita entra ÷10 no Ganho Total — decisão de
      // produto já documentada, não "consertar".)
      const g = sub?.ganho ?? {};
      const valor = Number(g.valor_ganho_mensal ?? g.receita_reais_mes ?? 0);
      valor > 0
        ? ok(`submissão OK: valor_ganho_mensal=${valor} status=${sub.status ?? '—'}`)
        : err(`submissão sem valor de receita: ${JSON.stringify(g).slice(0, 160)}`);
    } catch (e) {
      err(`submissão falhou: ${e.message.slice(0, 120)}`);
    }
  }
  return projetoId;
}

async function main() {
  console.log(`\n🚧 Validação do gate ganho real × projetado — run "${runId}"`);
  console.log(`   alvo: ${BASE_URL}`);
  if (!/staging/.test(BASE_URL)) {
    console.log('\n⛔ ABORTADO: este script só roda contra a STAGING (defina E2E_BASE_URL).');
    process.exit(2);
  }
  const ids = [];
  try {
    ids.push(await cenarioA());
  } catch (e) {
    err(`cenário A explodiu: ${e.message}`);
  }
  try {
    ids.push(await cenarioB());
  } catch (e) {
    err(`cenário B explodiu: ${e.message}`);
  }
  console.log(`\n${falhas === 0 ? '✅ TUDO VERDE' : `❌ ${falhas} falha(s)`}`);
  console.log(`   projetos criados: ${ids.filter(Boolean).join(', ')}`);
  console.log(`   limpeza: POST /api/admin/e2e-cleanup (tag [E2E-${runId}])`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
