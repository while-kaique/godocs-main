// Agente Compilador de Documentação
// Recebe os campos coletados pelo orquestrador + contexto do projeto
// e gera a documentação final estruturada no padrão das 6 seções

import { llmChat } from '@/lib/llm';
import type { DocumentacaoColetada, DocumentacaoGerada, ProjetoContexto } from './types';

const SYSTEM_PROMPT = `Você é um especialista em documentação de projetos de automação corporativa do GoGroup.
Gere uma documentação técnica profissional e completa com base nas informações coletadas.

A documentação final deve seguir EXATAMENTE esta estrutura de 6 seções:

1. **O que faz** — Parágrafo objetivo de 2-4 frases: qual problema resolve, para quem resolve, e qual o resultado da execução.
2. **Execução** — Como o projeto é acionado (trigger manual, schedule com horário/frequência, webhook, evento, etc.).
3. **Dependências** — Lista de TODOS os serviços externos, APIs, credenciais e acessos necessários.
4. **Fluxo** — Sequência lógica e completa das etapas da execução, do início ao fim. Incluir ramificações condicionais (IF/ELSE) quando houver.
5. **Configurar antes de usar** — Passos mínimos para alguém que acabou de receber o projeto conseguir rodá-lo.
6. **Atenção** — Riscos reais, limitações conhecidas, pontos frágeis. Não invente riscos genéricos.

CRITÉRIOS DE QUALIDADE:
- "O que faz" deve ser compreensível por alguém que nunca viu o projeto.
- "Dependências" deve listar TODOS os serviços mencionados — não omita nenhum.
- "Fluxo" deve ser uma sequência lógica sem pular etapas.
- "Atenção" só deve ter itens reais. Se não houver riscos claros, use: "Nenhum risco crítico identificado no momento."
- NÃO repita informações entre seções.
- Escreva em português brasileiro com acentuação correta.

Responda APENAS com JSON válido seguindo exatamente a estrutura abaixo:
{
  "titulo": "nome do projeto",
  "responsavel": { "nome": "...", "email": "...", "area": "..." },
  "ferramenta": "...",
  "membros": ["..."],
  "o_que_faz": "parágrafo descritivo",
  "execucao": "descrição do trigger/agendamento",
  "dependencias": [{"servico": "Nome", "descricao": "para quê é usado"}],
  "fluxo": [{"etapa": "Nome", "descricao": "o que acontece", "condicoes": [{"se": "condição", "acao": "ação"}]}],
  "configurar_antes": ["passo 1", "passo 2"],
  "atencao": [{"titulo": "Título", "descricao": "descrição e recomendação"}],
  "gerado_em": "ISO date string"
}`;

export async function compilarDocumentacao(
  ctx: ProjetoContexto,
  coletado: DocumentacaoColetada
): Promise<DocumentacaoGerada> {
  const userMsg = `Gere a documentação com base nestas informações coletadas:

CONTEXTO DO PROJETO:
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta: ${ctx.ferramenta}
- Membros: ${ctx.membros.join(', ') || 'Não informado'}

INFORMAÇÕES COLETADAS VIA CHAT:
- Nome do projeto: ${coletado.nome_projeto}
- O que faz: ${coletado.o_que_faz}
- Execução (trigger): ${coletado.execucao}
- Dependências: ${coletado.dependencias}
- Fluxo: ${coletado.fluxo}
- Configurar antes de usar: ${coletado.configurar_antes}
- Pontos de atenção: ${coletado.atencao}`;

  const raw = await llmChat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { jsonMode: true, temperature: 0.3 }
  );

  const doc = JSON.parse(raw) as DocumentacaoGerada;

  if (!doc.gerado_em) {
    doc.gerado_em = new Date().toISOString();
  }

  return doc;
}
