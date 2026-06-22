import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocka o acesso ao banco (getAdminByEmail) para testar só a lógica de isAdmin.
const { getAdminByEmail } = vi.hoisted(() => ({ getAdminByEmail: vi.fn() }));
vi.mock('@/integrations/db/client.server', () => ({ getAdminByEmail }));

import { isAdmin } from '@/lib/auth.functions';

describe('isAdmin — fonte única de verdade (env ADMIN_EMAILS ∪ tabela admins)', () => {
  beforeEach(() => {
    getAdminByEmail.mockReset();
    getAdminByEmail.mockResolvedValue(null);
    process.env.ADMIN_EMAILS = 'a@x.com, B@X.com';
  });

  it('reconhece admin da env (case-insensitive) sem tocar no banco', async () => {
    expect(await isAdmin('a@x.com')).toBe(true);
    expect(await isAdmin('B@x.com')).toBe(true); // case-insensitive
    expect(getAdminByEmail).not.toHaveBeenCalled();
  });

  it('cai no banco (CRUD dinâmico) quando não está na env', async () => {
    getAdminByEmail.mockResolvedValue({ id: '1', email: 'c@x.com' });
    expect(await isAdmin('c@x.com')).toBe(true);
    expect(getAdminByEmail).toHaveBeenCalled();
  });

  it('false quando não está em nenhuma fonte', async () => {
    expect(await isAdmin('z@x.com')).toBe(false);
  });

  it('false para email vazio/nulo/indefinido', async () => {
    expect(await isAdmin('')).toBe(false);
    expect(await isAdmin(null)).toBe(false);
    expect(await isAdmin(undefined)).toBe(false);
  });

  it('sem ADMIN_EMAILS, a env não promove ninguém (só o banco decide)', async () => {
    delete process.env.ADMIN_EMAILS;
    expect(await isAdmin('a@x.com')).toBe(false); // banco mockado retorna null
    expect(getAdminByEmail).toHaveBeenCalled();
  });
});
