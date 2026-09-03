// Espelho da planilha no SQLite — a peça que faz as telas pararem de ler o Google Sheets
// em tempo de request. Banco REAL em memória; nada de rede aqui.
//
// O que cada bloco protege:
//  • hash-gate     — o cron de 5 min só existe porque linha igual NÃO gera escrita
//  • patch         — a escrita recém-feita não pode ser desfeita por um sync que começou
//                    ANTES dela (era o "status voltava atrás" do cache em memória)
//  • recorte       — `COLUNAS_RESUMO` tem de cobrir tudo que o `mapResumo` lê, senão a
//                    listagem mostra vazio enquanto a ficha mostra o valor
//  • remoção       — projeto apagado da planilha some do espelho (o "projeto morto na lista")
import { describe, it, expect, beforeEach } from 'vitest';
import { criarDbMemoria } from './helpers/db-memoria';
import {
  espelharLinhas,
  espelharEscrita,
  removerEspelhoAusentes,
  lerResumosEspelho,
  lerLinhaEspelho,
  lerLinhasEspelho,
  hashLinha,
  carimboEspelhoMs,
} from '@/lib/sheet-espelho';
import { getEspelhoIndice } from '@/integrations/db/client.server';
import { mapResumo, recortarResumo, COLUNAS_RESUMO } from '@/lib/dashboard-resumo';
import type { SheetRow } from '@/lib/google/sheets';

function linha(over: Record<string, string> = {}): SheetRow {
  return {
    'ID Projeto': 'legado-148',
    Projeto: 'Portal de Reembolsos',
    'Nome Completo': 'Helén Sá',
    Email: 'helen@gocase.com',
    Área: 'CSC',
    Status: 'Pendente',
    'Data Submissão': '12/05/2026',
    'Impacto Líquido': 'R$ 5.700,00',
    Ferramenta: 'Python',
    'Memorial de Saving': 'texto longo do memorial '.repeat(50),
    ...over,
  } as SheetRow;
}

beforeEach(async () => {
  await criarDbMemoria();
});

describe('espelharLinhas — grava a planilha no espelho', () => {
  it('espelha as linhas com ID e ignora as sem ID (separador/rodapé)', async () => {
    const r = await espelharLinhas([linha(), { Projeto: 'sem id' } as SheetRow], Date.now());
    expect(r.espelhados).toBe(1);
    expect((await getEspelhoIndice()).length).toBe(1);
  });

  it('id em MAIÚSCULAS da planilha vira chave minúscula (match case-insensitive)', async () => {
    await espelharLinhas([linha({ 'ID Projeto': 'LEGADO-148' })], Date.now());
    expect(await lerLinhaEspelho('legado-148')).not.toBeNull();
    expect(await lerLinhaEspelho('LEGADO-148')).not.toBeNull();
  });

  it('2ª passada com a MESMA linha não escreve nada (é o que deixa o cron de 5 min barato)', async () => {
    const rows = [linha()];
    const primeira = await espelharLinhas(rows, Date.now());
    const segunda = await espelharLinhas(rows, Date.now());
    expect(primeira.espelhados).toBe(1);
    expect(segunda.espelhados).toBe(0);
    expect(segunda.ignorados).toBe(1);
  });

  it('célula alterada na planilha gera escrita', async () => {
    await espelharLinhas([linha()], Date.now());
    const r = await espelharLinhas([linha({ Status: 'Aprovado' })], Date.now());
    expect(r.espelhados).toBe(1);
    expect((await lerLinhaEspelho('legado-148'))?.['Status']).toBe('Aprovado');
  });

  it('hash muda com o conteúdo e não depende da ORDEM das chaves', () => {
    const a = { Projeto: 'X', Status: 'Pendente' };
    const b = { Status: 'Pendente', Projeto: 'X' };
    expect(hashLinha(a)).toBe(hashLinha(b));
    expect(hashLinha(a)).not.toBe(hashLinha({ ...a, Status: 'Aprovado' }));
  });
});

describe('patch — a escrita recém-feita sobrevive a um sync que começou antes dela', () => {
  it('sync que COMEÇOU antes da escrita não desfaz o status novo', async () => {
    // Estado inicial na planilha e no espelho.
    await espelharLinhas([linha({ Status: 'Pendente' })], Date.now() - 60_000);

    // A leitura do sync começa AGORA e traz "Pendente" (a célula antiga)…
    const inicioLeitura = Date.now();
    // …e no meio dela a triagem grava "Aprovado" na planilha + remenda o espelho.
    await espelharEscrita('legado-148', { Status: 'Aprovado' });
    // O sync termina e instala o snapshot que leu.
    await espelharLinhas([linha({ Status: 'Pendente' })], inicioLeitura);

    expect((await lerLinhaEspelho('legado-148'))?.['Status']).toBe('Aprovado');
  });

  it('sync que começou DEPOIS da escrita manda na célula (a planilha já a refletia)', async () => {
    await espelharEscrita('legado-148', { Status: 'Aprovado' });
    // Leitura posterior à escrita: o que vier da planilha é a verdade — inclusive uma
    // correção que a triagem fez direto na aba depois disso.
    await espelharLinhas([linha({ Status: 'Reprovado' })], Date.now() + 1000);
    expect((await lerLinhaEspelho('legado-148'))?.['Status']).toBe('Reprovado');
  });

  it('remendo expirado limpa o patch (não fica remendando para sempre)', async () => {
    await espelharEscrita('legado-148', { Status: 'Aprovado' });
    await espelharLinhas([linha({ Status: 'Aprovado' })], Date.now() + 1000);
    const [reg] = await getEspelhoIndice();
    expect(reg.patch).toBeNull();
    expect(reg.escrito_em).toBeNull();
  });

  it('só as células gravadas são remendadas — o resto da linha continua o da planilha', async () => {
    await espelharLinhas([linha()], Date.now() - 60_000);
    const inicio = Date.now();
    await espelharEscrita('legado-148', { Status: 'Aprovado' });
    await espelharLinhas([linha({ Status: 'Pendente', Projeto: 'Nome novo na planilha' })], inicio);
    const l = await lerLinhaEspelho('legado-148');
    expect(l?.['Status']).toBe('Aprovado'); // nosso
    expect(l?.['Projeto']).toBe('Nome novo na planilha'); // da planilha
  });
});

describe('espelharEscrita — nossa escrita aparece na tela sem esperar o cron', () => {
  it('linha NOVA (append da submissão) nasce no espelho com o Status gravado', async () => {
    await espelharEscrita(
      'abc123',
      { 'ID Projeto': 'abc123', Projeto: 'Bot de Faturamento', Status: 'Pendente' },
      { novaLinha: true },
    );
    const { linhas } = await lerResumosEspelho();
    expect(mapResumo(linhas[0])?.status).toBe('Pendente');
  });

  it('escrita parcial em projeto ainda ausente do espelho não perde o id', async () => {
    await espelharEscrita('xyz789', { Status: 'Descontinuado' });
    const l = await lerLinhaEspelho('xyz789');
    expect(l?.['ID Projeto']).toBe('xyz789');
    expect(l?.['Status']).toBe('Descontinuado');
  });

  it('valores nulos/ausentes são ignorados (o `undefined` que PRESERVA a célula do líder)', async () => {
    await espelharLinhas([linha({ 'Aprovação do Líder': 'Pré-aprovado' })], Date.now());
    await espelharEscrita('legado-148', {
      Status: 'Aprovado',
      'Aprovação do Líder': undefined,
      'Justificativa Aprovação do Líder': null,
    });
    const l = await lerLinhaEspelho('legado-148') as Record<string, string>;
    expect(l['Aprovação do Líder']).toBe('Pré-aprovado');
  });

  it('nunca lança quando o banco falha (a ação do usuário não pode cair por causa do espelho)', async () => {
    const { setDb } = await import('@/integrations/db/client.server');
    await setDb({
      async query() {
        throw new Error('banco fora');
      },
      async exec() {
        throw new Error('banco fora');
      },
    });
    await expect(espelharEscrita('legado-148', { Status: 'Aprovado' })).resolves.toBeUndefined();
  });
});

describe('recorte da listagem (COLUNAS_RESUMO)', () => {
  it('o resumo produz o MESMO `mapResumo` que a linha cheia — coluna nova não pode faltar na lista', () => {
    const cheia = linha({
      'Impacto Bruto': '1.234,56',
      'Receita Incremental': '2.000,00',
      'Custo Evitado Horas': '60',
      Complexidade: 'automacao',
      'Tipos de Ganho': 'saving',
      'Especial?': 'Não',
      'Atualizado Em': '23/06/2026 10:00',
      Observações: 'parecer do analisador',
      'Aprovação do Líder': 'Pré-aprovado',
    });
    expect(mapResumo(recortarResumo(cheia) as SheetRow)).toEqual(mapResumo(cheia));
  });

  it('o recorte NÃO carrega os memoriais (é o que mantém a listagem enxuta)', () => {
    const recorte = recortarResumo(linha());
    expect('Memorial de Saving' in recorte).toBe(false);
    expect(JSON.stringify(recorte).length).toBeLessThan(600);
  });

  it('cabeçalho REAL sem acento ("Aprovação do Lider") entra no recorte', () => {
    const recorte = recortarResumo(linha({ 'Aprovação do Lider': 'Pré-pendente' }) as SheetRow);
    expect(recorte['Aprovação do Lider']).toBe('Pré-pendente');
    expect(COLUNAS_RESUMO).toContain('Aprovação do Líder');
  });
});

describe('remoção do que sumiu da planilha', () => {
  it('remove do espelho o projeto ausente e mantém os presentes', async () => {
    await espelharLinhas([linha(), linha({ 'ID Projeto': 'legado-149' })], Date.now());
    const removidos = await removerEspelhoAusentes(new Set(['legado-148']));
    expect(removidos).toBe(1);
    expect(await lerLinhaEspelho('legado-149')).toBeNull();
    expect(await lerLinhaEspelho('legado-148')).not.toBeNull();
  });

  it('conjunto VAZIO não remove nada (leitura suspeita nunca esvazia o espelho)', async () => {
    await espelharLinhas([linha()], Date.now());
    expect(await removerEspelhoAusentes(new Set())).toBe(0);
    expect((await getEspelhoIndice()).length).toBe(1);
  });
});

describe('leitura por ids (Meus Projetos)', () => {
  it('devolve só os projetos pedidos, em chave minúscula', async () => {
    await espelharLinhas(
      [linha(), linha({ 'ID Projeto': 'legado-149' }), linha({ 'ID Projeto': 'legado-150' })],
      Date.now(),
    );
    const m = await lerLinhasEspelho(['LEGADO-148', 'legado-150', 'nao-existe']);
    expect([...m.keys()].sort()).toEqual(['legado-148', 'legado-150']);
  });

  it('lista de ids vazia não consulta nada', async () => {
    expect((await lerLinhasEspelho([])).size).toBe(0);
  });
});

describe('carimboEspelhoMs', () => {
  it('lê ISO e o formato do SQLite (`datetime(now)`, UTC sem Z) como UTC', () => {
    expect(carimboEspelhoMs('2026-08-11T12:00:00.000Z')).toBe(Date.parse('2026-08-11T12:00:00Z'));
    // ⚠️ Sem o "Z", o JS leria como hora LOCAL e a idade do espelho erraria por 3 h.
    expect(carimboEspelhoMs('2026-08-11 12:00:00')).toBe(Date.parse('2026-08-11T12:00:00Z'));
    expect(carimboEspelhoMs(null)).toBeNull();
    expect(carimboEspelhoMs('')).toBeNull();
  });
});
