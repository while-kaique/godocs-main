import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock da camada LLM — não queremos rede nos testes. `sanitizeEffort` mockado como identidade
// (o real filtra pela allowlist, e 'low' passa; aqui só precisamos de determinismo).
vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(),
  sanitizeEffort: (v?: string) => v,
}));

import { llmChat } from '@/lib/llm';
import {
  semTracos,
  buildJustificativaPrompt,
  motivoDeterministico,
  type FatosJustificativa,
} from '@/lib/agents/redator-justificativa';
import { redigirJustificativa } from '@/lib/agents/redator-justificativa.functions';

const llmChatMock = vi.mocked(llmChat);

const FATOS: FatosJustificativa = {
  fte: 1.9,
  horasTotais: 418,
  pessoasDeclaradas: 2,
  materialidadeMes: 8000,
  tetoMaterialidade: 5000,
  tipoSaving: 'mensal',
  contrafactual: false,
  apontamentos: [
    {
      especialista: 'Plausibilidade (FTE)',
      motivo:
        'Saving de 418h/mês equivale a ~1,9 pessoas em tempo integral — número alto para 2 pessoas.',
    },
    {
      especialista: 'Financeiro',
      motivo: 'Materialidade de R$ 8.000/mês acima do teto de R$ 5.000/mês – decisão humana.',
    },
  ],
  caminhosCorrecao: ['Confira as horas por cargo', 'Cadastre o gasto no campo de custo evitado'],
};

// ─── (a) semTracos — GUARD determinístico ──────────────────────────────────────

describe('semTracos — remove traços mas preserva hífen de palavra e R$', () => {
  it('remove travessão (—), meia-risca (–) e conector " - "', () => {
    const t = semTracos(
      'Observamos algo — o número é alto – e por isso conferimos. O ganho é R$ 5.000 - confira.',
    );
    expect(t).not.toContain('—');
    expect(t).not.toContain('–');
    expect(t).not.toContain(' - ');
  });

  it('preserva hífen dentro de palavra (e-mail, pré-, contra-) e o R$', () => {
    const t = semTracos('Envie o e-mail com o pré-relatório contra-senha e o valor R$ 1.200.');
    expect(t).toContain('e-mail');
    expect(t).toContain('pré-relatório');
    expect(t).toContain('contra-senha');
    expect(t).toContain('R$ 1.200');
  });

  it('não deixa NENHUM travessão/meia-risca mesmo colados a palavras', () => {
    const t = semTracos('texto—outro texto e 2020–2021 fecham.');
    expect(t).not.toContain('—');
    expect(t).not.toContain('–');
  });

  it('é idempotente e não quebra texto sem traços', () => {
    const limpo = 'Tudo certo, sem nenhum traço aqui. Envie o e-mail.';
    expect(semTracos(limpo)).toBe(limpo);
    expect(semTracos(semTracos(limpo))).toBe(semTracos(limpo));
  });
});

// ─── (b) buildJustificativaPrompt — usa os FATOS, proíbe inventar ──────────────

describe('buildJustificativaPrompt — só os fatos, sem inventar', () => {
  const prompt = buildJustificativaPrompt(FATOS);
  const texto = prompt.map((m) => m.content).join('\n');

  it('inclui os números dos fatos (fte, horas, pessoas, materialidade)', () => {
    expect(texto).toContain('1,9'); // fte
    expect(texto).toContain('418'); // horas
    expect(texto).toContain('2'); // pessoas
    expect(texto).toContain('8.000'); // materialidade em R$
  });

  it('instrui a NÃO inventar valores e a evitar travessão/hífen de conexão', () => {
    expect(texto.toLowerCase()).toContain('invent');
    expect(texto.toLowerCase()).toMatch(/travess|hífen|hifen/);
  });

  it('pede estrutura em 3 partes com passos numerados', () => {
    expect(texto.toLowerCase()).toContain('numerad');
    expect(texto).toMatch(/3/);
  });

  it('inclui os apontamentos dos especialistas', () => {
    expect(texto).toContain('Financeiro');
    expect(texto).toContain('Plausibilidade');
  });
});

// ─── redigirJustificativa — aplica semTracos na saída + fail-safe ──────────────

describe('redigirJustificativa (functions)', () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it('aplica semTracos na saída do LLM (mockado) — sem traços, R$ preservado', async () => {
    llmChatMock.mockResolvedValueOnce(
      'Olá! Observamos um ponto — o valor de R$ 999.999 chamou atenção – confira o e-mail.',
    );
    const out = await redigirJustificativa(FATOS);
    expect(out).not.toContain('—');
    expect(out).not.toContain('–');
    expect(out).not.toContain(' - ');
    expect(out).toContain('R$ 999.999');
    expect(out).toContain('e-mail');
    expect(llmChatMock).toHaveBeenCalledTimes(1);
  });

  it('chama o modelo LEVE canônico (gpt-5.6-luna) com reasoning_effort low', async () => {
    llmChatMock.mockResolvedValueOnce('Texto humano e acolhedor.');
    await redigirJustificativa(FATOS);
    const [, opts] = llmChatMock.mock.calls[0];
    expect(opts?.model).toBe('gpt-5.6-luna');
    expect(opts?.reasoningEffort).toBe('low');
  });

  it('FAIL-SAFE: LLM erro → cai no motivo determinístico (sem traços)', async () => {
    llmChatMock.mockRejectedValueOnce(new Error('proxy caiu'));
    const out = await redigirJustificativa(FATOS);
    // Contém o conteúdo dos apontamentos, mas sem o travessão/meia-risca originais.
    expect(out).toContain('Materialidade de R$ 8.000/mês');
    expect(out).not.toContain('—');
    expect(out).not.toContain('–');
    expect(out.length).toBeGreaterThan(0);
  });

  it('FAIL-SAFE: LLM vazio → cai no determinístico', async () => {
    llmChatMock.mockResolvedValueOnce('   ');
    const out = await redigirJustificativa(FATOS);
    expect(out).toBe(motivoDeterministico(FATOS));
  });
});

// ─── motivoDeterministico — dash-free ──────────────────────────────────────────

describe('motivoDeterministico', () => {
  it('junta os apontamentos e remove traços', () => {
    const m = motivoDeterministico(FATOS);
    expect(m).toContain('Saving de 418h/mês');
    expect(m).not.toContain('—');
    expect(m).not.toContain('–');
  });

  it('sem apontamentos → texto genérico não-vazio', () => {
    const m = motivoDeterministico({ apontamentos: [] });
    expect(m.length).toBeGreaterThan(0);
  });
});
