import { describe, it, expect } from 'vitest';
import { buildSystemPromptEspecial } from '@/lib/agents/especial-classificador';
import { buildPromptEstrela } from '@/lib/avaliacao/cerebro-estrela';
import { REGRAS_DO_PORQUE } from '@/lib/estrelas-regua';

/**
 * ⚠️ O texto que a pessoa lê não pode carregar o vocabulário do CÓDIGO. "falta prova de que o
 * modo anterior deixou de existir" é como o gatilho 2 está escrito em `estrelas-regua.ts` —
 * quem abre a tabela não faz ideia do que isso quer dizer. Este teste trava a instrução.
 */
const PROIBIDAS = ['gatilho', 'escape', 'piso', 'desqualificador', 'dependente nomeado', 'modo anterior deixou de existir'];

describe('o porquê é escrito em português comum', () => {
  it('os 2 prompts proíbem o vocabulário interno da régua', () => {
    for (const p of [buildSystemPromptEspecial(), buildPromptEstrela({ dossieTexto: 'x', vizinhos: [] }).map((m) => m.content).join('\n')]) {
      expect(p).toContain('PROIBIDO usar o vocabulário interno');
      for (const t of PROIBIDAS) expect(p.toLowerCase()).toContain(t.toLowerCase());
      // e traz a tradução, não só a proibição
      expect(p).toContain('ninguém mais faz esse trabalho do jeito antigo');
    }
  });

  // ⚠️ O bloco estava DIGITADO nos dois prompts, palavra por palavra. Duas cópias divergem na
  // primeira vez que alguém melhora uma frase, e este texto é o único que a triagem lê de fato.
  it('os 2 prompts usam a MESMA fonte, não uma cópia cada', () => {
    const classificador = buildSystemPromptEspecial();
    const cerebro = buildPromptEstrela({ dossieTexto: 'x', vizinhos: [] }).map((m) => m.content).join('\n');
    expect(classificador).toContain(REGRAS_DO_PORQUE);
    expect(cerebro).toContain(REGRAS_DO_PORQUE);
  });

  // Decisão do Luis, 03/09/2026: linguagem natural que um leigo entenda de primeira, sem
  // travessão nem hífen como pontuação, e CURTO — explicar fácil é escrever menos, não mais.
  it('as regras cobram linguagem simples, curta e sem travessão', () => {
    expect(REGRAS_DO_PORQUE).toMatch(/LINGUAGEM NATURAL/);
    expect(REGRAS_DO_PORQUE).toMatch(/travessão/);
    expect(REGRAS_DO_PORQUE).toMatch(/hífen/);
    expect(REGRAS_DO_PORQUE).toMatch(/CURTO/);
    // não basta proibir: tem de dizer com o que substituir
    expect(REGRAS_DO_PORQUE).toMatch(/vírgula, ponto ou dois pontos/);
  });
});
