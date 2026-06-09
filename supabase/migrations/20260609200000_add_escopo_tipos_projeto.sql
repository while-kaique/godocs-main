-- Adiciona colunas de escopo (interno/externo), serviço externo, tipos de projeto (array)
-- e custo externo mensal à tabela projetos

ALTER TABLE projetos
  ADD COLUMN IF NOT EXISTS escopo text CHECK (escopo IN ('interno', 'externo')),
  ADD COLUMN IF NOT EXISTS servico_externo text,
  ADD COLUMN IF NOT EXISTS tipos_projeto text[],
  ADD COLUMN IF NOT EXISTS custo_externo_mensal numeric;
