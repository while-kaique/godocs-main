-- Adiciona colunas de saving e dados complementares à tabela projetos
-- Substitui o Google Sheets como destino dos dados de submissão

-- Área como texto direto (o formulário não usa area_id)
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS area TEXT;

-- Data de criação informada pelo usuário (quando o projeto foi criado)
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS data_criacao_projeto DATE;

-- Saving financeiro
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS saving_horas NUMERIC;
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS saving_reais NUMERIC;
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS tipo_saving TEXT;
ALTER TABLE public.projetos ADD COLUMN IF NOT EXISTS memorial_calculo TEXT;

-- Adicionar 'aprovado' ao enum de status (auto-aprovação para área RPA)
ALTER TYPE public.projeto_status ADD VALUE IF NOT EXISTS 'aprovado';
