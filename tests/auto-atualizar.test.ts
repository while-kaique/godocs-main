/**
 * Auto-atualização das listagens de admin — a regra que decide se um tique do relógio pode
 * disparar requisição.
 *
 * O que estes testes prendem (cada item é um jeito conhecido de "atualizar sozinho" quebrar
 * a tela): aba em segundo plano não gasta chamada; requisição não empilha; a primeira carga
 * não concorre com o poll; e nada atualiza por baixo de quem está com a ficha/painel aberto
 * ou com uma gravação em curso.
 */
import { describe, it, expect } from "vitest";
import {
  INTERVALO_AUTO_ATUALIZAR_MS,
  motivoParaPular,
  podeAutoAtualizar,
  type EstadoAutoAtualizar,
} from "@/lib/auto-atualizar";

const OCIOSA: EstadoAutoAtualizar = {
  abaVisivel: true,
  emVoo: false,
  carregandoPrimeiraVez: false,
  interagindo: false,
};

describe("podeAutoAtualizar", () => {
  it("atualiza quando a tela está ociosa e visível", () => {
    expect(podeAutoAtualizar(OCIOSA)).toBe(true);
    expect(motivoParaPular(OCIOSA)).toBeNull();
  });

  it("não gasta chamada com a aba em segundo plano", () => {
    expect(podeAutoAtualizar({ ...OCIOSA, abaVisivel: false })).toBe(false);
    expect(motivoParaPular({ ...OCIOSA, abaVisivel: false })).toMatch(/segundo plano/);
  });

  it("não empilha requisição: com uma rodada em voo, o tique é descartado", () => {
    expect(podeAutoAtualizar({ ...OCIOSA, emVoo: true })).toBe(false);
    expect(motivoParaPular({ ...OCIOSA, emVoo: true })).toMatch(/em voo/);
  });

  it("espera a primeira carga terminar antes de começar a atualizar", () => {
    expect(podeAutoAtualizar({ ...OCIOSA, carregandoPrimeiraVez: true })).toBe(false);
  });

  it("não atualiza por baixo de quem está decidindo (ficha/painel/gravação)", () => {
    expect(podeAutoAtualizar({ ...OCIOSA, interagindo: true })).toBe(false);
    expect(motivoParaPular({ ...OCIOSA, interagindo: true })).toMatch(/ficha|painel|gravação/);
  });

  it("aba escondida vence as outras razões (nem avalia o resto)", () => {
    expect(
      motivoParaPular({
        abaVisivel: false,
        emVoo: true,
        carregandoPrimeiraVez: true,
        interagindo: true,
      }),
    ).toMatch(/segundo plano/);
  });

  it("a cadência é de 15 s — trocar isto é decisão de produto, não ajuste solto", () => {
    expect(INTERVALO_AUTO_ATUALIZAR_MS).toBe(15_000);
  });
});
