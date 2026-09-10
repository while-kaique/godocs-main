/**
 * O TIME agindo JUNTO: uma passada que avalia **se há impacto** e **quanto o projeto vale**.
 *
 * ⚠️ **Por que existe** (decisão do Luis, 08/09/2026): *"é um TIME agindo JUNTO e classificando
 * JUNTO"*. Até aqui eram dois caminhos separados — a MESA (veredito: aprovar/validar/reprovar) e o
 * CLASSIFICADOR (a nota) —, disparados em pontos diferentes, com dois botões diferentes na ficha.
 * Isso descrevia uma divisão que não existe no produto: quem decide se o projeto tem impacto e
 * quem diz quanto ele vale são o mesmo time, na mesma passada.
 *
 * ⚠️ **E a nota deixou de ser privilégio de especial.** O classificador tinha um gate
 * `especial !== 1` no caminho de submissão, então projeto padrão nunca ganhava nota: *"todo projeto
 * pode ter nota ou não agora"*. O gate saiu daqui; o que sobrou é o que a régua já dizia — projeto
 * com nota humana não é reclassificado (é âncora), e `forcar` reabre.
 *
 * ⚠️ **As duas metades são INDEPENDENTES no erro.** `Promise.allSettled`, e cada uma já é fail-safe
 * por dentro: a mesa pode falhar (flag OFF, projeto especial) sem levar a nota, e vice-versa. Quem
 * chama isto — submissão, botão da ficha, lote — nunca recebe exceção.
 */
import { avaliarProjetoNormal } from '@/lib/avaliacao-normais.functions';
import { avaliarProjetoComTime } from '@/lib/avaliacao/time.functions';
import { lerLinhaEspelho, espelharEscrita } from '@/lib/sheet-espelho';
import { updateRowByProjectId } from '@/lib/google/sheets';
import { upsertAvaliacaoEspecial, getProjetoById } from '@/integrations/db/client.server';
import { rotuloNotaAgente } from '@/lib/estrelas-regua';
import { TIPOS_PROJETO, NIVEIS_PROJETO } from '@/lib/categorizacao-projeto';
import { chaveProjeto } from '@/lib/projeto-chave';
import { numero } from '@/lib/dashboard-resumo';
import { ESTRELA_LIMITE_REPROVAVEL } from '@/lib/materialidade-piso';
import { juntarAnalises, type Juncao } from '@/lib/avaliacao/junta';
import { justificativaDaReprovacao } from '@/lib/funil-status';
import { definirStatusProjeto } from '@/lib/dashboard-admin.functions';

/**
 * Quem aparece na auditoria quando quem decidiu foi o time. ⚠️ Não usar um e-mail de pessoa: o
 * `admin_status_log` e o feed do painel existem para responder "quem mudou este status", e atribuir
 * a decisão do agente a um humano apaga exatamente essa resposta.
 */
export const ATOR_TIME_AGENTES = 'time-de-agentes@godocs';

/**
 * O time escreve o Status do funil? Env lida em RUNTIME (nunca em escopo de módulo — no Godeploy
 * `process` não existe na avaliação do módulo e derruba o worker no bootstrap).
 *
 * ⚠️ **DEFAULT OFF de propósito.** Com a flag desligada o comportamento é byte-idêntico ao de
 * antes: o time avalia, grava a recomendação e não encosta no funil. Ligar é decisão de produto —
 * é o momento em que a plataforma passa a ser gerenciada por agentes — e tem de ser um ato
 * explícito num ambiente por vez, não efeito colateral de um deploy.
 */
/** A célula está vazia? `—`/`-` contam como vazio, como em todo o resto do repo. */
function vazioNaPlanilha(v: string | undefined | null): boolean {
  const t = String(v ?? '').trim();
  return t === '' || t === '—' || t === '-';
}

export function agenteDecideFunil(): boolean {
  const v = String(process.env.AGENTE_DECIDE_FUNIL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'sim' || v === 'on';
}

/**
 * Origem da nota quando quem a produziu foi o TIME INTEIRO (≠ `agente-classificador`, o de 1
 * agente). Distinguir importa: a régua de reprovação por impacto só pode se apoiar em nota que o
 * time avaliou, e sem carimbo próprio não há como saber de onde ela veio.
 */
export const ORIGEM_TIME_COMPLETO = 'time-completo';

/**
 * A metade da NOTA, agora pelo TIME INTEIRO.
 *
 * ⚠️ **Era o classificador de 1 agente** (`classificarEspecialProjeto`), e o Luis vetou isso em
 * 09/09/2026: *"a avaliação de estrelas nao pode ser feitas considerando so o cerebro de estrelas,
 * tem que ser o time todo, pois deve considerar todo o projeto em si"*. O time é
 * orquestrador → 4 especialistas do mérito (com ferramentas) → cérebro da estrela → cético →
 * cético da estrela → debate, e é ele que lê o projeto inteiro.
 *
 * ⚠️ **SÍNCRONA, nunca em `waitUntil`.** O caminho em background já prometeu estrela que não
 * chegou (medido: `waitUntil() tasks did not complete... cancelled`, 2 de 4 chamadas respondidas).
 * Quem itera é a tela, um projeto por request.
 *
 * ⚠️ **Nota humana `>= 1` é ÂNCORA e não é reclassificada** (salvo `forcar`) — a mesma régua do
 * classificador. Já o `0` humano NÃO segura nada: ele é o default da coluna manual (463 de 750
 * linhas de prod), e tratá-lo como veredito é o que deixava o piso decidindo sobre um valor que
 * ninguém escreveu.
 */
async function estrelaPeloTimeInteiro(
  projetoIdBruto: string,
  opts: { dry?: boolean; forcar?: boolean },
): Promise<{
  ok: boolean;
  motivo?: string;
  estrelas?: number | null;
  /** O consenso do TIME, que até 09/09/2026 era CALCULADO e JOGADO FORA aqui. */
  saida?: string;
  escape?: boolean;
  confianca?: 'alta' | 'media' | 'baixa';
}> {
  const projetoId = chaveProjeto(projetoIdBruto);
  // ⚠️ **Âncora protege a NOTA, não impede o JULGAMENTO** (corrigido 09/09/2026). Antes isto era um
  // `return` seco: projeto com nota humana ≥ 1 saía sem o time rodar. Com a JUNTA no fluxo, isso
  // virou um buraco — a metade da estrela chegava vazia e a decisão de funil caía em Pendente por
  // "falta uma metade", em projeto que gente já tinha avaliado. São 15 dos 90 do backlog.
  // Hoje o time roda igual (o veredito é dele), e o que a âncora bloqueia é a ESCRITA da nota.
  let ancoraHumana: number | null = null;
  // ⚠️ UMA leitura da linha, reusada pela âncora E pelo preenchimento de lacuna abaixo: ler o
  // espelho duas vezes no mesmo caminho seria round-trip de graça.
  let linhaAtual: Record<string, string> | null = null;
  try {
    linhaAtual = (await lerLinhaEspelho(projetoId)) as Record<string, string> | null;
  } catch {
    // Não conseguir ler a linha não pode impedir a avaliação: segue e o time julga.
  }
  // ⚠️ **A âncora é a nota de GENTE, e a coluna deixou de dizer quem a escreveu** (10/09/2026): o
  // agente passou a classificar de 0 a 5 na própria coluna `Estrelas`, então "tem número lá" não
  // significa mais "um humano julgou". Sem esta distinção, a nota que o AGENTE escreveu viraria
  // âncora contra ele mesmo na passada seguinte e congelaria para sempre.
  //
  // A régua: é do agente quando o número da célula é IGUAL ao que ele recomendou em
  // `Estrela Agente`. ⚠️ Caso de borda declarado: humano que concorda e digita o mesmo número é
  // tratado como agente — e o efeito é reescrever a célula com o MESMO valor, que é inofensivo.
  if (!opts.forcar) {
    const naCelula = numero(linhaAtual?.['Estrelas']);
    const recomendada = String(linhaAtual?.['Estrela Agente'] ?? '').trim();
    const foiOAgente = naCelula != null && recomendada !== '' && String(naCelula) === recomendada;
    if (naCelula != null && naCelula >= ESTRELA_LIMITE_REPROVAVEL && !foiOAgente) ancoraHumana = naCelula;
  }

  const r = await avaliarProjetoComTime(projetoId, { gatilho: 'time-completo' });
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const c = r.resultado.consenso;

  if (opts.dry) return { ok: true, estrelas: c.estrela, saida: c.saida, escape: c.escape, confianca: c.confianca };

  // A âncora humana vence a nota do time: ela é verdade e exemplar do corpus, e a régua nunca
  // reclassifica quem gente já julgou. O VEREDITO do time segue valendo (é o que a junta lê).
  if (ancoraHumana != null) {
    return {
      ok: true,
      estrelas: ancoraHumana,
      saida: c.saida,
      escape: c.escape,
      confianca: c.confianca,
      motivo: `nota humana ${ancoraHumana} é âncora — o time julgou o mérito e não reescreveu a nota`,
    };
  }

  // Persistência em DOIS lugares, e os dois são necessários:
  //  - `especial_avaliacao` é de onde a FICHA lê a recomendação;
  //  - as 2 colunas da PLANILHA são de onde a MESA lê a nota para a régua do piso
  //    (`resumoPorId.estrelaAgente`). Sem a 2ª, o time avaliaria e o piso continuaria cego.
  // ⚠️ NUNCA a coluna "Estrelas": ela é 100% humana (adotar a sugestão é ato de pessoa).
  try {
    await upsertAvaliacaoEspecial({
      projeto_id: projetoId,
      estrelas_recomendada: c.estrela,
      confianca: c.confianca,
      leitura: r.resultado.textos.interno,
      contestada: c.contestacao != null,
      origem: ORIGEM_TIME_COMPLETO,
      modelo: null,
    });
  } catch (e) {
    console.error('[time-completo] falha ao gravar a recomendação do time:', e);
  }
  try {
    // `rotuloNotaAgente` é a FONTE ÚNICA do rótulo (a mesma da tela): a faixa 6-10 vira "6-10",
    // porque `Estrela Agente` precisa carregá-la sem afirmar um número que a régua não afirma.
    // ⚠️ **O cérebro da estrela JÁ classifica tipo e nível, e isso era jogado fora.** Ele responde
    // `tipo`/`nivel` no MESMO vocabulário da categorização (`categorizacao-projeto.ts`), e a
    // gravação só levava a nota: em prod, 39 de 761 linhas estavam com `Tipo de Projeto` vazio (31
    // delas no backlog dos 90) e a coluna "Tipo · Nível" do dashboard aparecia como travessão em
    // projeto que o time acabou de ler inteiro.
    //
    // ⚠️ **Só preenche o que está VAZIO, nunca sobrescreve.** A categorização de 722 linhas foi
    // feita numa rodada dedicada e a triagem pode ter corrigido à mão; a régua aqui é a mesma da
    // âncora da nota — o agente completa lacuna, não reescreve julgamento que já existe.
    // ⚠️ **`Complexidade` fica FORA**: ela é da alçada do analisador (que grava
    // `automacao`/`inteligencia`/`autonomia`), e dois escritores na mesma célula é a briga que este
    // repo já pagou em outras colunas. O nível do time vira `Tipo de Projeto` só pelo eixo TIPO.
    const celulas: Record<string, string> = {
      'Estrela Agente': rotuloNotaAgente(c.estrela).rotulo,
      'Confiança Agente': c.confianca,
    };
    const tipoDoTime = TIPOS_PROJETO.find((t) => t.chave === r.resultado.estrela.tipo)?.rotulo;
    if (tipoDoTime && vazioNaPlanilha(linhaAtual?.['Tipo de Projeto'])) {
      celulas['Tipo de Projeto'] = tipoDoTime;
    }
    await updateRowByProjectId(projetoId, celulas);
    await espelharEscrita(projetoId, celulas);
  } catch (e) {
    console.error('[time-completo] falha ao escrever as colunas do agente:', e);
  }
  return { ok: true, estrelas: c.estrela, saida: c.saida, escape: c.escape, confianca: c.confianca };
}

export type ResultadoTimeCompleto = {
  ok: boolean;
  projeto_id: string;
  /** O veredito da mesa (impacto): `{ok, veredito, ...}` ou o motivo do NO-OP. */
  mesa: { ok: boolean; motivo?: string; veredito?: string | null };
  /** A nota: `{ok, estrelas}` ou o motivo (já tem nota humana, sem vizinhos…). */
  estrela: { ok: boolean; motivo?: string; estrelas?: number | null };
  /** A JUNÇÃO das duas metades: uma análise só, com o status do funil que ela implica. */
  junta?: Juncao;
  /** O Status realmente gravado na planilha, ou `null` quando a flag está desligada / `dry`. */
  status_gravado?: string | null;
};

function resumoMesa(r: unknown): ResultadoTimeCompleto['mesa'] {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    motivo: typeof o.motivo === 'string' ? o.motivo : undefined,
    veredito: typeof o.veredito === 'string' ? o.veredito : null,
  };
}

/** O que a metade da estrela devolveu, na forma que a junta lê. */
function ladoEstrela(r: unknown) {
  const o = (r ?? {}) as Record<string, unknown>;
  if (o.ok !== true || typeof o.saida !== 'string') return null;
  return {
    saida: o.saida,
    escape: o.escape === true,
    estrela: typeof o.estrelas === 'number' ? o.estrelas : null,
    confianca: (o.confianca as 'alta' | 'media' | 'baixa' | undefined) ?? null,
  };
}

function resumoEstrela(r: unknown): ResultadoTimeCompleto['estrela'] {
  const o = (r ?? {}) as Record<string, unknown>;
  return {
    ok: o.ok === true,
    motivo: typeof o.motivo === 'string' ? o.motivo : undefined,
    estrelas: typeof o.estrelas === 'number' ? o.estrelas : null,
  };
}

/**
 * Roda as duas metades num projeto. `forcar` reabre a nota de quem já tem nota humana (é o que
 * "rerodar" quer dizer quando o pedido é explícito). NUNCA lança.
 */
export async function avaliarProjetoComTimeCompleto(
  projetoId: string,
  opts: { dry?: boolean; forcar?: boolean } = {},
): Promise<ResultadoTimeCompleto> {
  const dry = opts.dry ?? false;
  const [mesa, estrela] = await Promise.allSettled([
    avaliarProjetoNormal(projetoId, { dry }),
    estrelaPeloTimeInteiro(projetoId, { dry, forcar: opts.forcar }),
  ]);
  const m = mesa.status === 'fulfilled' ? resumoMesa(mesa.value) : { ok: false, motivo: String(mesa.reason) };
  const e =
    estrela.status === 'fulfilled'
      ? resumoEstrela(estrela.value)
      : { ok: false, motivo: String(estrela.reason) };

  // ── A JUNTA: uma análise só ──────────────────────────────────────────────────────────────────
  // ⚠️ Até 09/09/2026 as duas metades acabavam AQUI, lado a lado, e ninguém as fundia: o veredito
  // ficava sendo o da mesa e a nota a do time, sem nenhuma peça olhando as duas. É a caixa "Junta
  // as duas análises" do grafo, que o desenho afirmava e o código não tinha.
  const especial = await ehEspecial(projetoId);
  // A linha do espelho para o TEXTO da reprovação (Status anterior e o que a triagem pediu).
  // ⚠️ Leitura do SQLite, nunca do Sheets — e uma só, aqui.
  let linhaAtual: Record<string, string> | null = null;
  try {
    linhaAtual = (await lerLinhaEspelho(projetoId)) as Record<string, string> | null;
  } catch {
    // sem a linha, a justificativa cai nos porquês da junta (que já nomeiam o eixo)
  }
  const junta = juntarAnalises({
    impacto: m.ok && m.veredito ? { veredito: m.veredito } : null,
    estrela: estrela.status === 'fulfilled' ? ladoEstrela(estrela.value) : null,
    especial,
  });

  // ── O funil ──────────────────────────────────────────────────────────────────────────────────
  let status_gravado: string | null = null;
  if (!dry && agenteDecideFunil()) {
    try {
      // ⚠️ Reusa `definirStatusProjeto`, que é o ÚNICO ponto do sistema que sabe gravar Status
      // direito: escreve na planilha, remenda o espelho na hora (invariante 1) e registra nas DUAS
      // auditorias. Uma escrita própria aqui teria de repetir isso e envelheceria em silêncio.
      // ⚠️ A justificativa vai em `Motivo Reprovado` só na REPROVAÇÃO, que é a coluna que o AUTOR
      // lê no card dele. `Observações` NÃO é tocada: ela é o parecer do analisador e é o texto que
      // o disparo de e-mails manda.
      // ⚠️ A justificativa sai da CAUSA REAL, não de um carimbo: projeto que ficou em
      // `Reenvio Pendente` sem o autor reenviar é reprovado POR ISSO, e o texto tem de dizer
      // exatamente isso (e que reenviar reabre), em vez de falar de impacto ou experimentação.
      const justificativa = justificativaDaReprovacao({
        porques: junta.porques,
        parecerDaMesa: m.motivo,
        statusAnterior: linhaAtual?.['Status'],
        motivoReenvio: linhaAtual?.['Motivo Reenvio'],
      });
      // ⚠️ **O AGENTE CLASSIFICA de 0 a 5 na coluna `Estrelas`** (decisão do dono do produto,
      // 10/09/2026: *"estrelas é preenchido por humano NO CASO DE 6-10, nos outros casos o AGENTE
      // PODE SIM CLASSIFICAR. E ele deve"*). Isto REVERTE o invariante antigo de "Estrelas é 100%
      // humana", e as três travas que sobram são:
      //   (a) **a faixa 6-10 NÃO é escrita** — a régua se recusa a dizer se é 6 ou 10, e gravar 6
      //       afirmaria uma posição que ninguém afirmou; ali fica a flag e o comitê crava;
      //   (b) **nota de gente não é sobrescrita** (`ancoraHumana`, ver acima);
      //   (c) quem escreveu segue rastreável fora da célula: `Estrela Agente` guarda o valor do
      //       agente, `especial_avaliacao` guarda a origem `time-completo`, e a auditoria registra
      //       a escrita com o ator `ATOR_TIME_AGENTES`.
      // ⚠️ Vai por `definirStatusProjeto` porque ele é o ÚNICO ponto que grava essa coluna direito
      // (numérica, sem `ouTraco`, com remendo do espelho e as 2 auditorias).
      const notaParaCelula =
        !junta.flag6a10 && e.ok && typeof e.estrelas === 'number' && e.estrelas >= 0 && e.estrelas <= 5
          ? e.estrelas
          : undefined;
      await definirStatusProjeto(
        {
          projeto_id: projetoId,
          status: junta.status,
          ...(junta.status === 'Reprovado' ? { motivo_reprovado: justificativa } : {}),
          ...(notaParaCelula !== undefined ? { estrelas: notaParaCelula } : {}),
        },
        ATOR_TIME_AGENTES,
      );
      status_gravado = junta.status;
    } catch (err) {
      // Falhar aqui não desfaz a avaliação, que já está gravada. O relatório do lote mostra o nulo.
      console.error('[time-completo] falha ao gravar o Status do funil:', err);
    }
  }

  // `ok` é OU, não E: uma metade que funcionou já é resultado — e o caso mais comum de "falha" da
  // nota é legítimo (o projeto tem nota humana e é âncora), não erro.
  return { ok: m.ok || e.ok, projeto_id: projetoId, mesa: m, estrela: e, junta, status_gravado };
}

/**
 * O projeto é especial?
 *
 * ⚠️ **A fonte é a MESMA que a mesa usa: `projetos.especial` no SQLite.** A 1ª versão disto lia a
 * coluna `Especial?` da planilha e ERRAVA — medido na staging em 10/09/2026: a mesa respondeu
 * `"especial, NO-OP"` e esta função devolveu `false`, então a junta caiu em "falta uma metade" e
 * mandou para Pendente um projeto em que o time era a única metade que podia julgar. Atingiria os
 * 11 especiais do backlog. Quem decide se a mesa roda é o SQLite; perguntar isso à planilha é
 * consultar uma segunda fonte para uma pergunta que já tem dono.
 * ⚠️ Fail-safe em DUAS camadas: erro no banco cai para a planilha, e erro nos dois → `false` (a
 * junta então exige as duas metades, que é o lado conservador).
 */
async function ehEspecial(projetoId: string): Promise<boolean> {
  try {
    const p = await getProjetoById(projetoId);
    if (p) return p.especial === 1;
  } catch {
    // cai na planilha
  }
  try {
    const linha = (await lerLinhaEspelho(projetoId)) as Record<string, string> | null;
    return /^(sim|1|true)$/i.test(String(linha?.['Especial?'] ?? '').trim());
  } catch {
    return false;
  }
}

/**
 * O texto que vai para a coluna que o AUTOR lê. PURO o suficiente para não precisar de I/O.
 *
 * ⚠️ **Teto de 4000 chars** porque é o teto do schema de `Motivo Reprovado`. O corte é no fim, com
 * reticência, e nunca no meio da primeira razão: quem lê precisa do porquê principal, não do
 * rodapé. ⚠️ A justificativa pode ser ANULADORA (o projeto não se sustenta) ou
 * INFORMATIVA/EXORTATIVA (o que mudar e reenviar) — as duas são legítimas, e é por isso que o
 * texto junta a régua da junta com o parecer dos especialistas, em vez de só carimbar o veredito.
 */
export function motivoParaOAutor(junta: Juncao, parecerDaMesa?: string | null): string {
  const partes = [...junta.porques];
  const parecer = String(parecerDaMesa ?? '').trim();
  if (parecer) partes.push('', 'O que os especialistas apontaram:', parecer);
  const t = partes.join('\n').trim();
  return t.length > 4000 ? `${t.slice(0, 3999)}…` : t;
}

/**
 * Chamado no fan-out da submissão. NO-OP silencioso e sem exceção — as duas metades já são
 * fail-safe. ⚠️ Substitui as DUAS entradas separadas que havia ali (`classificarEspecialEmBackground`
 * e `avaliarProjetoNormalEmBackground`): cada submissão roda o time inteiro.
 */
export async function avaliarComTimeCompletoEmBackground(projetoId: string): Promise<void> {
  try {
    const r = await avaliarProjetoComTimeCompleto(projetoId);
    console.log(
      `[time-completo] ${projetoId} · mesa=${r.mesa.ok ? (r.mesa.veredito ?? 'ok') : `no-op (${r.mesa.motivo ?? '?'})`}` +
        ` · estrela=${r.estrela.ok ? r.estrela.estrelas : `no-op (${r.estrela.motivo ?? '?'})`}`,
    );
  } catch (e) {
    console.error('[time-completo] falha em background:', e);
  }
}

/**
 * Teto de projetos por chamada do LOTE.
 *
 * ⚠️ **Caiu de 8 para 1 em 09/09/2026, quando a nota passou a vir do TIME INTEIRO.** Com o
 * classificador de 1 agente eram ~5 chamadas de LLM por projeto e 8 caberiam; o time são ~30
 * (4 especialistas com ferramentas + estrela + 2 céticos + debate). E o teto do request não é
 * teórico: um retroativo de 30 projetos morreu em **7 minutos** com `curl 56` — o edge corta.
 * Quem itera é a TELA, um projeto por vez, com progresso em texto (padrão do disparo de e-mails).
 */
export const LOTE_MAX_PROJETOS = 1;

export type ResultadoLote = {
  ok: boolean;
  pedidos: number;
  rodados: number;
  itens: ResultadoTimeCompleto[];
  motivo?: string;
};

/**
 * Roda o time num LOTE de projetos escolhidos na tela.
 *
 * ⚠️ **Bounded em `LOTE_MAX_PROJETOS` e dirigido pelo FRONT**, que é o padrão deste repo para
 * trabalho longo (o disparo de e-mails faz igual). O motivo é medido: cada projeto são ~5 chamadas
 * de LLM, e o `waitUntil` do Godeploy **cancela** tarefa longa depois da resposta — foi assim que
 * o botão do time de 30 chamadas prometeu uma estrela que nunca chegou (08/09/2026). Aqui cada
 * chamada é SÍNCRONA e pequena; quem itera é a tela, que mostra o progresso.
 * ⚠️ Um projeto que falha não derruba o lote (cada item já é fail-safe).
 */
export async function avaliarLoteComTime(
  projetoIds: string[],
  opts: { dry?: boolean; forcar?: boolean } = {},
): Promise<ResultadoLote> {
  const ids = [...new Set((projetoIds ?? []).map((i) => String(i ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, pedidos: 0, rodados: 0, itens: [], motivo: 'nenhum projeto informado' };
  if (ids.length > LOTE_MAX_PROJETOS) {
    return {
      ok: false,
      pedidos: ids.length,
      rodados: 0,
      itens: [],
      motivo: `no máximo ${LOTE_MAX_PROJETOS} projetos por chamada (a tela itera em lotes desse tamanho)`,
    };
  }
  const itens: ResultadoTimeCompleto[] = [];
  // EM SÉRIE de propósito: o gateway de LLM tem poucos slots e disparar 8 projetos × 5 chamadas
  // em paralelo satura o proxy — o que este repo já mediu como causa de timeout em cascata.
  for (const id of ids) {
    itens.push(await avaliarProjetoComTimeCompleto(id, opts));
  }
  return { ok: true, pedidos: ids.length, rodados: itens.filter((i) => i.ok).length, itens };
}
