// Camada de LLM-juiz: "verificação da verificação". Para cada projeto de um run,
// envia a LINHA COMPLETA da planilha (A→AJ) + a ficha do cenário (intenção/valores
// esperados) a um LLM que audita COLUNA POR COLUNA e sinaliza divergências reais.
// Complementa o validate.mjs (asserts fixos) cobrindo o que ele não olha: qualidade
// do memorial, coerência das Observações, vazamento de R$, convenções de célula,
// Área, URL, datas, etc.
//
//   node --experimental-strip-types scripts/e2e/validate-llm.mjs <runId> [runId2 ...]
//
// Saída: por cenário, lista de achados {coluna, esperado, atual, severidade, explicação}.
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { readAllRows } from './lib/sheets.mjs';
import { buildScenarios } from './scenarios.mjs';

const { llmChat } = await import('../../src/lib/llm.ts');

const runIds = process.argv.slice(2);
if (!runIds.length) { console.error('Uso: validate-llm.mjs <runId> [...]'); process.exit(1); }

// Legenda do comportamento esperado de cada coluna (A→AJ). É o "gabarito" semântico
// que o juiz usa para julgar. Mantido em sincronia com o CLAUDE.md / sync.ts.
const LEGENDA = `
- Data Submissão: data/hora da submissão. Em EDIÇÃO, preserva a data original (NÃO muda na edição).
- ID Projeto: id hex aleatório (ou "LEGADO-…" para legados). Deve casar com o projeto.
- Data Criação: data informada no formulário (etapa 1).
- Área: derivada do e-mail do dono. NÃO pode ser "ÁREA NÃO IDENTIFICADA".
- Nome Completo / Email: dados do dono.
- Projeto: nome do projeto (aqui começa com "[E2E-…]").
- Participantes: e-mails dos membros, ou "—" quando não há.
- Descrição: a descrição breve informada no formulário.
- URL: link do Google Drive dos documentos. VAZIO/"—" indica que o upload ao Drive falhou (divergência média).
- Ferramenta / Escopo: valores do formulário (ex.: n8n/Python; interno/externo).
- Tipos Projeto: "saving", "receita_incremental", ambos, ou "especial".
- Alguém Fazia?: "sim"/"nao" quando há saving; "—" quando NÃO há saving (ex.: só-receita, especial).
- Saving Horas / Horas em Reais: economia de horas e o R$ bruto delas. 0 quando não há saving.
- Custo Evitado: VALOR R$ mensal do custo evitado (recorrência pontual já vem mensalizada ÷12). 0 quando não há (convenção numérica do sistema; "0" é o esperado, NÃO "—").
- Justificativa Custo Evitado: texto descritivo dos itens; "—" quando não há.
- Custo Mensal ou Pontual: recorrência do custo evitado — "Mensal", "Pontual" ou "Misto" (itens com recorrências diferentes); "—" quando não há custo evitado.
- Saving Reais: LÍQUIDO = Horas em Reais + Custo Evitado − Custo Externo Mensal.
- Tipo de Saving: "mensal"/"pontual"; "—" quando não há saving.
- Memorial de Saving: memorial UNIFICADO (saving + receita) COM R$ (é a planilha de staff). Para projeto SÓ-receita, contém o memorial de receita (isso é esperado). Deve ser coerente com o projeto; não pode estar vazio quando há saving e/ou receita.
- Custo Externo Mensal: R$ do custo externo novo; 0 quando não há.
- Receita Mensal: valor da receita incremental — VALOR CHEIO mesmo quando pontual (não divide). 0 quando não há receita.
- Tipo de Receita: "mensal"/"pontual"; "—" quando não há receita.
- Receita Memorial: memorial de receita; "—" quando não há receita.
- Status: SEMPRE "Pendente" (regra temporária vigente — qualquer outro valor é divergência).
- Ganho Total: métrica de gestão (saving líquido + receita ajustada). Deve ser > 0 quando há ganho.
- Complexidade: "automacao" | "inteligencia" | "autonomia". Se a automação NÃO usa IA como funcionalidade → "automacao". Se usa IA → "inteligencia" (no mínimo) ou "autonomia" (agente que decide/age sozinho). Projeto ESPECIAL não passa pelo analisador (valor pode não refletir nada — não cobrar).
- Diff Horas / Antes, Diff Saving / Antes: colunas MANUAIS — o sistema NUNCA escreve. Devem estar vazias/"—". Se tiverem valor escrito pelo sistema, é divergência.
- Memorial anterior: SÓ na edição = memorial da versão imediatamente anterior. "—" em submissão nova. Numa edição, NÃO pode ser igual ao "Memorial de Saving" atual (tem que ser o anterior).
- Observações: parecer do analisador; deve ser coerente com o projeto (sem alucinação grosseira).
- Contexto do Projeto Especial: preenchido SOMENTE quando Especial? = Sim; "—" caso contrário.
- Especial?: "Sim"/"Não".
- Atualizado Em: carimbo da última escrita do sistema (preenchido).
`.trim();

function fichaCenario(sc, result) {
  const linhas = [];
  linhas.push(`Chave: ${sc.key}`);
  linhas.push(`Tipos de projeto: ${(sc.tipos_projeto ?? []).join(', ') || '(especial)'}`);
  if (sc.especial) linhas.push(`ESPECIAL: sim. Contexto: ${sc.contexto_especial}`);
  if (sc.saving) {
    const ls = (sc.saving.linhas ?? []).map((l) => `${l.cargo} ${l.horas_antes}h→${l.horas_depois}h`).join('; ');
    linhas.push(`Saving: ${ls}; alguém_fazia=${sc.saving.alguem_fazia ?? '—'}; tipo=${sc.saving.tipo_saving}`);
    if (sc.saving.custo_evitado_itens?.length) {
      linhas.push(`Custo evitado (itens): ` + sc.saving.custo_evitado_itens.map((i) => `${i.nome} R$${i.valor}/${i.recorrencia}`).join(' | '));
    } else {
      linhas.push(`Custo evitado: NÃO há`);
    }
    linhas.push(`Custo externo mensal: ${sc.saving.custo_externo_mensal ?? 0}`);
  } else {
    linhas.push(`Saving: NÃO há`);
  }
  if (sc.receita) {
    linhas.push(`Receita: R$${sc.receita.valor_ganho_mensal} tipo=${sc.receita.tipo_saving}`);
  } else {
    linhas.push(`Receita: NÃO há`);
  }
  linhas.push(`Complexidade ALVO: ${sc.complexidade?.alvo} (gate: ${sc.complexidade?.gateHard ?? 'n/a'})`);
  if (result.edicaoDe) {
    linhas.push(`EDIÇÃO de "${result.edicaoDe}" (via ${sc.editVia ?? 'saving'}). Espera-se "Memorial anterior" = memorial da versão pré-edição (NÃO vazio, NÃO igual ao atual).`);
  }
  // Valores determinísticos exatos esperados (do expected.hard) — para o juiz cruzar números.
  const hard = sc.expected?.hard ?? {};
  if (Object.keys(hard).length) {
    linhas.push(`Valores exatos esperados (colunas-chave): ` + Object.entries(hard).map(([k, v]) => `${k}=${v}`).join('; '));
  }
  return linhas.join('\n');
}

const SYSTEM = `Você é um auditor de qualidade RIGOROSO e CÉTICO de uma planilha de projetos de automação.
Sua função é a "verificação da verificação": comparar, COLUNA POR COLUNA, o que foi gravado na planilha contra o comportamento esperado e a ficha do cenário.
Regras:
- Reporte SOMENTE divergências REAIS. Se a coluna está coerente com o esperado, NÃO invente problema.
- Não recalcule aritmética complexa de cabeça; quando houver "valores exatos esperados", confie neles e só compare se a célula bate.
- Preste atenção especial a: Status (deve ser sempre "Pendente"), Complexidade (vs alvo/gate), Memorial de Saving e Receita Memorial (coerência e não-vazio quando aplicável), Memorial anterior (só na edição, ≠ atual), vazamento indevido, colunas manuais (Diff*) que não deveriam ter valor do sistema, e células que deveriam ser "—" ou 0.
- Severidade: "alta" (erro financeiro, Status errado, Complexidade errada pelo gate, memorial trocado/vazio), "media" (URL faltando, convenção, coerência duvidosa), "baixa" (cosmético).
- Responda APENAS JSON válido, sem texto fora do JSON, no formato:
{"veredito":"ok"|"divergencias","achados":[{"coluna":"...","esperado":"...","atual":"...","severidade":"alta|media|baixa","explicacao":"..."}]}`;

async function julgar(sc, result, row) {
  const rowText = Object.keys(row).map((c) => `${c}: ${JSON.stringify(String(row[c] ?? ''))}`).join('\n');
  const user = `LEGENDA (comportamento esperado por coluna):\n${LEGENDA}\n\n` +
    `FICHA DO CENÁRIO:\n${fichaCenario(sc, result)}\n\n` +
    `LINHA REAL NA PLANILHA:\n${rowText}\n\n` +
    `Audite coluna por coluna e responda só o JSON.`;
  const out = await llmChat(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0 },
  );
  let txt = String(out).trim();
  const a = txt.indexOf('{'); const b = txt.lastIndexOf('}');
  if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
  try { return JSON.parse(txt); }
  catch { return { veredito: 'erro', achados: [], _raw: String(out).slice(0, 300) }; }
}

async function main() {
  const rows = await readAllRows();
  const byId = new Map(rows.map((r) => [String(r['ID Projeto'] ?? '').trim().toLowerCase(), r]));

  let totalAlta = 0, totalMedia = 0, totalBaixa = 0, cenarios = 0;
  for (const runId of runIds) {
    const { results } = JSON.parse(readFileSync(new URL(`./.runs/${runId}.json`, import.meta.url), 'utf8'));
    const scById = new Map(buildScenarios(runId).map((s) => [s.key, s]));
    console.log(`\n🧑‍⚖️  LLM-juiz — run "${runId}"\n`);
    for (const r of results) {
      if (r.error || r.baseOnly) continue; // base é sobrescrita pela edição; erro não submeteu
      const sc = scById.get(r.key);
      const row = byId.get(String(r.projeto_id).trim().toLowerCase());
      if (!sc || !row) { console.log(`■ ${r.key}: (sem cenário ou linha) — pulado`); continue; }
      cenarios++;
      const veredito = await julgar(sc, r, row);
      const achados = veredito.achados ?? [];
      const reais = achados.filter((x) => ['alta', 'media', 'baixa'].includes(x.severidade));
      if (!reais.length) { console.log(`■ ${r.key}: ✓ sem divergências`); continue; }
      console.log(`■ ${r.key}: ⚠️ ${reais.length} achado(s)`);
      for (const x of reais) {
        const sev = x.severidade === 'alta' ? '🔴' : x.severidade === 'media' ? '🟡' : '⚪';
        if (x.severidade === 'alta') totalAlta++; else if (x.severidade === 'media') totalMedia++; else totalBaixa++;
        console.log(`   ${sev} [${x.coluna}] esperado=${JSON.stringify(x.esperado)} atual=${JSON.stringify(x.atual)}`);
        console.log(`      ↳ ${x.explicacao}`);
      }
    }
  }
  console.log(`\n──────── Resumo LLM-juiz ────────`);
  console.log(`Cenários auditados: ${cenarios}`);
  console.log(`Achados: 🔴 alta=${totalAlta}  🟡 media=${totalMedia}  ⚪ baixa=${totalBaixa}`);
  process.exit(totalAlta > 0 ? 2 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
