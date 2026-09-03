// T1 — VALIDAÇÃO CEGA da régua de estrelas nos NÃO-ESPECIAIS já notados.
// Só leitura + LLM. Nunca escreve na planilha, nunca grava nota.
//   npx vitest run --config scripts/regua-t1/aplicar.config.ts
//
// Envs: T1_IN (corpus json) · T1_OUT · T1_LIMIT (amostra estratificada) · T1_CONC · T1_MODEL
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

type Proj = {
  id: string; nome: string; area: string; notaHumana: number; complexidade: string;
  tipos: string; ferramenta: string; descricao: string; escopo: string;
  memorialSaving: string; memorialReceita: string; alguemFazia: string;
  savingReais: string; receitaMensal: string; savingHoras: string; observacoes: string;
  contexto?: string;
};

const CORTE_MEMORIAL = 5000;

function fichaDoProjeto(p: Proj): string {
  const num = (s: string) => {
    const n = parseFloat(String(s ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const temGanho = num(p.savingReais) > 0 || num(p.receitaMensal) > 0;
  const mem = [p.memorialSaving, p.memorialReceita].filter((t) => t && t !== '—').join('\n\n');
  return [
    `NOME: ${p.nome}`,
    `ÁREA: ${p.area}`,
    `TIPO DECLARADO: ${p.tipos || '—'}`,
    `COMPLEXIDADE (classificação automática): ${p.complexidade || '—'}`,
    `FERRAMENTA: ${p.ferramenta || '—'}`,
    `ALGUÉM JÁ FAZIA ISSO À MÃO ANTES: ${p.alguemFazia || '—'}`,
    `GANHO JÁ MEDIDO E REGISTRADO NO SISTEMA: ${temGanho ? 'sim' : 'não'}`,
    '',
    'DESCRIÇÃO (escrita pelo autor):',
    p.descricao || '—',
    '',
    ...(p.contexto && p.contexto !== '—'
      ? ['', 'POR QUE O AUTOR CONSIDERA ESTE PROJETO ESPECIAL:', p.contexto]
      : []),
    '',
    'MEMORIAL (escrito com o autor):',
    mem.slice(0, CORTE_MEMORIAL) || '—',
  ].join('\n');
}

const CONTRATO = `
Responda SÓ com um objeto JSON, sem cercas de código:
{
  "nota": <inteiro 0..5>,
  "criterio_aplicado": "<piso|informa|executa|garante|decide|responde>",
  "piso_aplicado": "<mensuravel|so_o_autor|simples_local|fora_de_uso|ressubmissao|null>",
  "evidencias": ["<frase CITADA do texto do projeto que sustenta o critério>"],
  "dependente_nomeado": "<nome do processo/projeto dependente, ou null>",
  "promocao_aplicada": <true|false>,
  "escape": null | { "sugestao": <6..10>, "nao_existiria": "<citação>", "sem_volta": "<citação>" },
  "confianca": "<alta|media|baixa>"
}

Regras da resposta:
- "nota" é a nota FINAL da faixa do agente (0 a 5), já com a promoção aplicada se couber.
- Se o piso zerar, "criterio_aplicado" é "piso" e "piso_aplicado" diz QUAL desqualificador.
- Toda evidência é CITAÇÃO literal do texto acima. Sem citação, o critério não vale: baixe um nível
  ou marque confianca "baixa".
- Escape só quando os DOIS gatilhos forem verdade, cada um com citação. Na dúvida, escape = null.
`.trim();

it('T1 — régua cega nos não-especiais', async () => {
  const { descreverReguaAgente, descreverEscape } = await import('@/lib/estrelas-regua');

  const IN = process.env.T1_IN!;
  const OUT = process.env.T1_OUT!;
  const MODEL = process.env.T1_MODEL ?? 'gpt-5.4-mini';
  const CONC = Number(process.env.T1_CONC ?? 12);
  const LIMIT = Number(process.env.T1_LIMIT ?? 0);
  const KEY = process.env.LLM_FALLBACK ?? process.env.LLM_API_KEY!;

  let corpus: Proj[] = JSON.parse(fs.readFileSync(IN, 'utf8'));

  // Amostra ESTRATIFICADA por nota humana (determinística: passo fixo dentro de cada nota),
  // para o piloto não virar 100% de zeros e esconder o comportamento no topo.
  if (LIMIT > 0 && LIMIT < corpus.length) {
    const porNota = new Map<number, Proj[]>();
    for (const p of corpus) porNota.set(p.notaHumana ?? -1, [...(porNota.get(p.notaHumana ?? -1) ?? []), p]);
    const notas = [...porNota.keys()].sort((a, b) => a - b);
    const cota = Math.max(1, Math.floor(LIMIT / notas.length));
    const escolha: Proj[] = [];
    for (const n of notas) {
      const g = porNota.get(n)!;
      const passo = Math.max(1, Math.floor(g.length / cota));
      for (let i = 0; i < g.length && escolha.filter((p) => p.notaHumana === n).length < cota; i += passo) escolha.push(g[i]);
    }
    // completa com zeros (a massa da base) até o LIMIT
    for (const p of porNota.get(0) ?? []) { if (escolha.length >= LIMIT) break; if (!escolha.includes(p)) escolha.push(p); }
    corpus = escolha;
  }

  // VARIANTE 'b' — diagnóstico. NÃO altera `estrelas-regua.ts`: só troca, no PROMPT, a leitura do
  // desqualificador `mensuravel` pela intenção declarada na D1 ("a estrela paga o que a fórmula não
  // vê"). Serve para separar "a régua não discrimina" de "UM item do piso zera tudo".
  const VARIANTE = (process.env.T1_VARIANTE ?? 'a').toLowerCase();
  const RESSALVA_B = [
    '',
    'LEITURA DO DESQUALIFICADOR "mensurável" (vale só para este item do piso):',
    'ter saving ou receita medidos NÃO zera o projeto por si. O piso só se aplica quando TUDO o que o',
    'projeto entrega já está capturado por esse número — isto é, não sobra impacto que a fórmula não vê.',
    'Se o projeto tem número E também assume barreira, decisão ou responsabilidade pelo resultado,',
    'julgue-o pelos critérios 1★ a 5★.',
  ].join('\n');

  // VARIANTE 'c' — diagnóstico. Remove do PROMPT o desqualificador `mensuravel` inteiro (os outros
  // 4 do piso ficam). Isola a pergunta: o colapso vem DESSE item ou os critérios 1★–5★ é que não
  // discriminam este material? Também não toca `estrelas-regua.ts`.
  const reguaAgente =
    VARIANTE === 'c'
      ? descreverReguaAgente()
          .split('\n')
          .filter((l) => !l.includes('volta como saving/receita'))
          .join('\n')
      : descreverReguaAgente();

  const SYSTEM = [
    'Você audita projetos de automação e IA de uma empresa e atribui a NOTA DE ESTRELAS de um projeto.',
    'A estrela é nota qualitativa: ela existe para o impacto DIFÍCIL DE MENSURAR. Ganho com número já',
    'tem fórmula própria e não precisa de estrela.',
    '',
    'Aplique a régua abaixo LITERALMENTE. Não invente critério, não use adjetivo sem régua, não some',
    'pontos: a nota é o nível cujo critério o projeto satisfaz.',
    '',
    reguaAgente,
    '',
    descreverEscape(),
    VARIANTE === 'b' ? RESSALVA_B : '',
    '',
    CONTRATO,
  ].join('\n');

  console.log(`\nvariante=${VARIANTE} · modelo=${MODEL} · projetos=${corpus.length} · concorrência=${CONC}`);
  console.log(`prompt de sistema: ${SYSTEM.length} chars`);

  const resultados: Record<string, unknown>[] = [];
  let feitos = 0, erros = 0, tokIn = 0, tokOut = 0;
  const t0 = Date.now();

  async function uma(p: Proj) {
    const body = {
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: fichaDoProjeto(p) }],
      response_format: { type: 'json_object' as const },
    };
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
        if (!r.ok) { await new Promise((s) => setTimeout(s, 1500 * (tentativa + 1))); continue; }
        const j = await r.json();
        tokIn += j.usage?.prompt_tokens ?? 0;
        tokOut += j.usage?.completion_tokens ?? 0;
        const txt = j.choices?.[0]?.message?.content ?? '';
        const parsed = JSON.parse(txt.replace(/^```json\s*|```$/g, '').trim());
        return { id: p.id, nome: p.nome, area: p.area, notaHumana: p.notaHumana, ...parsed };
      } catch {
        await new Promise((s) => setTimeout(s, 1500 * (tentativa + 1)));
      }
    }
    erros++;
    return { id: p.id, nome: p.nome, area: p.area, notaHumana: p.notaHumana, erro: true };
  }

  const fila = [...corpus];
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      for (;;) {
        const p = fila.shift();
        if (!p) return;
        resultados.push(await uma(p));
        feitos++;
        if (feitos % 25 === 0) {
          const s = (Date.now() - t0) / 1000;
          console.log(`  ${feitos}/${corpus.length} · ${(feitos / s).toFixed(1)}/s · erros ${erros}`);
        }
      }
    }),
  );

  fs.writeFileSync(OUT, JSON.stringify(resultados, null, 1));
  const custo = (tokIn / 1e6) * 0.25 + (tokOut / 1e6) * 2.0; // ordem de grandeza
  console.log(`\nfeitos ${feitos} · erros ${erros} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`tokens in ${tokIn} out ${tokOut} · custo aprox US$ ${custo.toFixed(2)}`);
  console.log(`saída: ${OUT}`);
}, 3_600_000);
