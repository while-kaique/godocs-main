// LEITURA DE IMAGEM por visão do ai-proxy (server-only).
//
// ⚠️ **Por que existe.** `extract-text.server.ts` lê `txt/md/json/...` como UTF-8, PDF pelo OCR
// Worker e DOCX pelo mammoth — e **imagem caía no ramo "extensão desconhecida → tenta utf-8"**,
// devolvendo lixo ou vazio. Ou seja: print de comprovante, que é o anexo TÍPICO de memorial
// financeiro, chegava ao agente como nada. Medido em 09/09/2026: **746 dos 750 projetos de prod têm
// anexo no Drive**, então isso nunca foi caso de borda.
//
// O caso que expôs: «Plataforma Smartonline / DIFAL». O autor anexou arquivo E nomeou onde conferir
// ("comprovantes de pagamento no GoService por CNPJ e competência"), e o especialista de evidência
// concluiu que "o ganho principal não foi medido" — julgando como se não houvesse nada.
//
// ⚠️ **O que sai daqui é LEITURA DE IA, não o texto literal do arquivo.** O retorno vem com um
// cabeçalho que diz isso, e é ele que impede o agente de citar uma transcrição como se fosse o
// documento. A distinção importa: o repo já pune "evidência que é só o próprio entregável", e uma
// transcrição apresentada como prova é a mesma classe de erro.

/** Extensões que este módulo sabe ler. */
export const EXTENSOES_IMAGEM = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

/** O MIME que vai no data URI. O proxy exige `data:image/<tipo>;base64,`. */
function mimeDe(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/png';
}

/**
 * Teto do base64 que vai ao proxy. Imagem grande estoura o payload e o tempo do request, e
 * comprovante/print raramente passa disso.
 * ⚠️ Acima do teto NÃO se corta a imagem (base64 truncado é imagem corrompida): recusa-se a
 * leitura e o motivo é declarado, para o dossiê dizer "anexo grande demais" em vez de "sem anexo".
 */
export const TETO_BASE64_IMAGEM = 5_000_000;

/** O que se pede à visão. Objetivo: transcrever o que dá para conferir, não interpretar o projeto. */
const PERGUNTA = [
  'Este arquivo foi anexado por um funcionário como EVIDÊNCIA do ganho de um projeto de automação.',
  '',
  'Transcreva o que está no documento, nesta ordem:',
  '1. Que tipo de documento é (comprovante, extrato, fatura, print de painel, planilha, gráfico, outro).',
  '2. TODOS os números, valores, datas, CNPJ e nomes de empresa que aparecem, literalmente.',
  '3. O que o documento comprova, em uma frase.',
  '',
  'Regras: não interprete o mérito do projeto, não elogie e não conclua se o ganho é válido.',
  'Se a imagem estiver ilegível ou não trouxer número nenhum, diga isso e pare.',
].join('\n');

export type LeituraDeImagem = { ok: boolean; texto: string; motivo?: string };

/**
 * Lê UMA imagem pelo endpoint de visão do ai-proxy. **Nunca lança** — falha vira `ok: false` com o
 * motivo, e quem chama segue sem o texto (a submissão não pode cair por causa de um anexo).
 *
 * ⚠️ Envs lidas LAZY, dentro da função (regra do repo: `process.env` em escopo de módulo derruba o
 * worker no bootstrap do Godeploy).
 * ⚠️ Usa o MESMO `LLM_BASE_URL` + `API_PROXY_TOKEN` do resto do app: o endpoint de visão é o mesmo
 * `/chat/completions`, só com `content` em ARRAY (texto + `image_url`). Sem proxy configurado, não
 * tenta a OpenAI direto — visão por chave direta é decisão de custo que ninguém tomou.
 */
export async function lerImagemComVisao(
  base64: string,
  fileName: string,
): Promise<LeituraDeImagem> {
  const baseUrl = process.env.LLM_BASE_URL;
  const token = process.env.API_PROXY_TOKEN;
  if (!baseUrl || !token) {
    return { ok: false, texto: '', motivo: 'ai-proxy não configurado (LLM_BASE_URL/API_PROXY_TOKEN)' };
  }
  if (base64.length > TETO_BASE64_IMAGEM) {
    return {
      ok: false,
      texto: '',
      motivo: `imagem grande demais para a leitura automática (${Math.round(base64.length / 1024)} KB em base64)`,
    };
  }
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  // `latest` é o que o proxy expõe para visão (os apelidos sol/terra/luna são de texto).
  const model = process.env.LLM_MODEL_VISAO || 'latest';

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PERGUNTA },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeDe(ext)};base64,${base64}` },
              },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      return { ok: false, texto: '', motivo: `visão HTTP ${resp.status}: ${corpo.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { choices?: { message?: { content?: unknown } }[] };
    const conteudo = json.choices?.[0]?.message?.content;
    const texto = typeof conteudo === 'string' ? conteudo.trim() : '';
    if (!texto) return { ok: false, texto: '', motivo: 'a visão respondeu vazio' };
    return { ok: true, texto: marcarComoLeituraDeIA(texto, fileName) };
  } catch (e) {
    return { ok: false, texto: '', motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** O cabeçalho que impede o agente de tratar a transcrição como o documento. FONTE ÚNICA. */
export const MARCA_LEITURA_IA = 'LEITURA AUTOMÁTICA DE IMAGEM (não é o texto literal do arquivo)';

export function marcarComoLeituraDeIA(texto: string, fileName: string): string {
  return `[${MARCA_LEITURA_IA} — arquivo "${fileName}"]\n${texto}`;
}
