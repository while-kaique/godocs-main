// Autocomplete de participantes: filtro puro do frontend (participantes-sugestoes)
// e listagem da TeamGuide no backend (listarPessoasTeamGuide, fetch mockado).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { filtrarSugestoes, type SugestaoParticipante } from '@/lib/submeter/participantes-sugestoes';
import { listarPessoasTeamGuide } from '@/lib/areas/teamguide.server';

const PESSOAS: SugestaoParticipante[] = [
  { nome: 'Adriana Melo Da Penha', email: 'adriana.mello@gocase.com', cargo: 'Agente De Atendimento CX' },
  { nome: 'André Souza', email: 'andre.souza@gocase.com', cargo: 'Analista de Dados' },
  { nome: 'Kaique Breno', email: 'kaique.breno@gocase.com', cargo: 'Dev RPA' },
  { nome: 'Maria José', email: 'maria.jose@gobeaute.com.br', cargo: null },
  { nome: 'Mariana Andrade', email: 'mariana.andrade@gocase.com', cargo: 'Designer' },
];

describe('filtrarSugestoes', () => {
  it('busca vazia não sugere nada (dropdown só abre digitando)', () => {
    expect(filtrarSugestoes(PESSOAS, '', [])).toEqual([]);
    expect(filtrarSugestoes(PESSOAS, '   ', [])).toEqual([]);
  });

  it('filtra por trecho do e-mail', () => {
    const r = filtrarSugestoes(PESSOAS, 'kaique', []);
    expect(r.map((p) => p.email)).toEqual(['kaique.breno@gocase.com']);
  });

  it('filtra por nome ignorando acento e caixa', () => {
    const r = filtrarSugestoes(PESSOAS, 'ANDRE', []);
    expect(r.map((p) => p.nome)).toContain('André Souza');
  });

  it('acento na BUSCA também é ignorado', () => {
    const r = filtrarSugestoes(PESSOAS, 'josé', []);
    expect(r.map((p) => p.nome)).toEqual(['Maria José']);
  });

  it('múltiplas palavras: todas precisam casar (nome ou e-mail)', () => {
    const r = filtrarSugestoes(PESSOAS, 'maria andrade', []);
    expect(r.map((p) => p.nome)).toEqual(['Mariana Andrade']);
  });

  it('exclui quem já foi adicionado (case-insensitive)', () => {
    const r = filtrarSugestoes(PESSOAS, 'maria', ['MARIA.JOSE@gobeaute.com.br']);
    expect(r.map((p) => p.nome)).toEqual(['Mariana Andrade']);
  });

  it('prioriza começo do e-mail, depois começo do nome, depois o resto', () => {
    const r = filtrarSugestoes(PESSOAS, 'andr', []);
    // andre.souza começa pelo termo (rank 0); "Andrade"/"Mariana" casam depois.
    expect(r[0].email).toBe('andre.souza@gocase.com');
    expect(r.map((p) => p.nome)).toContain('Mariana Andrade');
  });
});

describe('listarPessoasTeamGuide', () => {
  const REFS = [
    { id: 1, name: 'Bruna Lima', contactEmail: 'BRUNA.LIMA@gocase.com', position: 'Analista' },
    { id: 2, name: 'Ana Zeta', contactEmail: 'ana.zeta@gocase.com', position: '' },
    { id: 3, name: 'Sem Email', contactEmail: null, position: 'X' },
    { id: 4, name: 'Bruna Lima 2', contactEmail: 'bruna.lima@gocase.com', position: 'Dup' },
  ];

  beforeEach(() => {
    process.env.TG_API_TOKEN = 'fake-token';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => REFS } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('normaliza e-mail, descarta sem e-mail, dedup e ordena por nome', async () => {
    const pessoas = await listarPessoasTeamGuide();
    expect(pessoas).toEqual([
      { nome: 'Ana Zeta', email: 'ana.zeta@gocase.com', cargo: null },
      { nome: 'Bruna Lima', email: 'bruna.lima@gocase.com', cargo: 'Analista' },
    ]);
  });

  it('lança erro sem TG_API_TOKEN', async () => {
    delete process.env.TG_API_TOKEN;
    await expect(listarPessoasTeamGuide()).rejects.toThrow(/TG_API_TOKEN/);
  });
});
