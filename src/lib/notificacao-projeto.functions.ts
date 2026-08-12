// Aviso ao grupo do Google Chat disparado PELA pré-aprovação do líder (11/08/2026).
//
// A mensagem não sai mais na submissão de quem entra em fila: o projeto ainda está
// esperando parecer, e avisar seria justamente o ruído que o Luis pediu para cortar
// ("só a pessoa submeter e não tiver aprovação do líder nós vamos desconsiderar").
// Ela nasce quando o líder clica em "Pré-aprovar" — ver `decidirAprovacao`.
//
// Como o turno da submissão já acabou faz tempo, o payload é REMONTADO do banco.
// ⚠️ NÃO reusar `resyncGoogle` para isso: aquele caminho também ESCREVE a linha inteira
// na planilha (e mexe em "Atualizado Em"), então uma notificação acabaria regravando o
// projeto. Aqui só se LÊ.

import { getProjetoById, getDocumentacao, parseJson } from '@/integrations/db/client.server';
import { buildSubmitMessage, sendChatNotification, ehProjetoTesteE2E } from '@/lib/google/chat';
import { parseDataFlexivel } from '@/lib/format-date';

const ouTraco = (v: unknown): string =>
  typeof v === 'string' && v.trim() !== '' ? v : '—';

// Data da submissão para o corpo da mensagem. Ausente/inválida → "—" (o alerta nunca
// deve exibir "Invalid Date").
//
// ⚠️ `parseDataFlexivel`, NUNCA `new Date(...)` cru: legado tem `submitted_at` em pt-BR
// ("12/05/2026") e o `Date` nativo o lê como MM/DD — 5/dez —, o que NÃO é NaN e portanto
// escaparia do guard, imprimindo a data ERRADA em silêncio. É a mesma armadilha que já
// deixou órfão eterno no `carimboMs` da reconciliação de exclusão (ver CLAUDE.md).
function dataSubmissaoBR(valor: unknown): string {
  const d = parseDataFlexivel(typeof valor === 'string' ? valor : null);
  if (!d) return '—';
  // UTC: a planilha grava em UTC e `parseDataFlexivel` reconstrói em UTC — converter para
  // outro fuso aqui deslocaria o dia (é o que o `fmtDataBR` vizinho também faz).
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Notifica o grupo do Chat de que o projeto foi PRÉ-APROVADO pelo líder.
 *
 * Devolve `true` só quando a mensagem saiu. **Nunca lança** — é acessório à decisão do
 * líder (mesma régua do D3: nada de aviso pode derrubar o fluxo principal). Projeto de
 * teste `[E2E-…]` segue mudo, como em todos os outros caminhos.
 */
export async function notificarChatPreAprovacao(
  projetoId: string,
  parecer: { por: string; em: string },
): Promise<boolean> {
  try {
    const projeto = await getProjetoById(projetoId);
    if (!projeto) {
      console.warn(`[notificacao-projeto] Projeto ${projetoId} não encontrado — nada a notificar.`);
      return false;
    }

    if (ehProjetoTesteE2E(projeto.nome)) {
      console.warn(
        `[notificacao-projeto] Projeto de teste E2E "${projeto.nome}" — notificação de pré-aprovação suprimida.`,
      );
      return false;
    }

    // ⚠️ O SAVING sai das COLUNAS de `projetos`, NÃO de `documentacao.conteudo.saving`.
    // `submeterParaValidacao` re-deriva custo evitado/custo do projeto dos ITENS e roda
    // `recomputarSavingFinanceiro` **em memória**, e esse objeto corrigido nunca é
    // regravado no doc — o que ele persiste são `saving_horas`/`saving_reais`/
    // `tipo_saving`, que é exatamente o que foi para a planilha. Ler o doc faria o grupo
    // anunciar R$ 0,00 num projeto de custo evitado que entrou na planilha com o valor
    // certo (classe de bug já conhecida: Portal de Reembolsos / SmartOnline, CLAUDE.md).
    // A RECEITA não tem coluna própria em `projetos` — essa vem do doc mesmo.
    const docRow = await getDocumentacao(projetoId);
    const conteudo = parseJson<Record<string, unknown>>(docRow?.conteudo) ?? {};
    const receita = (conteudo.receita ?? null) as Record<string, unknown> | null;

    const membros = parseJson<string[]>(projeto.membros) ?? [];
    const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];

    const message = buildSubmitMessage({
      projeto: ouTraco(projeto.nome),
      area: ouTraco(projeto.area),
      ferramenta: ouTraco(projeto.ferramenta),
      escopo: ouTraco(projeto.escopo),
      tipos: tiposProjeto.join(', ') || '—',
      nomeCompleto: ouTraco(projeto.responsavel_nome),
      email: ouTraco(projeto.responsavel_email),
      participantes: membros.join(', ') || '—',
      descricao: ouTraco(projeto.descricao_breve),
      savingHoras: Number(projeto.saving_horas) || 0,
      savingReais: Number(projeto.saving_reais) || 0,
      tipoSaving: ouTraco(projeto.tipo_saving),
      receitaValor: Number(receita?.valor_ganho_mensal) || 0,
      tipoReceita: ouTraco(receita?.tipo_saving),
      dataSubmissao: dataSubmissaoBR(projeto.submitted_at),
      // A mensagem é sempre a do projeto "chegando" ao grupo, mesmo quando a
      // pré-aprovação veio de um reenvio: para quem lê, é a 1ª vez que ele aparece.
      modo: 'novo',
      // Especial não abre fila (D27), então na prática nunca cai aqui; passar a flag
      // mantém o builder coerente caso a régua da isenção mude um dia.
      especial: projeto.especial === 1,
      contextoEspecial: (projeto.contexto_especial as string | null) ?? undefined,
      preAprovacao: parecer,
    });

    return await sendChatNotification(message);
  } catch (e) {
    console.error('[notificacao-projeto] Falha ao notificar a pré-aprovação (não-fatal):', e);
    return false;
  }
}
