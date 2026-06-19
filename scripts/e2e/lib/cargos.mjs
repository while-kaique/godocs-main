// Espelho da tabela CARGOS de src/lib/agents/types.ts:41-49 (valor_hora por cargo).
// Mantido aqui para o validador calcular o R$ esperado de forma INDEPENDENTE do
// backend. Se a tabela do app mudar, a camada de consistência (sheet × API) do
// validador ainda pega divergências — mas vale manter este espelho sincronizado.
export const CARGOS = {
  'Estagiário': 10.78,
  'Assistente': 13.94,
  'Analista Júnior': 21.29,
  'Analista Pleno': 29.90,
  'Analista Sênior': 33.10,
  'Supervisor': 42.75,
  'Especialista+': 55.15,
};

export function valorHora(cargo) {
  const v = CARGOS[cargo];
  if (v == null) throw new Error(`Cargo desconhecido no espelho CARGOS: "${cargo}"`);
  return v;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
