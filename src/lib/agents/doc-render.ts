// Render da DOCUMENTAÇÃO COMPLETA gerada → Markdown. É o documento salvo como UM
// arquivo no Google Drive (link único na coluna URL da planilha).
//
// NÃO é um espelho do Sheets: junta tudo de ponta a ponta —
//  1. metadados do projeto;
//  2. resumo gerado pelo agente (etapa de documentação);
//  3. documentação técnica completa (o que faz, execução, dependências, fluxo,
//     configurar antes, atenção);
//  4. memoriais de saving/receita (etapas de impacto) + contexto especial;
//  5. a documentação ORIGINAL enviada pelo usuário (texto extraído dos arquivos).
//
// Tolera campos como string OU array estruturado (varia conforme a versão).

type ProjetoLike = {
  nome?: string | null;
  responsavel_nome?: string | null;
  responsavel_email?: string | null;
  area?: string | null;
  ferramenta?: string | null;
  escopo?: string | null;
  descricao_breve?: string | null;
  especial?: number | boolean | null;
  contexto_especial?: string | null;
};

// Conteúdo extra (fora de `documentacao.conteudo`) para a doc ponta-a-ponta.
type Extras = {
  resumoProjeto?: string | null; // resumo factual gerado pelo agente na aprovação da doc
  docUsuario?: string | null; // texto extraído dos arquivos enviados pelo usuário
  arquivosNomes?: string[] | null; // nomes dos arquivos enviados
};

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function renderResumoDocumentacao(
  projeto: ProjetoLike,
  conteudo: Record<string, unknown> | null | undefined,
  extras?: Extras,
): string {
  const c = conteudo ?? {};
  const out: string[] = [];

  out.push(`# ${s(c.titulo) || s(projeto.nome) || 'Projeto'}`);
  out.push('');
  out.push(`- **Responsável:** ${s(projeto.responsavel_nome) || '—'} (${s(projeto.responsavel_email) || '—'})`);
  out.push(`- **Área:** ${s(projeto.area) || '—'}`);
  out.push(`- **Ferramenta:** ${s(projeto.ferramenta) || '—'}`);
  out.push(`- **Escopo:** ${s(projeto.escopo) || '—'}`);

  // Resumo do projeto gerado pelo agente (etapa de documentação).
  if (s(extras?.resumoProjeto)) out.push('', '## Resumo do projeto', s(extras?.resumoProjeto));

  if (s(projeto.descricao_breve)) out.push('', '## Descrição', s(projeto.descricao_breve));
  if (s(c.o_que_faz)) out.push('', '## O que faz', s(c.o_que_faz));
  if (s(c.execucao)) out.push('', '## Execução', s(c.execucao));

  // Dependências: array [{servico,descricao}] | string
  if (Array.isArray(c.dependencias) && c.dependencias.length) {
    out.push('', '## Dependências');
    for (const d of c.dependencias as Record<string, unknown>[]) {
      out.push(d && typeof d === 'object' ? `- **${s(d.servico)}** — ${s(d.descricao)}` : `- ${String(d)}`);
    }
  } else if (s(c.dependencias)) {
    out.push('', '## Dependências', s(c.dependencias));
  }

  // Fluxo: array [{etapa,descricao,condicoes?}] | string
  if (Array.isArray(c.fluxo) && c.fluxo.length) {
    out.push('', '## Fluxo');
    (c.fluxo as Record<string, unknown>[]).forEach((f, i) => {
      if (f && typeof f === 'object') {
        out.push(`${i + 1}. **${s(f.etapa)}** — ${s(f.descricao)}`);
        if (Array.isArray(f.condicoes)) {
          for (const co of f.condicoes as Record<string, unknown>[]) out.push(`   - se ${s(co.se)}: ${s(co.acao)}`);
        }
      } else {
        out.push(`${i + 1}. ${String(f)}`);
      }
    });
  } else if (s(c.fluxo)) {
    out.push('', '## Fluxo', s(c.fluxo));
  }

  // Configurar antes: array string | string
  if (Array.isArray(c.configurar_antes) && c.configurar_antes.length) {
    out.push('', '## Configurar antes');
    for (const x of c.configurar_antes) out.push(`- ${String(x)}`);
  } else if (s(c.configurar_antes)) {
    out.push('', '## Configurar antes', s(c.configurar_antes));
  }

  // Atenção: array [{titulo,descricao}] | string
  if (Array.isArray(c.atencao) && c.atencao.length) {
    out.push('', '## Atenção');
    for (const a of c.atencao as Record<string, unknown>[]) {
      out.push(a && typeof a === 'object' ? `- **${s(a.titulo)}** — ${s(a.descricao)}` : `- ${String(a)}`);
    }
  } else if (s(c.atencao)) {
    out.push('', '## Atenção', s(c.atencao));
  }

  // Projeto especial: contexto.
  const ehEspecial = projeto.especial === 1 || projeto.especial === true;
  if (ehEspecial && s(projeto.contexto_especial)) {
    out.push('', '## Contexto do Projeto Especial', s(projeto.contexto_especial));
  }

  // Memoriais (versão do agente, sem R$) — etapas de impacto.
  const saving = c.saving as Record<string, unknown> | undefined;
  if (saving && s(saving.memorial_calculo)) out.push('', '## Memorial de Saving', s(saving.memorial_calculo));
  const receita = c.receita as Record<string, unknown> | undefined;
  if (receita && s(receita.memorial_calculo)) out.push('', '## Memorial de Receita', s(receita.memorial_calculo));

  // Documentação ORIGINAL enviada pelo usuário (arquivos + texto extraído).
  const nomes = (extras?.arquivosNomes ?? []).filter(Boolean);
  const docUser = s(extras?.docUsuario);
  if (nomes.length || docUser) {
    out.push('', '---', '', '## Documentação enviada pelo usuário');
    if (nomes.length) out.push('', `**Arquivos:** ${nomes.join(', ')}`);
    if (docUser) out.push('', '### Conteúdo extraído', '', docUser);
  }

  return out.join('\n');
}
