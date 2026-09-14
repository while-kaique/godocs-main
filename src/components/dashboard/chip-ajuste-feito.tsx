/**
 * "Ajuste realizado" — a marca de que o projeto VOLTOU de um `Ajuste pedido`.
 *
 * ⚠️ Existe porque, com a coluna única, o projeto ajustado reentra no funil como `Pendente`
 * (pedido do dono do produto: *"depois que o ajuste pedido tiver tido seu ajuste feito, ele
 * volta para pendente com flag de ajuste realizado"*). Sem a marca, ele fica indistinguível
 * de quem nunca saiu da fila — e quem tria perde a informação de que já houve uma volta, que
 * é justamente o que muda como se lê o projeto.
 *
 * ⚠️ Estado nunca só por cor: ícone + texto.
 */
import { CheckCheck } from "lucide-react";

export function ChipAjusteFeito() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: "rgba(23,113,79,0.10)", color: "#17714f" }}
      title="O autor reenviou com o ajuste que a triagem ou o líder pediu"
    >
      <CheckCheck className="h-3 w-3" aria-hidden />
      Ajuste realizado
    </span>
  );
}
