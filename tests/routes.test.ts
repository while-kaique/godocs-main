// Testes: integridade das rotas e configuração do projeto
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
const ROUTES = path.join(SRC, 'routes');

describe('Arquivos de rotas existem', () => {
  const requiredRoutes = [
    '__root.tsx',
    'index.tsx',
    'auth.tsx',
    'submeter.tsx',
    '_authenticated/route.tsx',
    '_authenticated/dashboard.tsx',
    '_authenticated/usuarios.tsx',
    '_authenticated/areas.tsx',
  ];

  for (const route of requiredRoutes) {
    it(`rota ${route} existe`, () => {
      const filePath = path.join(ROUTES, route);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }
});

describe('Arquivos do sistema de agentes existem', () => {
  const requiredAgentFiles = [
    'lib/agents/orchestrator.ts',
    'lib/agents/types.ts',
    'lib/agents/doc-compiler.ts',
    'lib/agents/validator.ts',
    'lib/agents/email-agent.ts',
    'lib/chat.functions.ts',
    'lib/llm.ts',
    'lib/extract-text.server.ts',
  ];

  for (const file of requiredAgentFiles) {
    it(`${file} existe`, () => {
      const filePath = path.join(SRC, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }
});

describe('Arquivos de infraestrutura existem', () => {
  const requiredFiles = [
    'integrations/db/client.server.ts',
    'integrations/db/schema.ts',
    'integrations/db/types.ts',
    'router.tsx',
    'main.tsx',
    'worker.ts',
    'styles.css',
  ];

  for (const file of requiredFiles) {
    it(`${file} existe`, () => {
      const filePath = path.join(SRC, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }
});

describe('package.json está consistente', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

  it('tem script dev', () => {
    expect(pkg.scripts.dev).toBeDefined();
  });

  it('tem script build', () => {
    expect(pkg.scripts.build).toBeDefined();
  });

  it('tem script test', () => {
    expect(pkg.scripts.test).toBeDefined();
  });

  it('tem dependências críticas', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['react']).toBeDefined();
    expect(deps['@tanstack/react-router']).toBeDefined();
    expect(deps['better-sqlite3']).toBeDefined();
    expect(deps['zod']).toBeDefined();
    expect(deps['vitest']).toBeDefined();
  });

  it('não depende mais do Supabase', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['@supabase/supabase-js']).toBeUndefined();
  });
});

describe('Schema SQLite está consistente', () => {
  const schemaContent = fs.readFileSync(
    path.join(SRC, 'integrations/db/schema.ts'),
    'utf-8'
  );

  it('cria tabela projetos', () => {
    expect(schemaContent).toContain('CREATE TABLE IF NOT EXISTS projetos');
  });

  it('cria tabela documentacao', () => {
    expect(schemaContent).toContain('CREATE TABLE IF NOT EXISTS documentacao');
  });

  it('cria tabela chat_messages', () => {
    expect(schemaContent).toContain('CREATE TABLE IF NOT EXISTS chat_messages');
  });

  it('cria tabela validacoes', () => {
    expect(schemaContent).toContain('CREATE TABLE IF NOT EXISTS validacoes');
  });

  it('define colunas de saving no projetos', () => {
    expect(schemaContent).toContain('saving_horas');
    expect(schemaContent).toContain('saving_reais');
    expect(schemaContent).toContain('tipo_saving');
    expect(schemaContent).toContain('memorial_calculo');
  });

  it('status aceita aprovado', () => {
    expect(schemaContent).toContain("'aprovado'");
  });

  it('projetos tem coluna area (texto)', () => {
    expect(schemaContent).toMatch(/area TEXT/);
  });
});

describe('Tipos SQLite estão consistentes', () => {
  const typesContent = fs.readFileSync(
    path.join(SRC, 'integrations/db/types.ts'),
    'utf-8'
  );

  it('enum projeto_status inclui aprovado', () => {
    expect(typesContent).toContain("'aprovado'");
  });

  it('define colunas de saving', () => {
    expect(typesContent).toContain('saving_horas');
    expect(typesContent).toContain('memorial_calculo');
  });
});
