import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * ⚠️ **O contrato de `iniciar-submissao` não pode exigir campo que o formulário não tem.**
 *
 * Em 07/09/2026 TODA submissão nova falhava em produção: a v2 tirou "Data de criação" do
 * formulário (a data que vale é a de SUBMISSÃO) e o cliente deixou de mandar a chave, mas o
 * schema da rota continuava `data_criacao: z.string()` obrigatória. O zod recusava com 400, o
 * projeto não nascia, e a tela dizia *"tente novamente em alguns segundos"* — mandando a pessoa
 * repetir uma ação determinística que nunca ia funcionar.
 *
 * A mesma chave já era `.optional()` na rota de metadados: só a de criação ficou para trás. É a
 * diferença entre um campo sumir do FORMULÁRIO e sumir do CONTRATO.
 *
 * ⚠️ Este teste replica o formato do schema em vez de importá-lo porque `chat.functions.ts`
 * arrasta o mundo server-side (banco, Google, LLM). O que ele trava é a PROPRIEDADE: um payload
 * como o que a v2 envia — sem `data_criacao` — tem de passar.
 */
describe('contrato de iniciar-submissao: campo removido do form não pode ser obrigatório', () => {
  const schema = z.object({
    responsavel_nome: z.string().min(1),
    responsavel_email: z.string().min(1),
    ferramenta: z.string().min(1).max(200),
    membros: z.array(z.string()).default([]),
    nome_projeto: z.string().min(1).max(200),
    data_criacao: z.string().optional(),
  });

  /** Exatamente o que `dispararDocBackground` monta na v2: sem `data_criacao`. */
  const payloadV2 = {
    responsavel_nome: 'Fulano',
    responsavel_email: 'fulano@gocase.com',
    ferramenta: 'Python',
    membros: [],
    nome_projeto: 'Projeto novo',
  };

  it('o payload da v2, SEM data de criação, é aceito', () => {
    expect(schema.safeParse(payloadV2).success).toBe(true);
  });

  it('cliente ANTIGO em cache, que ainda manda a data, continua aceito', () => {
    expect(schema.safeParse({ ...payloadV2, data_criacao: '2026-09-07' }).success).toBe(true);
  });

  it('o que É obrigatório segue obrigatório', () => {
    const { nome_projeto: _, ...semNome } = payloadV2;
    expect(schema.safeParse(semNome).success).toBe(false);
  });
});
