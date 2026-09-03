import { describe, it, expect } from 'vitest';
import { buildSystemPromptEspecial } from '@/lib/agents/especial-classificador';
import { buildPromptEstrela } from '@/lib/avaliacao/cerebro-estrela';

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
});
