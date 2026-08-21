// Backend de DEMONSTRAÇÃO do sandbox `/fluxos` (admin). Atende às chamadas do
// formulário REAL de submissão com respostas ROTEIRIZADAS — nada toca servidor,
// banco ou planilha. Serve para percorrer todas as telas/textos de cada fluxo
// (normal · especial · liderança) com loading de botão de verdade e nada persistido.
//
// ⚠️ Os textos aqui são EXEMPLOS de demonstração (não vêm do LLM). O objetivo é
// inspecionar a UI — as telas, os botões e os estados de carregamento — não gerar
// documentação real. Cada resposta imita o SHAPE que o backend real devolve para
// aquele endpoint (ver chat.functions.ts) para os componentes reais renderizarem.

import type { DemoBackend } from '@/lib/api-client'
import type { FormData } from '@/lib/submeter/constants'

export type FluxoDemo = 'normal' | 'especial' | 'lideranca'

/**
 * Preenche o formulário com dados de EXEMPLO para o sandbox — assim dá para avançar
 * pelas telas sem digitar. `tipoProjeto` fica vazio no especial (a natureza é definida
 * na Etapa 2.5); nos demais, é saving. O contrafactual entra pré-preenchido (o
 * autocomplete depende de dados reais que o sandbox não tem).
 */
export function demoSeedForm(fluxo: FluxoDemo, hojeISO: string): Partial<FormData> {
  return {
    escopo: 'interno',
    prodStatus: 'sim',
    nome: 'Você (modo demonstração)',
    email: 'voce.demo@gocase.com',
    ferramentas: ['Python'],
    ferramentaOutra: '',
    servicoExterno: '',
    emEquipe: 'nao',
    participantes: [],
    participantesPapeis: {},
    nomeProjeto: 'Conciliação Financeira (demonstração)',
    dataCriacao: hojeISO,
    tipoProjeto: fluxo === 'especial' ? [] : ['saving'],
    descricaoBreve:
      'Automação que concilia os lançamentos financeiros do dia, cruza com o extrato ' +
      'bancário e sinaliza divergências para o time financeiro conferir. Exemplo de demonstração.',
    usaAiProxy: 'nao',
    contrafactualAfetadosTipo: 'pessoa',
    contrafactualAfetados: ['pessoa:analista.financeiro@gocase.com'],
    especial: false,
    contextoEspecial: '',
    especialDashboard: '',
    especialGanhoOrganizacional: '',
  }
}

/** Arquivo de EXEMPLO para satisfazer a exigência de anexo (o conteúdo é ignorado no demo). */
export function demoFile(): File {
  return new File(
    ['Documento de exemplo para o modo demonstração do sandbox de fluxos.'],
    'exemplo-demonstracao.txt',
    { type: 'text/plain' },
  )
}

// Latência artificial para o loading dos botões aparecer (o edge real custa ~750ms).
const LATENCIA_MS = 650
const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const DOC_EXEMPLO = [
  '## Documentação (exemplo de demonstração)',
  '',
  '### O que o projeto faz',
  'Automação que concilia os lançamentos financeiros do dia e sinaliza divergências.',
  '',
  '### Como funciona',
  '1. Lê os relatórios exportados do ERP.',
  '2. Cruza com o extrato bancário.',
  '3. Gera um resumo das diferenças e notifica o time.',
  '',
  '### Ferramenta',
  'Python + GoDeploy.',
].join('\n')

const SAVING_PREVIEW_EXEMPLO = [
  '**Memorial pronto!** Revise abaixo e me diga se ficou algum problema — eu ajusto. Se estiver tudo certo, é só enviar para a triagem.',
  '',
  '### Contexto',
  'Conciliação financeira diária que era feita manualmente por um analista.',
  '',
  '### Saving de Pessoas',
  '- **Analista Financeiro**: 40 → 8 h/mês (economia de 32 h/mês)',
  '',
  '**Total de horas economizadas:** 32 h/mês',
].join('\n')

const GANHO_EXEMPLO = {
  saving_horas: 32,
  saving_reais: null,
  tipo_saving: 'mensal',
  receita_valor: null,
  receita_tipo: null,
  custo_externo_mensal: null,
}

/**
 * Cria um backend de demonstração para um fluxo. Mantém um pequeno estado de conversa
 * (contador de turnos do chat de doc) no fechamento — cada seleção de fluxo recria o
 * handler do zero, então o estado nasce limpo.
 */
export function criarDemoBackend(fluxo: FluxoDemo): DemoBackend {
  // Passo do chat de documentação (fluxo normal): 0 = 1ª pergunta, 1 = preview, 2 = aprovado.
  let passoDoc = 0

  return async function demoBackend(path, _body, _method) {
    await espera(LATENCIA_MS)

    // ── Identidade / perfil ──
    if (path === '/api/auth/me') {
      return {
        email: 'voce.demo@gocase.com',
        name: 'Você (modo demonstração)',
        isAdmin: true,
      }
    }
    if (path === '/api/submeter/perfil') {
      return { ehLideranca: fluxo === 'lideranca', isAdmin: true }
    }
    if (path === '/api/config') {
      return { env: 'production' }
    }

    // ── Criação do projeto ──
    if (path === '/api/chat/iniciar-submissao') {
      // Liderança: doc por IA numa passada, sem chat (o frontend abre o formulário).
      if (fluxo === 'lideranca') {
        return { projeto_id: 'demo', fluxo_direto: true }
      }
      // Especial: doc montada sem IA, pronta para submissão (o frontend chama submeter).
      if (fluxo === 'especial') {
        return { projeto_id: 'demo', especial: true }
      }
      // Normal: começa o chat de documentação com a 1ª pergunta.
      passoDoc = 0
      return {
        projeto_id: 'demo',
        response: {
          type: 'question',
          content:
            'Vamos documentar seu projeto. Em uma frase, o que exatamente esta automação faz hoje em produção? (exemplo de demonstração)',
          options: null,
          fase: 'doc',
          isPreview: false,
          isComplete: false,
        },
      }
    }

    // ── Chat de documentação (fluxo normal) ──
    if (path === '/api/chat/enviar-mensagem') {
      passoDoc += 1
      if (passoDoc === 1) {
        // Devolve o PREVIEW da documentação para aprovação.
        return {
          type: 'preview',
          content: DOC_EXEMPLO,
          options: null,
          fase: 'doc_preview',
          isPreview: true,
          isComplete: false,
          coletado: null,
        }
      }
      if (passoDoc === 2) {
        // Doc aprovada → transição para a fase de saving (abre o formulário).
        return {
          type: 'content',
          content: 'Documentação registrada. Agora vamos ao impacto financeiro.',
          options: null,
          fase: 'saving',
          isPreview: false,
          isComplete: false,
          coletado: null,
        }
      }
      // Aprovação do memorial de saving → conclui (revisão final).
      return {
        type: 'complete',
        content: SAVING_PREVIEW_EXEMPLO,
        options: null,
        fase: 'completo',
        isPreview: true,
        isComplete: true,
        saving: null,
      }
    }

    // ── Formulário determinístico de saving ──
    if (path === '/api/chat/iniciar-saving') {
      // Liderança: memorial pronto na hora (sem chat). Normal: preview para aprovação
      // no chat (o frontend mostra o preview e o usuário aprova).
      if (fluxo === 'lideranca') {
        return {
          type: 'complete',
          content: SAVING_PREVIEW_EXEMPLO,
          options: null,
          fase: 'completo',
          isPreview: true,
          isComplete: true,
          saving: null,
          receita: null,
        }
      }
      return {
        type: 'preview',
        content: SAVING_PREVIEW_EXEMPLO,
        options: null,
        fase: 'saving_preview',
        isPreview: true,
        isComplete: false,
        saving: null,
      }
    }

    if (path === '/api/chat/iniciar-receita') {
      return {
        type: 'complete',
        content:
          '**Memorial pronto!** Revise abaixo... (exemplo)\n\n### Receita Incremental\nGanho de receita estimado pela liderança.',
        options: null,
        fase: 'completo',
        isPreview: true,
        isComplete: true,
        saving: null,
        receita: null,
      }
    }

    // ── Metadados (usado na conversão/edição de especial) ──
    if (path === '/api/chat/atualizar-metadados') {
      return { ok: true, reset: false }
    }

    // ── Envio final ──
    if (path === '/api/chat/submeter-validacao') {
      return { ok: true, status: 'em_validacao', ganho: GANHO_EXEMPLO }
    }

    // Qualquer outra chamada (ex.: sugestões de participantes/áreas): default benigno.
    // A maioria dos endpoints não roteirizados aqui são listas — devolve vazio.
    console.warn('[demo-backend] path não roteirizado:', path)
    return []
  }
}
