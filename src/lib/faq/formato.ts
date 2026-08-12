/**
 * FAQ — formatação de "quem escreveu e quando". Módulo **PURO** (roda no cliente).
 *
 * Existe porque a informação aparece em 2 lugares (o rodapé do documento e o modal do
 * "Voltar à versão anterior") e porque os dois dependem de detalhes chatos do dado:
 * o SQLite grava `datetime('now')` como `"2026-08-12 15:40:00"` (espaço, sem fuso) e o
 * autor pode ser o literal `seed`, que não é pessoa nenhuma.
 */

import { chaveColuna } from '@/lib/coluna-chave';
import type { FaqCategoria } from '@/lib/faq/conteudo';

/** Quem o seed grava na coluna de autoria — não é uma pessoa, é o deploy. */
const AUTOR_SEED = 'seed';

/**
 * Filtro da busca do índice (D16). Casa em título, descrição **e no texto do documento** —
 * quem chega no FAQ chega com um termo ("220h", "custo evitado"), não com o nome do
 * assunto, e o termo quase sempre está no meio do texto.
 *
 * ⚠️ Sem acento e sem caixa, via `chaveColuna` (o mesmo normalizador do Sheets e do slug):
 * "recorrencia" tem de achar "recorrência". Cada palavra do termo precisa aparecer em algum
 * lugar do assunto (E, não OU) — com OU, duas palavras devolveriam mais resultados que uma.
 */
export function filtrarAssuntosFaq<T extends Pick<FaqCategoria, 'titulo' | 'resumo' | 'corpo'>>(
  assuntos: T[],
  termo: string,
): T[] {
  const palavras = chaveColuna(termo).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return assuntos;
  return assuntos.filter((a) => {
    const alvo = chaveColuna(`${a.titulo} ${a.resumo ?? ''} ${a.corpo ?? ''}`);
    return palavras.every((p) => alvo.includes(p));
  });
}

/**
 * `"2026-08-12 15:40:00"` → `"12/08/2026"`.
 *
 * ⚠️ Só a DATA, de propósito: o carimbo é UTC e o leitor é de Brasília, então mostrar a
 * hora exigiria conversão de fuso para responder uma pergunta que ninguém faz — o rodapé
 * serve para saber se o texto está velho, não a que horas foi salvo.
 * Valor não reconhecido devolve `null` (a linha simplesmente não aparece).
 */
export function formatarDataFaq(valor: string | null | undefined): string | null {
  if (!valor?.trim()) return null;
  const texto = valor.trim();

  // Caminho rápido e sem fuso: o formato que o SQLite grava.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return null;
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * `"kaique.breno@gocase.com"` → `"Kaique Breno"`. O autor `seed` devolve `null`: quem
 * escreveu foi o deploy, e "por Seed" no rodapé confundiria o leitor.
 */
export function nomeDeQuemFaq(valor: string | null | undefined): string | null {
  const bruto = valor?.trim();
  if (!bruto || bruto === AUTOR_SEED) return null;
  const local = bruto.includes('@') ? bruto.split('@')[0] : bruto;
  const nome = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
  return nome || null;
}

/**
 * A linha do rodapé: "Atualizado em 12/08/2026 por Kaique Breno" · "Atualizado em
 * 12/08/2026" (quando foi o seed) · `null` quando não há carimbo nenhum.
 */
export function linhaAtualizacaoFaq(
  em: string | null | undefined,
  por: string | null | undefined,
): string | null {
  const data = formatarDataFaq(em);
  if (!data) return null;
  const quem = nomeDeQuemFaq(por);
  return quem ? `Atualizado em ${data} por ${quem}` : `Atualizado em ${data}`;
}
