/**
 * FAQ — os destinos usados pelo resto do app. Módulo **PURO** (roda no cliente).
 *
 * FONTE ÚNICA: antes cada tela escrevia o caminho na mão (`step25.tsx` tinha o seu, o
 * `aviso-pendencia.tsx` tinha os dele), e uma seção renomeada deixava links mortos
 * espalhados sem ninguém notar. Ver spec-docs/SPEC_FAQ.md (D18).
 *
 * ⚠️ As âncoras são os **ids das seções**, derivados por `chaveSlug` dos TÍTULOS do
 * documento (`faq-documento.tsx`). Renomear a seção no painel admin muda o id e o link
 * passa a cair no topo da página — **degrada, não quebra**. `tests/faq.test.ts` confere que
 * cada âncora daqui existe como seção no `FAQ_SEED`, para a regressão aparecer no CI e não
 * na cara do usuário.
 */

/** Caminhos, sem rótulo — para quem só precisa do endereço. */
export const FAQ_URL = {
  indice: '/faq',
  tipos: '/faq/tipos_projetos',
  saving: '/faq/tipos_projetos#saving_operacional',
  receita: '/faq/tipos_projetos#receita_incremental',
  especial: '/faq/tipos_projetos#projeto_especial',
  ganhoMedido: '/faq/tipos_projetos#o_ganho_tem_de_ser_real_e_medido',
  status: '/faq/acompanhamento',
  statusReprovado: '/faq/acompanhamento#reprovado',
  statusReenvio: '/faq/acompanhamento#reenvio_pendente',
} as const;

export type LinkFaq = { href: string; label: string };

/**
 * O que o rodapé do formulário oferece em cada momento (D18). O rótulo acompanha o
 * destino: um "Perguntas frequentes" genérico levando a uma seção específica seria uma
 * promessa diferente do que a página entrega.
 *
 * ⚠️ Nenhum destes textos entra na conversa com o agente — o link do fluxo de submissão
 * vive no RODAPÉ da página (D17).
 */
export const FAQ_RODAPE: Record<
  'indice' | 'financeiro' | 'especial' | 'memorial' | 'status',
  LinkFaq
> = {
  // Intro e Etapa 1 (identidade, área, equipe): nada específico a apontar.
  indice: { href: FAQ_URL.indice, label: 'Dúvidas? Perguntas frequentes' },
  // Etapa 2 — é onde se declara custo evitado e custo do projeto.
  financeiro: { href: FAQ_URL.saving, label: 'Dúvidas? Como o ganho é medido' },
  // Etapa 2.5 — a pergunta do projeto especial.
  especial: { href: FAQ_URL.especial, label: 'Dúvidas? O que conta como projeto especial' },
  // Etapa 3 — o chat que monta a documentação e o memorial.
  memorial: { href: FAQ_URL.ganhoMedido, label: 'Dúvidas? Como o ganho é medido' },
  // Tela de sucesso: aqui a pergunta deixa de ser "como preencho" e passa a ser "e agora?".
  status: { href: FAQ_URL.status, label: 'O que acontece com o projeto agora?' },
};
