// Canário do SCHEMA: as colunas da v2 aterrissam de verdade em `projetos`?
//
// Existe por causa de um caminho de falha MUDO. O `initSchema` aplica cada entrada de
// `MIGRATIONS` dentro de um `try/catch` que engole o erro — a intenção é ignorar
// "duplicate column" em banco que já migrou, mas o catch não distingue isso de um ALTER
// com erro de digitação, tipo inválido ou tabela errada. Nesses casos a coluna
// simplesmente NÃO existe, `initSchema` termina sem reclamar, e o defeito só aparece
// muito depois, como um valor que não persiste.
//
// Não havia canário de schema no repo (nada usava `PRAGMA table_info`), então esquecer
// ou errar uma migração não falhava a suíte. Este teste fecha essa lacuna para as
// colunas do GoDocs v2 — ver `src/lib/ganhos.ts` (o modelo) e a T3 do plano
// `docs/plans/godocs-v2-submissao-deterministica.md`.
//
// ⚠️ Coluna nova da v2 entra NA LISTA abaixo no mesmo commit que a acrescenta em
// `MIGRATIONS`. É o mesmo par que o repo já exige em outros lugares (coluna no recorte
// do espelho ↔ bump da versão do recorte).
import { describe, it, expect } from 'vitest';
import { criarDbMemoria } from './helpers/db-memoria';

/** As 19 colunas que a T3 acrescentou, agrupadas como o formulário as preenche. */
const COLUNAS_V2 = [
  // a seleção das 4 categorias (JSON array)
  'ganho_categorias',
  // saving efetivado — a despesa existia e parou (pede evidência, pesa 100%)
  'saving_efetivado_valor',
  'saving_efetivado_frequencia',
  'saving_efetivado_evidencia',
  'saving_efetivado_desde',
  // custo evitado — a despesa nunca nasceu (sem evidência, pesa 50%), dois braços
  'custo_evitado_frequencia',
  'custo_evitado_horas_linhas',
  'custo_evitado_horas_valor',
  'custo_evitado_nao_contratado',
  'custo_evitado_racional',
  // receita incremental — na v1 não tinha coluna nenhuma (vivia só no blob da doc)
  'receita_incremental_valor',
  'receita_incremental_frequencia',
  'receita_incremental_racional',
  'receita_incremental_tipo',
  // ganho imensurável — fora de toda conta, representado pela estrela
  'ganho_imensuravel_racional',
  // custo para rodar — a fusão das 2 linhas de custo da v1
  'custo_rodar_itens',
  // impacto materializado (derivado de `src/lib/impacto.ts`, nunca calculado no call site)
  'impacto_bruto',
  'impacto_liquido',
  'impacto_liquido_mensal',
] as const;

async function colunasDeProjetos(): Promise<string[]> {
  const db = await criarDbMemoria();
  const info = db.prepare('PRAGMA table_info(projetos)').all() as { name: string }[];
  return info.map((c) => c.name);
}

describe('schema — as colunas do GoDocs v2 existem em `projetos` após o initSchema', () => {
  it('nenhuma das 19 colunas da v2 falta (o catch mudo das MIGRATIONS não escondeu nada)', async () => {
    const colunas = await colunasDeProjetos();
    const faltando = COLUNAS_V2.filter((c) => !colunas.includes(c));
    expect(faltando).toEqual([]);
  });

  it('a lista do canário não tem duplicata (senão ela mesma esconderia um esquecimento)', () => {
    expect(new Set(COLUNAS_V2).size).toBe(COLUNAS_V2.length);
  });

  // As colunas da v1 seguem servindo prod e o staging v1: as duas gerações CONVIVEM até
  // a T9 aposentar a v1. Uma migração da v2 que renomeasse ou derrubasse uma delas
  // quebraria produção, e o catch mudo faria isso em silêncio.
  it('as colunas de ganho da v1 continuam intactas (as gerações convivem)', async () => {
    const colunas = await colunasDeProjetos();
    for (const antiga of [
      'saving_horas',
      'saving_reais',
      'tipo_saving',
      'custo_externo_mensal',
      'custo_evitado',
      'custo_evitado_justificativa',
      'custo_evitado_itens',
      'custo_projeto',
      'custo_projeto_itens',
      'ganho_total_mensal',
      'memorial_calculo',
      'tipos_projeto',
    ]) {
      expect(colunas).toContain(antiga);
    }
  });

  // O valor que o modelo grava tem de caber na coluna que o ALTER criou: `REAL` para
  // dinheiro e `TEXT` para o JSON dos itens. Um tipo trocado no ALTER passaria pelo
  // teste de existência acima e só apareceria na gravação.
  it('as colunas aceitam o que o modelo grava (dinheiro numérico, itens em JSON)', async () => {
    const db = await criarDbMemoria();
    db.prepare(
      `INSERT INTO projetos (id, nome, responsavel_nome, responsavel_email, ferramenta)
       VALUES ('canario-v2', 'Canário', 'Fulano', 'fulano@exemplo.com', 'n8n')`,
    ).run();
    db.prepare(
      `UPDATE projetos SET ganho_categorias = ?, saving_efetivado_valor = ?,
       custo_rodar_itens = ?, impacto_liquido_mensal = ? WHERE id = 'canario-v2'`,
    ).run(
      '["saving_efetivado"]',
      12000,
      '[{"nome":"API de OCR","valor":600,"frequencia":"mensal","o_que_e":"Leitura das notas."}]',
      11400,
    );
    const lido = db
      .prepare(
        `SELECT ganho_categorias, saving_efetivado_valor, custo_rodar_itens, impacto_liquido_mensal
         FROM projetos WHERE id = 'canario-v2'`,
      )
      .get() as Record<string, unknown>;

    expect(JSON.parse(String(lido.ganho_categorias))).toEqual(['saving_efetivado']);
    expect(lido.saving_efetivado_valor).toBe(12000);
    expect(JSON.parse(String(lido.custo_rodar_itens))).toHaveLength(1);
    expect(lido.impacto_liquido_mensal).toBeCloseTo(11400, 6);
  });
});
