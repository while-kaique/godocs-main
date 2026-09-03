// GoDocs v2 — a rota que PERSISTE o ganho declarado no formulário determinístico.
//
// T6 do plano `docs/plans/godocs-v2-submissao-deterministica.md`. É o que faltava para o
// botão "Submeter" funcionar: o cliente já chamava `POST /api/submeter/ganhos`
// (`routes/submeter.tsx`) e a rota não existia — 404 abortava a submissão inteira, porque
// as duas chamadas (esta e `/api/chat/submeter-validacao`) dividem o mesmo `try`.
//
// A divisão de trabalho entre os 3 módulos, para não nascerem duas cabeças:
//
//   impacto.ts   →  a FÓRMULA (pesos, divisores, as 3 contas).
//   ganhos.ts    →  o MODELO + a serialização snake_case + `montarPatchGanhos`.
//   AQUI         →  a borda: valida a entrada, resolve o R$/hora, checa quem pode
//                   escrever e faz UM único UPDATE.
//
// ⚠️ **UM único escritor, UM único UPDATE** (contrato declarado em `schema.ts`): o ganho e
// os 3 `impacto_*` são gravados juntos, porque os `impacto_*` são cache de 16 colunas-fonte
// e cache sem invalidação mente. Dois escritores = número velho na planilha.
//
// ⚠️ Esta rota NÃO calcula nada por conta própria. Todo número sai de `montarPatchGanhos`
// (que por sua vez chama `impacto.ts`), e o R$/hora sai de `resolverValorHora` — o canônico
// da v1, que carrega o fix do falso-zero do cargo genérico. A doença que a frente v2 cura é
// a fórmula redigitada em 5 lugares; começar a v2 com uma 6ª cópia seria trocar de dívida.
//
// ⚠️ Esta rota é do caminho v2 e SÓ dele. As réguas da v1 (`saving + receita/10`,
// `recomputarSavingFinanceiro`) continuam intactas onde estão: aplicá-las aqui — ou aplicar
// esta aqui lá — reescreveria o número de projetos v1 já gravados, o que a Fronteira do
// plano ("não se migram dados da v1") proíbe. Decisão do Luis, 02/09/2026.
import { z } from 'zod';
import { getProjetoById, updateProjeto } from '@/integrations/db/client.server';
import { isAdmin } from '@/lib/auth.functions';
import { resolverValorHora } from '@/lib/agents/saving-calc';
import { ehOwner, ehParticipante, ehEditorDelegado } from '@/lib/meus-projetos.functions';
import { uploadDocsToDrive } from '@/lib/google/drive';
import {
  GANHO_CATEGORIAS,
  categoriasValidas,
  derivarValorHorasCustoEvitado,
  montarPatchGanhos,
  type GanhosDeclarados,
} from '@/lib/ganhos';

// As 4 frequências do enum de `impacto.ts`. Declaradas aqui como schema (não importadas
// como valor) porque o zod precisa da tupla literal; o teste de ida-e-volta e o
// `divisorDe` continuam sendo a régua — este schema só barra na BORDA, antes de o valor
// virar `NaN` lá dentro.
const frequenciaSchema = z.enum(['pontual', 'mensal', 'trimestral', 'semestral']);

// ⚠️ Textos com teto GENEROSO e sem piso. O piso ("evidência obrigatória", "mínimo de
// caracteres") é do FORMULÁRIO, com mensagem no campo — repeti-lo aqui devolveria 400 no
// meio da submissão para quem está com uma aba antiga em cache (o version skew que este
// repo já viu), sem saída além de recarregar. Mesma disciplina do
// `membrosContribuicoesSchema`.
const TETO_TEXTO = 20_000;
const texto = z.string().max(TETO_TEXTO);

const linhaHorasSchema = z.object({
  funcao: z.string().max(200),
  funcaoDescricao: z.string().max(500).optional(),
  horasAntes: z.number().finite(),
  horasDepois: z.number().finite(),
});

const ganhosSchema = z.object({
  categorias: z.array(z.enum(GANHO_CATEGORIAS)).max(GANHO_CATEGORIAS.length),
  savingEfetivado: z
    .object({
      valorAntes: z.number().finite(),
      valorAgora: z.number().finite(),
      frequencia: frequenciaSchema,
      evidencia: texto,
    })
    .optional(),
  custoEvitado: z
    .object({
      frequencia: frequenciaSchema,
      linhasHoras: z.array(linhaHorasSchema).max(100),
      // ⚠️ Chega SEMPRE 0 do cliente e é RECALCULADO aqui (ver `valorHoras` abaixo): o
      // valor/hora por cargo é escondido do submissor, e aceitar o número dele seria
      // deixar o preço do ganho ser digitado por quem o declara.
      valorHoras: z.number().finite(),
      naoContratado: z.number().finite(),
      racional: texto,
    })
    .optional(),
  receitaIncremental: z
    .object({
      valor: z.number().finite(),
      frequencia: frequenciaSchema,
      racional: texto,
    })
    .optional(),
  imensuravel: z.object({ racional: texto }).optional(),
  custoRodar: z
    .array(
      z.object({
        nome: z.string().max(200),
        valor: z.number().finite(),
        frequencia: frequenciaSchema,
        oQueE: z.string().max(2000),
      }),
    )
    .max(50)
    .optional(),
});

const salvarGanhosSchema = z.object({
  projeto_id: z.string().min(1),
  ganhos: ganhosSchema,
  anexos: z
    .array(z.object({ base64: z.string().min(1), filename: z.string().min(1) }))
    .max(20)
    .optional(),
});

export type SalvarGanhosResultado = {
  ok: true;
  categorias: string[];
  impacto: { bruto: number; liquido: number; liquidoMensal: number };
};

/**
 * Grava o ganho declarado na Etapa 3 e materializa os 3 impactos.
 *
 * Ordem deliberada: valida → autoriza → deriva o R$/hora → monta o patch (que pode LANÇAR
 * em frequência suja, e aí nada é gravado) → UM UPDATE → anexos no Drive por último,
 * best-effort. O Drive vem depois de propósito: ele é a única parte que pode falhar sem
 * que a submissão deva falhar junto (mesma regra do resumo da doc em
 * `submeterParaValidacao`), e falhar ANTES do UPDATE perderia o ganho inteiro por causa
 * de um anexo.
 */
export async function salvarGanhos(
  rawData: unknown,
  solicitanteEmail: string | null,
): Promise<SalvarGanhosResultado> {
  const { projeto_id, ganhos, anexos } = salvarGanhosSchema.parse(rawData);

  const projeto = await getProjetoById(projeto_id);
  if (!projeto) {
    throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  }

  // ── Quem pode escrever o ganho DESTE projeto ────────────────────────────────
  // Mesma régua da edição (`podeEditar`, `meus-projetos.functions.ts`), pelos MESMOS
  // predicados — dono, editor delegado, ou admin que não seja participante (ser
  // participante VENCE o override de admin: quem só participa visualiza).
  //
  // ⚠️ Projeto SEM dono não bloqueia: o e-mail pode não vir em chamada interna, e um
  // projeto recém-criado sem `responsavel_email` não tem o que proteger. É a mesma
  // ressalva do gate de `submeterParaValidacao` ("submissão nova não tem owner anterior").
  const dono = (projeto.responsavel_email ?? '').trim();
  if (solicitanteEmail && dono) {
    const admin = await isAdmin(solicitanteEmail);
    const podeEditar =
      ehOwner(projeto, solicitanteEmail) ||
      ehEditorDelegado(projeto, solicitanteEmail) ||
      (admin && !ehParticipante(projeto, solicitanteEmail));
    if (!podeEditar) {
      throw Object.assign(
        new Error(
          'Apenas o autor ou um editor autorizado pode registrar o ganho deste projeto. Para transferir a autoria, acione a equipe RPA.',
        ),
        { status: 403 },
      );
    }
  }

  // ── A régua da seleção, cobrada no SERVIDOR ─────────────────────────────────
  // O formulário já a aplica, mas ela é portão de submissão: sem isto, um cliente com
  // JS antigo em cache gravaria ganho de categoria nenhuma — e projeto sem categoria
  // marcada não tem impacto, some do relatório e ninguém descobre por quê.
  if (!categoriasValidas(ganhos.categorias)) {
    throw Object.assign(
      new Error('Selecione ao menos um tipo de ganho para o projeto.'),
      { status: 400 },
    );
  }

  // ── O R$ das horas é DERIVADO no servidor, nunca aceito do cliente ──────────
  // `resolverValorHora` é o canônico (tabela CARGOS + fix do falso-zero + piso).
  const declarado: GanhosDeclarados = {
    ...ganhos,
    custoEvitado: ganhos.custoEvitado
      ? {
          ...ganhos.custoEvitado,
          valorHoras: derivarValorHorasCustoEvitado(
            ganhos.custoEvitado.linhasHoras,
            (funcao) => resolverValorHora(funcao),
          ),
        }
      : undefined,
  };

  // Pode LANÇAR (frequência fora do enum) — e lançar aqui é o desfecho certo: nada foi
  // gravado, e derivado PARCIAL é pior que derivado nenhum.
  const { colunas, impacto } = montarPatchGanhos(declarado);

  // ── UM único UPDATE: o ganho e os 3 `impacto_*` juntos ──────────────────────
  await updateProjeto(projeto_id, colunas);

  // ── Anexos de evidência → Drive (best-effort, nunca derruba a submissão) ────
  // ⚠️ Os links vão para `ganho_anexos_links`, NÃO para `arquivos_links`: o
  // `submeterParaValidacao` SOBRESCREVE `arquivos_links` com `[link]` do resumo da doc
  // (e usa o `[0]` para dar upsert no MESMO arquivo do Drive) — guardar a evidência lá
  // seria vê-la apagada pela chamada seguinte do próprio cliente, ou pior, sobrescrita
  // in-place no Drive.
  if (anexos && anexos.length > 0) {
    try {
      const links = await uploadDocsToDrive(anexos);
      if (links.length > 0) {
        await updateProjeto(projeto_id, { ganho_anexos_links: links });
      }
    } catch (e) {
      console.error('[ganhos] anexos de evidência não subiram ao Drive:', e);
    }
  }

  return { ok: true, categorias: ganhos.categorias, impacto };
}
