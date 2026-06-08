-- Adiciona 'doc' aos valores permitidos na coluna role de chat_messages
-- Necessário para persistir o texto extraído da documentação enviada pelo usuário

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_role_check;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_role_check
  CHECK (role IN ('user', 'assistant', 'doc'));
