import { describe, it, expect } from 'vitest';
import { resumirEspeciais, resumirFinanceiro, houveConsensoGeral } from '@/lib/agents/pipeline-time';

describe('a ordem: loops LOCAIS fecham antes do consenso geral', () => {
  it('o cético dos especiais volta ao PRÓPRIO cérebro, não à mesa', () => {
    const r = resumirEspeciais({
      tipo: 'reprocessar',
      estado: { volta: 1, estrela: 5, piso: 3, objecoes: ['x'] },
      objecao: 'escape sem evidência citada',
    });
    expect(r.fechou).toBe(false);
    expect(r.conclusao).toContain('reprocessando');
  });

  it('⚠️ consenso geral é um E: um loop aberto impede a mesa', () => {
    const ok = resumirFinanceiro({ tipo: 'confere', ajustado: 100, racional: 'as duas leituras concordam' });
    const aberto = resumirEspeciais({
      tipo: 'reprocessar',
      estado: { volta: 1, estrela: 5, piso: 3, objecoes: [] },
      objecao: 'y',
    });
    expect(houveConsensoGeral([ok, aberto])).toEqual({ consenso: false, pendentes: ['especiais'] });
    expect(houveConsensoGeral([ok]).consenso).toBe(true);
  });

  it('loop que ESGOTA as voltas não trava: entra na mesa como divergência', () => {
    const r = resumirEspeciais({ tipo: 'sem_consenso', estrela: 5, voltas: 2, racional: 'o cético manteve' });
    expect(r.fechou).toBe(false);
    expect(r.voltas).toBe(2);
    // E é isso que o `decidirComTime` traduz em `em_validacao`.
    expect(houveConsensoGeral([r]).consenso).toBe(false);
  });
});
