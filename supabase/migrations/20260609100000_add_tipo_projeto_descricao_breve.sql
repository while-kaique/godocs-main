-- Adiciona colunas tipo_projeto e descricao_breve na tabela projetos
-- Necessário para o fluxo híbrido Step 2 (modelo determinístico + agente)

ALTER TABLE projetos
  ADD COLUMN IF NOT EXISTS tipo_projeto text CHECK (tipo_projeto IN ('saving', 'receita_incremental')),
  ADD COLUMN IF NOT EXISTS descricao_breve text;
