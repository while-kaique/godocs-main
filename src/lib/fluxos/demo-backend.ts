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

/**
 * ⚠️ Eram TRÊS fluxos (`normal` · `especial` · `lideranca`). Na v2 sobrou UM: o agente
 * saiu do caminho do usuário (D4), a Etapa 2.5 do especial saiu (D5 — especial passa a ser
 * derivado de estrela > 0) e o "fluxo direto de liderança" perdeu o sentido, porque ele
 * existia justamente para a liderança escapar da conversa. O tipo continua sendo uma união
 * de um membro para o sandbox seguir aceitando fluxos novos sem mudar de forma.
 */
export type FluxoDemo = 'padrao'

// Flag (sessionStorage) que faz o formulário REAL de /submeter rodar como liderança
// para ADMIN testar. Usada em vez de `?lideranca=1` porque o edge do Godeploy engole a
// query string no redirect de OAuth (o param some da URL). O flag é setado no clique de
// um botão do /fluxos (página já autenticada) e a navegação para /submeter é client-side,
// então sobrevive; some ao fechar a aba. Lido em `submeter.tsx` (só admin reconfere).
export const CHAVE_TESTE_LIDERANCA = 'godocs:teste-lideranca'

/**
 * Preenche o formulário com dados de EXEMPLO para o sandbox — assim dá para avançar pelas
 * telas sem digitar. O contrafactual entra pré-preenchido porque o autocomplete depende de
 * dados reais (TeamGuide) que o sandbox não tem.
 *
 * ⚠️ `hojeISO` continua no parâmetro embora a "data de criação" tenha saído do formulário:
 * o call site já o calcula e o sandbox pode voltar a precisar de uma data de exemplo.
 */
export function demoSeedForm(_fluxo: FluxoDemo, _hojeISO: string): Partial<FormData> {
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
    ganhoCategorias: ['custo_evitado'],
    descricaoBreve:
      'Automação que concilia os lançamentos financeiros do dia, cruza com o extrato ' +
      'bancário e sinaliza divergências para o time financeiro conferir. Exemplo de demonstração.',
    usaAiProxy: 'nao',
    contrafactualAfetadosTipo: 'pessoa',
    contrafactualAfetados: ['pessoa:analista.financeiro@gocase.com'],
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

const GANHO_EXEMPLO = {
  impacto_bruto: 12000,
  impacto_liquido: 5900,
  impacto_liquido_mensal: 5900,
}

/**
 * Cria o backend de demonstração. Não guarda mais estado de conversa (não há conversa):
 * cada rota devolve o SHAPE que o backend real devolve, para os componentes reais
 * renderizarem de verdade.
 */
export function criarDemoBackend(fluxo: FluxoDemo): DemoBackend {
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
      return { ehLideranca: false, isAdmin: true }
    }
    if (path === '/api/config') {
      return { env: 'production' }
    }

    // ── Criação do projeto ──
    // ⚠️ Nenhuma mensagem de chat na resposta: a documentação é compilada em BACKGROUND e
    // é invisível ao usuário (D6). O que o formulário consome daqui é só o `projeto_id`.
    if (path === '/api/chat/iniciar-submissao') {
      return { projeto_id: `demo-${fluxo}` }
    }

    // ── Metadados (descrição / AI Proxy / afetados digitados depois do disparo) ──
    if (path === '/api/chat/atualizar-metadados') {
      return { ok: true, reset: false }
    }

    // ── Ganho declarado (Etapa 3) ──
    if (path === '/api/submeter/ganhos') {
      return { ok: true }
    }

    // ── Envio final ──
    if (path === '/api/chat/submeter-validacao') {
      return { ok: true, status: 'em_validacao', ganho: GANHO_EXEMPLO }
    }

    // Qualquer outra chamada (ex.: sugestões de participantes/áreas): default benigno —
    // a maioria dos endpoints não roteirizados aqui são listas.
    console.warn('[demo-backend] path não roteirizado:', path)
    return []
  }
}
