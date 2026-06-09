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
    'integrations/supabase/client.ts',
    'integrations/supabase/client.server.ts',
    'integrations/supabase/types.ts',
    'router.tsx',
    'server.ts',
    'start.ts',
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
    expect(deps['@supabase/supabase-js']).toBeDefined();
    expect(deps['zod']).toBeDefined();
    expect(deps['vitest']).toBeDefined();
  });
});

describe('Migrations do Supabase existem', () => {
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

  it('diretório de migrations existe', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });

  it('tem pelo menos 4 migrations', () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Tipos do Supabase estão consistentes', () => {
  const typesContent = fs.readFileSync(
    path.join(SRC, 'integrations/supabase/types.ts'),
    'utf-8'
  );

  it('define tabela projetos', () => {
    expect(typesContent).toContain('projetos');
  });

  it('define tabela documentacao', () => {
    expect(typesContent).toContain('documentacao');
  });

  it('define tabela chat_messages', () => {
    expect(typesContent).toContain('chat_messages');
  });

  it('define tabela validacoes', () => {
    expect(typesContent).toContain('validacoes');
  });

  it('define colunas de saving no projetos', () => {
    expect(typesContent).toContain('saving_horas');
    expect(typesContent).toContain('saving_reais');
    expect(typesContent).toContain('tipo_saving');
    expect(typesContent).toContain('memorial_calculo');
  });

  it('enum projeto_status inclui aprovado', () => {
    expect(typesContent).toContain('"aprovado"');
  });

  it('projetos tem coluna area (texto)', () => {
    expect(typesContent).toMatch(/area: string \| null/);
  });
});
