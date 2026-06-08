// Agente Compilador de Documentação
// Recebe todos os campos coletados + contexto do projeto
// e gera a documentação final estruturada no padrão exigido

import { llmChat } from '@/lib/llm';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import type { DocumentacaoColetada, DocumentacaoGerada, ProjetoContexto } from './types';

async function getDocTemplate(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'doc_template')
    .single();

  if (!data || data.valor === null) return null;
  return typeof data.valor === 'string' ? data.valor : JSON.stringify(data.valor);
}

export async function compilarDocumentacao(
  ctx: ProjetoContexto,
  coletado: DocumentacaoColetada
): Promise<DocumentacaoGerada> {
  const template = await getDocTemplate();

  const templateInstrucao = template
    ? `\n\nSiga o seguinte template/padrão de documentação ao gerar o conteúdo:\n${template}`
    : '';

  const systemPrompt = `Você é um especialista em documentação de projetos de automação corporativa.
Gere uma documentação profissional e completa com base nas informações coletadas.${templateInstrucao}

Responda APENAS com JSON válido seguindo exatamente a estrutura abaixo:
{
  "titulo": "nome do projeto",
  "responsavel": {
    "nome": "...",
    "email": "...",
    "area": "..."
  },
  "ferramenta": "...",
  "membros": ["..."],
  "problema_resolve": "descrição detalhada do problema",
  "como_funciona": "descrição do funcionamento da automação",
  "impacto": {
    "economia_horas_mes": 0,
    "valor_hora": 0,
    "economia_reais_mes": 0,
    "memorial_calculo": "explicação detalhada do cálculo"
  },
  "beneficios_adicionais": "...",
  "gerado_em": "ISO date string"
}`;

  const userMsg = `Gere a documentação com base nestas informações coletadas:

CONTEXTO DO PROJETO:
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta: ${ctx.ferramenta}
- Membros: ${ctx.membros.join(', ') || 'Não informado'}

INFORMAÇÕES COLETADAS VIA CHAT:
- Nome do projeto: ${coletado.nome_projeto}
- Problema que resolve: ${coletado.problema_resolve}
- Como funciona: ${coletado.como_funciona}
- Economia de horas/mês: ${coletado.economia_horas_mes}h
- Valor da hora: R$ ${coletado.valor_hora}
- Economia em R$/mês: R$ ${coletado.economia_reais_mes}
- Memorial de cálculo: ${coletado.memorial_calculo}
- Benefícios adicionais: ${coletado.beneficios_adicionais}`;

  const raw = await llmChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
    { jsonMode: true, temperature: 0.3 }
  );

  const doc = JSON.parse(raw) as DocumentacaoGerada;

  // Garante o timestamp de geração
  if (!doc.gerado_em) {
    doc.gerado_em = new Date().toISOString();
  }

  return doc;
}
