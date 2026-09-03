// T13 — Cérebro B (ESTRELA) na régua nova, lado PURO (`src/lib/avaliacao/cerebro-estrela.ts`).
//
// Prende o que o plano `docs/plans/regua-estrelas-e-time-unificado.md` (§7 "Cérebro B", §11.3 T13,
// D20) exige do cérebro que dá a estrela 0–5 pelo dossiê:
//   • o PROMPT carrega a régua da FONTE ÚNICA (`descreverReguaAgente()`/`descreverEscape()`),
//     inteira e literal — nada redigitado (D20) — e NÃO leva a distribuição esperada como cota;
//   • a SAÍDA do LLM é normalizada de forma determinística: nota clampada no `TETO_AGENTE`,
//     critério recalculado do nível da nota, "sem evidência citada cai um nível" (D14), piso 0★
//     só com desqualificador das 7 chaves do `PISO_ZERO`, promoção +1 só com dependente NOMEADO,
//     escape só com os DOIS gatilhos citados e a partir do topo da faixa, contestação (D11) só
//     quando a régua chega a MENOS que a nota humana, âncora congelada (D9) quando a nota humana
//     está no escape, categorização fail-closed (inválido → null);
//   • o FALLBACK (LLM sem JSON) é uma saída honesta: nota 0, sem evidência, racional acusando o
//     motivo — nunca inventa critério.
import { describe, it, expect } from 'vitest';
import {
  TETO_AGENTE,
  PISO_ZERO,
  DISTRIBUICAO_ESPERADA,
  descreverReguaAgente,
  descreverEscape,
  nivelDe,
  contarFrases,
  CONTESTACAO_MAX_FRASES,
} from '@/lib/estrelas-regua';
import { dossieDaLinhaPlanilha, dossieParaTexto } from '@/lib/avaliacao/dossie';
import {
  buildPromptEstrela,
  normalizarSaidaEstrela,
  saidaEstrelaFallback,
  type VizinhoTexto,
} from '@/lib/avaliacao/cerebro-estrela';

// ── fixtures ──────────────────────────────────────────────────────────────────

function dossieTextoDeExemplo(): string {
  const d = dossieDaLinhaPlanilha({
    'ID Projeto': 'T13-DOSSIE-001',
    'Nome do Projeto': 'Validador de NF por CNPJ',
    'Nome Completo': 'Fulana da Silva',
    Email: 'fulana@gocase.com',
    Área: 'Fiscal',
    Descrição: 'Bloqueia a emissão de nota fiscal quando o CNPJ do destinatário não é válido.',
    'Especial?': 'Não',
    Estrelas: '',
  });
  expect(d).not.toBeNull();
  return dossieParaTexto(d!);
}

const VIZINHOS: VizinhoTexto[] = [
  { id: 'v1', nome: 'SAIBBI', nota: 3, similaridade: 0.87, resumo: 'Bloqueia pedido sem estoque.' },
  { id: 'v2', nome: 'Damidash', nota: 1, similaridade: 0.62, resumo: 'Painel gerencial de vendas.' },
];

type Bruto = Record<string, unknown>;

/** Saída "bem-comportada" do LLM; cada teste sobrescreve só o que está exercitando. */
function bruto(over: Bruto = {}): Bruto {
  return {
    nota: 3,
    criterio_aplicado: 'Garante',
    desqualificador: null,
    evidencias: ['bloqueia NF sem CNPJ válido'],
    dependente_nomeado: null,
    escape: { indicado: false, evidencias: {} },
    tipo: 'automacao',
    nivel: 'deterministico',
    racional: 'Impede a emissão de nota com CNPJ inválido. A consequência evitada recai sobre o Fiscal.',
    ...over,
  };
}

const CTX = { temVizinhos: true, notaHumana: null as number | null };

function verboMin(nota: number): string {
  return nivelDe(nota)!.verbo.toLowerCase();
}

// ── 1. prompt ─────────────────────────────────────────────────────────────────

describe('buildPromptEstrela — a régua vem da fonte única (D20)', () => {
  const dossieTexto = dossieTextoDeExemplo();

  it('devolve exatamente [system, user]', () => {
    const msgs = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('o system contém, literal e inteiro, descreverReguaAgente() e descreverEscape()', () => {
    const [system] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(system.content).toContain(descreverReguaAgente());
    expect(system.content).toContain(descreverEscape());
    expect(system.content).toContain(PISO_ZERO[0].texto);
  });

  it('o system NÃO leva a distribuição esperada como cota', () => {
    const [system] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(system.content).not.toContain(DISTRIBUICAO_ESPERADA.texto);
    expect(system.content).not.toMatch(/cota/i);
  });

  it('o system exige evidências citadas e deixa o número 6–10 para o comitê', () => {
    const [system] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(system.content).toMatch(/evidencias/);
    expect(system.content).toMatch(/comitê/);
  });

  it('o user carrega o dossiê inteiro e, por vizinho, nome + nota + similaridade', () => {
    const [, user] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(user.content).toContain(dossieTexto);
    for (const v of VIZINHOS) {
      expect(user.content).toContain(v.nome);
      expect(user.content).toContain(String(v.nota));
    }
    // similaridade 0.87 pode sair como "0.87", "0,87" ou "87%"
    expect(user.content).toMatch(/0[.,]87|87\s?%/);
    expect(user.content).toMatch(/0[.,]62|62\s?%/);
  });

  it('sem vizinhos, o user avisa que não há vizinhos', () => {
    const [, user] = buildPromptEstrela({ dossieTexto, vizinhos: [] });
    expect(user.content).toMatch(/sem vizinhos|nenhum vizinho/i);
  });

  it('ferramentasTexto presente entra no system; ausente/null não deixa rastro de tool', () => {
    const ferramentas = 'FERRAMENTAS DISPONÍVEIS: {"acao":"tool","nome":"buscar_doc"}';
    const [comFerr] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS, ferramentasTexto: ferramentas });
    expect(comFerr.content).toContain(ferramentas);

    const [semFerr] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS });
    expect(semFerr.content).not.toContain('acao":"tool');
    const [nullFerr] = buildPromptEstrela({ dossieTexto, vizinhos: VIZINHOS, ferramentasTexto: null });
    expect(nullFerr.content).not.toContain('acao":"tool');
  });
});

// ── 2. caminho feliz ──────────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — caminho feliz', () => {
  it('nota 3 com evidência → garante, sem promoção, sem escape, sem contestação', () => {
    const s = normalizarSaidaEstrela(bruto(), CTX);
    expect(s).not.toBeNull();
    expect(s!.nota).toBe(3);
    expect(s!.criterio_aplicado).toBe('garante');
    expect(s!.desqualificador).toBeNull();
    expect(s!.sem_evidencia).toBe(false);
    expect(s!.evidencias).toEqual(['bloqueia NF sem CNPJ válido']);
    expect(s!.promocao).toEqual({ aplicada: false, dependente: null });
    expect(s!.escape.indicado).toBe(false);
    expect(s!.contestacao).toBeNull();
    expect(s!.ancora_congelada).toBe(false);
    expect(s!.sinais).toEqual({ temEvidenciaCitada: true, temVizinhos: true });
    expect(s!.tipo).toBe('automacao');
    expect(s!.nivel).toBe('deterministico');
  });

  it('sinais.temVizinhos espelha o contexto', () => {
    const s = normalizarSaidaEstrela(bruto(), { temVizinhos: false, notaHumana: null });
    expect(s!.sinais.temVizinhos).toBe(false);
  });
});

// ── 3. coerência nota ↔ critério ──────────────────────────────────────────────

describe('normalizarSaidaEstrela — coerência nota ↔ critério', () => {
  it('critério incoerente com a nota é RECALCULADO do nível da nota', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: 2, criterio_aplicado: 'Assume' }), CTX);
    expect(s!.nota).toBe(2);
    expect(s!.criterio_aplicado).toBe(verboMin(2));
    expect(s!.criterio_aplicado).toBe('executa');
  });

  it('nota acima do teto do agente clampa em 5 e vira "assume"', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: 7, criterio_aplicado: 'Garante' }), CTX);
    expect(s!.nota).toBe(TETO_AGENTE);
    expect(s!.criterio_aplicado).toBe('assume');
  });

  it('nota negativa vira 0', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: -1, desqualificador: 'marginal' }), CTX);
    expect(s!.nota).toBe(0);
    expect(s!.criterio_aplicado).toBe('experimenta');
  });

  it('nota em string numérica é aceita', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: '3' }), CTX);
    expect(s!.nota).toBe(3);
    expect(s!.criterio_aplicado).toBe('garante');
  });

  it('nota ausente ou NaN → saída inválida (null)', () => {
    const semNota = bruto();
    delete semNota.nota;
    expect(normalizarSaidaEstrela(semNota, CTX)).toBeNull();
    expect(normalizarSaidaEstrela(bruto({ nota: 'três' }), CTX)).toBeNull();
    expect(normalizarSaidaEstrela(bruto({ nota: Number.NaN }), CTX)).toBeNull();
  });

  it('entrada que não é objeto → null', () => {
    expect(normalizarSaidaEstrela(null, CTX)).toBeNull();
    expect(normalizarSaidaEstrela('texto solto', CTX)).toBeNull();
  });
});

// ── 4. D14 — sem evidência, cai um nível ──────────────────────────────────────

describe('normalizarSaidaEstrela — D14: sem evidência citada o critério não vale', () => {
  it.each([
    ['evidencias: []', { evidencias: [] }],
    ['evidencias ausente', { evidencias: undefined }],
    ['evidencias só com strings vazias', { evidencias: ['', '   '] }],
  ])('nota 3 com %s → nota 2, executa, sem_evidencia', (_rotulo, over) => {
    const b = bruto(over as Bruto);
    if (b.evidencias === undefined) delete b.evidencias;
    const s = normalizarSaidaEstrela(b, CTX);
    expect(s).not.toBeNull();
    expect(s!.nota).toBe(2);
    expect(s!.criterio_aplicado).toBe('executa');
    expect(s!.sem_evidencia).toBe(true);
    expect(s!.sinais.temEvidenciaCitada).toBe(false);
  });

  it('nota 1 sem evidência → 0 com "experimenta"', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: 1, criterio_aplicado: 'Informa', evidencias: [] }), CTX);
    expect(s!.nota).toBe(0);
    expect(s!.criterio_aplicado).toBe('experimenta');
    expect(s!.sem_evidencia).toBe(true);
  });

  it('nota 0 sem evidência fica 0 e NÃO é marcada como sem_evidencia (zero não cita critério)', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 0, criterio_aplicado: 'Experimenta', desqualificador: 'fora_de_uso', evidencias: [] }),
      CTX,
    );
    expect(s!.nota).toBe(0);
    expect(s!.sem_evidencia).toBe(false);
    expect(s!.criterio_aplicado).toBe('experimenta');
  });
});

// ── 5. piso 0★ e desqualificador ──────────────────────────────────────────────

describe('normalizarSaidaEstrela — desqualificador só existe no zero e só das 7 chaves', () => {
  it.each(PISO_ZERO.map((p) => p.chave))('nota 0 com desqualificador "%s" é preservado', (chave) => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 0, criterio_aplicado: 'Experimenta', desqualificador: chave, evidencias: [] }),
      CTX,
    );
    expect(s!.nota).toBe(0);
    expect(s!.desqualificador).toBe(chave);
    expect(s!.criterio_aplicado).toBe('experimenta');
  });

  it('nota 0 com chave desconhecida → desqualificador null (não inventa)', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 0, criterio_aplicado: 'Experimenta', desqualificador: 'nao_gostei', evidencias: [] }),
      CTX,
    );
    expect(s!.nota).toBe(0);
    expect(s!.desqualificador).toBeNull();
    expect(s!.criterio_aplicado).toBe('experimenta');
  });

  it('nota 0 sem desqualificador → null', () => {
    const b = bruto({ nota: 0, criterio_aplicado: 'Experimenta', evidencias: [] });
    delete b.desqualificador;
    const s = normalizarSaidaEstrela(b, CTX);
    expect(s!.desqualificador).toBeNull();
    expect(s!.criterio_aplicado).toBe('experimenta');
  });

  it('nota > 0 com desqualificador informado → null (só vale no zero)', () => {
    const s = normalizarSaidaEstrela(bruto({ nota: 3, desqualificador: 'marginal' }), CTX);
    expect(s!.nota).toBe(3);
    expect(s!.desqualificador).toBeNull();
  });
});

// ── 6. promoção +1 ────────────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — promoção só com dependente NOMEADO', () => {
  it('dependente nomeado com nota 2 e evidência → 3, "garante", promoção registrada', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 2, criterio_aplicado: 'Executa', dependente_nomeado: 'Painel de S&OE' }),
      CTX,
    );
    expect(s!.nota).toBe(3);
    expect(s!.criterio_aplicado).toBe('garante');
    expect(s!.promocao).toEqual({ aplicada: true, dependente: 'Painel de S&OE' });
  });

  it('no teto (5) a promoção não se aplica', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 5, criterio_aplicado: 'Assume', dependente_nomeado: 'Painel de S&OE' }),
      CTX,
    );
    expect(s!.nota).toBe(5);
    expect(s!.promocao.aplicada).toBe(false);
  });

  it.each([
    'poderá ser consultado por outras áreas',
    'abre portas para novos usos',
  ])('texto de promessa ("%s") NÃO promove e dependente fica null', (promessa) => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 2, criterio_aplicado: 'Executa', dependente_nomeado: promessa }),
      CTX,
    );
    expect(s!.nota).toBe(2);
    expect(s!.promocao).toEqual({ aplicada: false, dependente: null });
  });

  it.each([null, '', '   '])('dependente %j não promove', (dep) => {
    const s = normalizarSaidaEstrela(bruto({ nota: 2, criterio_aplicado: 'Executa', dependente_nomeado: dep }), CTX);
    expect(s!.nota).toBe(2);
    expect(s!.promocao).toEqual({ aplicada: false, dependente: null });
  });
});

// ── 7. escape ─────────────────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — escape só com os DOIS gatilhos e a partir do topo', () => {
  const doisGatilhos = {
    nao_existiria: 'a operação de cotação automática não existiria sem ele',
    sem_volta: 'o processo manual de cotação foi desativado e não há mais planilha',
  };

  it('indicado com as duas evidências e nota 5 → válido, nota fica 5 (o agente não fatia 6–10)', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 5, criterio_aplicado: 'Assume', escape: { indicado: true, evidencias: doisGatilhos } }),
      CTX,
    );
    expect(s!.nota).toBe(5);
    expect(s!.escape.indicado).toBe(true);
    expect(s!.escape.valido).toBe(true);
    expect(s!.escape.evidencias).toEqual(doisGatilhos);
  });

  it('indicado com só uma evidência → inválido E não indicado (vira 5★ comum)', () => {
    const s = normalizarSaidaEstrela(
      bruto({
        nota: 5,
        criterio_aplicado: 'Assume',
        escape: { indicado: true, evidencias: { nao_existiria: doisGatilhos.nao_existiria } },
      }),
      CTX,
    );
    expect(s!.nota).toBe(5);
    expect(s!.escape.valido).toBe(false);
    expect(s!.escape.indicado).toBe(false);
  });

  it('indicado com nota 3 → não indicado, nota fica 3', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 3, criterio_aplicado: 'Garante', escape: { indicado: true, evidencias: doisGatilhos } }),
      CTX,
    );
    expect(s!.nota).toBe(3);
    expect(s!.escape.indicado).toBe(false);
    expect(s!.escape.valido).toBe(false);
  });

  it('escape ausente na saída → { indicado:false, valido:false }', () => {
    const b = bruto();
    delete b.escape;
    const s = normalizarSaidaEstrela(b, CTX);
    expect(s!.escape.indicado).toBe(false);
    expect(s!.escape.valido).toBe(false);
  });
});

// ── 8. contestação (D11) ──────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — contestação (D11) só quando a régua chega a MENOS', () => {
  const duasFrases = 'Não há escolha que compromete recurso. A automação apenas executa a rotina.';

  it('nota humana 4, régua 2 com gatilho informado → contestação montada', () => {
    const s = normalizarSaidaEstrela(
      bruto({
        nota: 2,
        criterio_aplicado: 'Executa',
        evidencias: ['roda a rotina toda madrugada sem escolha de parâmetro'],
        gatilho_que_falhou: 'decide: não há escolha que compromete recurso',
        racional: duasFrases,
      }),
      { temVizinhos: true, notaHumana: 4 },
    );
    expect(s!.nota).toBe(2);
    expect(s!.contestacao).not.toBeNull();
    expect(s!.contestacao).toMatchObject({
      notaHumana: 4,
      notaRegua: 2,
      criterioAplicado: 'executa',
      gatilhoQueFalhou: 'decide: não há escolha que compromete recurso',
      evidencia: 'roda a rotina toda madrugada sem escolha de parâmetro',
    });
    expect(contarFrases(s!.contestacao!.racional)).toBeLessThanOrEqual(CONTESTACAO_MAX_FRASES);
  });

  it('racional de 4 frases → a contestação EXISTE e o racional dela é cortado em 2 frases', () => {
    const quatro =
      'Primeira frase sobre a rotina. Segunda frase sobre o parâmetro. Terceira frase sobre a área. Quarta frase de sobra.';
    const s = normalizarSaidaEstrela(
      bruto({
        nota: 2,
        criterio_aplicado: 'Executa',
        gatilho_que_falhou: 'decide: não há escolha que compromete recurso',
        racional: quatro,
      }),
      { temVizinhos: true, notaHumana: 4 },
    );
    expect(s!.contestacao).not.toBeNull();
    expect(contarFrases(s!.contestacao!.racional)).toBeLessThanOrEqual(CONTESTACAO_MAX_FRASES);
    expect(s!.contestacao!.racional).toContain('Primeira frase sobre a rotina');
    expect(s!.contestacao!.racional).toContain('Segunda frase sobre o parâmetro');
    expect(s!.contestacao!.racional).not.toContain('Terceira frase');
  });

  it('régua igual à nota humana → sem contestação', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 2, criterio_aplicado: 'Executa', gatilho_que_falhou: 'x', racional: duasFrases }),
      { temVizinhos: true, notaHumana: 2 },
    );
    expect(s!.contestacao).toBeNull();
  });

  it('régua ACIMA da nota humana → sem contestação (subir âncora é do comitê)', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 3, criterio_aplicado: 'Garante', gatilho_que_falhou: 'x', racional: duasFrases }),
      { temVizinhos: true, notaHumana: 1 },
    );
    expect(s!.contestacao).toBeNull();
  });

  it('sem gatilho_que_falhou usa o criterio_aplicado como gatilho', () => {
    const s = normalizarSaidaEstrela(
      bruto({ nota: 2, criterio_aplicado: 'Executa', racional: duasFrases }),
      { temVizinhos: true, notaHumana: 4 },
    );
    expect(s!.contestacao).not.toBeNull();
    expect(s!.contestacao!.gatilhoQueFalhou).toBe('executa');
  });

  it('sem nota humana nunca há contestação', () => {
    const s = normalizarSaidaEstrela(bruto({ gatilho_que_falhou: 'x', racional: duasFrases }), CTX);
    expect(s!.contestacao).toBeNull();
  });
});

// ── 9. âncora congelada (D9) ──────────────────────────────────────────────────

describe('normalizarSaidaEstrela — âncora congelada (D9)', () => {
  it('nota humana 8 → ancora_congelada e a contestação continua sendo montada (registro para o comitê)', () => {
    const s = normalizarSaidaEstrela(
      bruto({
        nota: 3,
        criterio_aplicado: 'Garante',
        gatilho_que_falhou: 'nao_existiria: a atividade existia antes, só era manual',
        racional: 'A atividade já existia antes. O projeto só a acelerou.',
      }),
      { temVizinhos: true, notaHumana: 8 },
    );
    expect(s!.ancora_congelada).toBe(true);
    expect(s!.nota).toBe(3);
    expect(s!.contestacao).not.toBeNull();
    expect(s!.contestacao!.notaHumana).toBe(8);
    expect(s!.contestacao!.notaRegua).toBe(3);
  });

  it('nota humana 5 → não é âncora congelada', () => {
    const s = normalizarSaidaEstrela(bruto(), { temVizinhos: true, notaHumana: 5 });
    expect(s!.ancora_congelada).toBe(false);
  });

  it('sem nota humana → não é âncora congelada', () => {
    const s = normalizarSaidaEstrela(bruto(), CTX);
    expect(s!.ancora_congelada).toBe(false);
  });
});

// ── 10. categorização ─────────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — categorização fail-closed', () => {
  it('tipo/nível válidos passam', () => {
    const s = normalizarSaidaEstrela(bruto({ tipo: 'agente', nivel: 'autonomo' }), CTX);
    expect(s!.tipo).toBe('agente');
    expect(s!.nivel).toBe('autonomo');
  });

  it('tipo/nível inválidos → null (não inventa)', () => {
    const s = normalizarSaidaEstrela(bruto({ tipo: 'qualquer', nivel: 'x' }), CTX);
    expect(s!.tipo).toBeNull();
    expect(s!.nivel).toBeNull();
  });

  it('tipo/nível ausentes → null', () => {
    const b = bruto();
    delete b.tipo;
    delete b.nivel;
    const s = normalizarSaidaEstrela(b, CTX);
    expect(s!.tipo).toBeNull();
    expect(s!.nivel).toBeNull();
  });
});

// ── 11. racional ──────────────────────────────────────────────────────────────

describe('normalizarSaidaEstrela — racional', () => {
  it('racional acima de 600 chars é cortado em 600 e termina com "…"', () => {
    const longo = 'a'.repeat(900);
    const s = normalizarSaidaEstrela(bruto({ racional: longo }), CTX);
    expect(s!.racional.length).toBeLessThanOrEqual(600);
    expect(s!.racional.endsWith('…')).toBe(true);
  });

  it('racional ausente → string padrão não vazia', () => {
    const b = bruto();
    delete b.racional;
    const s = normalizarSaidaEstrela(b, CTX);
    expect(typeof s!.racional).toBe('string');
    expect(s!.racional.trim().length).toBeGreaterThan(0);
  });
});

// ── 12. fallback ──────────────────────────────────────────────────────────────

describe('saidaEstrelaFallback — quando o LLM não devolveu JSON', () => {
  it('é uma saída honesta: nota 0, experimenta, sem evidência, racional acusa fallback e motivo', () => {
    const s = saidaEstrelaFallback('resposta não era JSON', { temVizinhos: false, notaHumana: null });
    expect(s.nota).toBe(0);
    expect(s.criterio_aplicado).toBe('experimenta');
    expect(s.desqualificador).toBeNull();
    expect(s.sem_evidencia).toBe(true);
    expect(s.evidencias).toEqual([]);
    expect(s.racional).toMatch(/fallback/i);
    expect(s.racional).toContain('resposta não era JSON');
    expect(s.sinais).toEqual({ temEvidenciaCitada: false, temVizinhos: false });
    expect(s.escape.indicado).toBe(false);
    expect(s.escape.valido).toBe(false);
    expect(s.promocao).toEqual({ aplicada: false, dependente: null });
    expect(s.contestacao).toBeNull();
    expect(s.tipo).toBeNull();
    expect(s.nivel).toBeNull();
  });

  it('respeita temVizinhos do contexto', () => {
    const s = saidaEstrelaFallback('timeout', { temVizinhos: true, notaHumana: null });
    expect(s.sinais.temVizinhos).toBe(true);
  });
});
