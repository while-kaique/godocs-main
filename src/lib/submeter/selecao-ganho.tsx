import { alternarCategoria, type GanhoCategoria } from "@/lib/ganhos";
import { GANHO_OPCOES } from "@/lib/ganhos-rotulos";
import { SectionTitle, FormGroup, FormLabel, CardCheckboxGroup } from "./form-components";

/**
 * TELA PRÓPRIA da seleção dos tipos de ganho — a 1ª tela da Etapa 3.
 *
 * ⚠️ Ela nasceu DENTRO da Etapa 2, embaixo da descrição e dos arquivos, e o Luis pediu
 * que voltasse a ser tela própria (02/09/2026), como era a Etapa 2.5 da v1 (tipo de
 * projeto) — sem a parte do especial, que a v2 removeu. Motivo: a classificação do ganho
 * é a decisão que define o resto do formulário (quais blocos aparecem na sequência);
 * empilhada no fim de uma etapa de descrição/documentação, ela é lida como "mais um
 * campo".
 *
 * ⚠️ Fica na Etapa 3 ("Ganho"), não na 2 ("Projeto"): é a mesma etapa dos blocos que ela
 * abre, e o indicador do topo passa a dizer a verdade sobre o que se está respondendo. A
 * v1 pendurava a 2.5 na Etapa 2 porque lá a Etapa 3 era o AGENTE.
 *
 * Componente BURRO: a exclusividade é de `alternarCategoria` e o portão é
 * `validarSelecaoGanho` (`constants.ts`) — neste repo o Vitest roda `environment: 'node'`
 * e não renderiza componente, então régua daqui seria régua sem teste.
 */
export function SelecaoGanho({
  categorias,
  erro,
  onChange,
  onLimparErro,
  onVoltar,
  onProximo,
}: {
  categorias: GanhoCategoria[];
  erro?: string;
  onChange: (proximas: GanhoCategoria[]) => void;
  onLimparErro: () => void;
  onVoltar: () => void;
  onProximo: () => void;
}) {
  return (
    <div className="px-6 py-6 sm:px-8">
      <SectionTitle icon="🎯">Tipo de Ganho</SectionTitle>

      <FormGroup>
        <FormLabel
          required
          hint="Pode marcar mais de um. A pergunta que decide: esse dinheiro estava saindo do caixa antes desta solução?"
        >
          Que tipo de ganho este projeto trouxe?
        </FormLabel>
        {/* ⚠️ O toggle passa por `alternarCategoria` (`@/lib/ganhos`), FONTE ÚNICA da
            exclusividade nos DOIS sentidos (marcar imensurável deixa só ele; marcar
            qualquer mensurável tira o imensurável). Foi para isso que o
            `CardCheckboxGroup` ganhou `onToggle`: com `onChange(string[])` a tela não
            sabe QUAL item foi clicado e a régua teria de ser reimplementada aqui — o erro
            que a v1 cometeu em 3 lugares.

            ⚠️ A exclusividade age no CLIQUE, não só na validação do envio: deixar dois
            incompatíveis marcados e só reclamar no fim faria a pessoa preencher dois
            blocos e perder um. */}
        <CardCheckboxGroup
          options={GANHO_OPCOES}
          value={categorias}
          onChange={() => {
            /* não usado: quem manda é `onToggle` + `alternarCategoria` */
          }}
          onToggle={(alvo) => {
            onChange(alternarCategoria(categorias, alvo as GanhoCategoria));
            onLimparErro();
          }}
          error={erro}
        />
      </FormGroup>

      {/* Mesmas pílulas das outras etapas. A Etapa 3 desenha a própria navegação porque
          fica fora da barra de `submeter.tsx` (o bloco `step !== 3`). */}
      <div className="mt-7 flex items-center justify-between gap-3">
        <button type="button" onClick={onVoltar} className="go-btn-back">
          &larr; Voltar
        </button>
        <button type="button" onClick={onProximo} className="go-btn-next">
          Próximo &rarr;
        </button>
      </div>
    </div>
  );
}
