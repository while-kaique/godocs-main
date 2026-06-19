// Render do resumo da documentação → markdown (1 doc no Drive).
import { describe, it, expect } from 'vitest';
import { renderResumoDocumentacao } from '@/lib/agents/doc-render';

const projeto = {
  nome: 'Resumo NFS', responsavel_nome: 'Juan', responsavel_email: 'juan@x.com',
  area: 'LOJAS', ferramenta: 'Google Apps Script', escopo: 'interno',
  descricao_breve: 'Automação que envia resumo ao Chat.', especial: 0, contexto_especial: null,
};

describe('renderResumoDocumentacao', () => {
  it('renderiza doc estruturada (dependências/fluxo/atenção como arrays)', () => {
    const md = renderResumoDocumentacao(projeto, {
      titulo: 'Resumo NFS',
      o_que_faz: 'Envia um resumo diário das NFs.',
      execucao: 'Cron diário às 9h.',
      dependencias: [{ servico: 'Trello', descricao: 'origem dos cards' }],
      fluxo: [{ etapa: 'Coleta', descricao: 'lê os cards', condicoes: [{ se: 'vazio', acao: 'pula' }] }],
      configurar_antes: ['Token do Trello'],
      atencao: [{ titulo: 'Limite de API', descricao: 'rate limit do Trello' }],
      saving: { memorial_calculo: 'Memorial sem R$...' },
    });
    expect(md).toContain('# Resumo NFS');
    expect(md).toContain('**Área:** LOJAS');
    expect(md).toContain('## O que faz');
    expect(md).toContain('- **Trello** — origem dos cards');
    expect(md).toContain('1. **Coleta** — lê os cards');
    expect(md).toContain('   - se vazio: pula');
    expect(md).toContain('- Token do Trello');
    expect(md).toContain('## Memorial de Saving');
  });

  it('tolera campos como string (versão não-estruturada)', () => {
    const md = renderResumoDocumentacao(projeto, {
      o_que_faz: 'X', dependencias: 'Trello, Chat', fluxo: '1. lê 2. envia', atencao: 'cuidado com rate limit',
    });
    expect(md).toContain('## Dependências\nTrello, Chat');
    expect(md).toContain('## Fluxo\n1. lê 2. envia');
    expect(md).toContain('## Atenção\ncuidado com rate limit');
  });

  it('inclui resumo do agente + documentação enviada pelo usuário (extras)', () => {
    const md = renderResumoDocumentacao(projeto, { o_que_faz: 'X' }, {
      resumoProjeto: 'Resumo factual do projeto em 3 frases.',
      docUsuario: 'function main() { return 42; }',
      arquivosNomes: ['app.js', 'README.md'],
    });
    expect(md).toContain('## Resumo do projeto\nResumo factual do projeto em 3 frases.');
    expect(md).toContain('## Documentação enviada pelo usuário');
    expect(md).toContain('**Arquivos:** app.js, README.md');
    expect(md).toContain('### Conteúdo extraído');
    expect(md).toContain('function main() { return 42; }');
  });

  it('projeto especial usa contexto especial + descrição (sem doc compilada)', () => {
    const esp = { ...projeto, especial: 1, contexto_especial: 'Alto impacto, difícil mensuração.' };
    const md = renderResumoDocumentacao(esp, {});
    expect(md).toContain('## Descrição');
    expect(md).toContain('## Contexto do Projeto Especial');
    expect(md).toContain('Alto impacto, difícil mensuração.');
  });
});
