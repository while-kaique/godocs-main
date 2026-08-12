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

import { getProjetoById, getDocumentacao } from '@/integrations/db/client.server';
import { buildSubmitMessage, sendChatNotification, ehProjetoTesteE2E } from '@/lib/google/chat';

const ouTraco = (v: unknown): string =>
  typeof v === 'string' && v.trim() !== '' ? v : '—';

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Data da submissão em pt-BR para o corpo da mensagem. Entrada inválida/ausente → "—"
// (o alerta nunca deve exibir "Invalid Date" — já aconteceu no sync, ver CLAUDE.md).
function dataSubmissaoBR(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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

    // Saving/receita vêm da documentação (é onde o submit os congelou); ausentes → zeros,
    // que é o comportamento do próprio builder para projeto sem memorial financeiro.
    const docRow = await getDocumentacao(projetoId);
    const conteudo = parseJson<Record<string, unknown>>(docRow?.conteudo) ?? {};
    const saving = (conteudo.saving ?? null) as Record<string, unknown> | null;
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
      savingHoras: Number(saving?.economia_horas_mes) || 0,
      savingReais: Number(saving?.economia_reais_mes) || 0,
      tipoSaving: ouTraco(saving?.tipo_saving),
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
