# Design System · GoDocs

Formato Google Stitch, lido pelo Impeccable antes de cada comando.

> **Este arquivo descreve o GoDocs COMO ELE É HOJE**, para que `polish` não repinte a aplicação por engano. A marca oficial está na skill `gogroup-design` (ver `identidade_visual_gogroup.md`). As divergências conhecidas estão listadas no fim deste arquivo.

## Colors

```
Primary        oklch(46.7% 0.147 253.7)   /* #0059A9 · --go-blue */
Accent         oklch(86.0% 0.189 111.1)   /* #D7DB00 · --go-lime */
Background     oklch(97.1% 0.011 63.4)    /* #FBF4EE · --go-cream */
Surface        oklch(100% 0 0)            /* #FFFFFF */
Surface-alt    oklch(91.6% 0.045 233.8)   /* #C7E9FD · --go-light-blue */
Text           oklch(32.1% 0 0)           /* #333333 · nunca preto puro */
Muted          oklch(64.2% 0.022 285.8)   /* #8b8b9a */
Muted-surface  oklch(94.3% 0.009 67.7)    /* #f0ebe6 */
Destructive    oklch(57.7% 0.215 27.3)    /* #dc2626 */
Brand-claude   oklch(67.2% 0.131 38.8)    /* #D97757 · só borda/preenchimento */
Brand-claude-ink oklch(57.4% 0.122 39.3)  /* #B45C3E · texto (AA em corpo pequeno) */
```

Regras de cor herdadas da marca:

- Azul dominante na tela; lime é acento pontual, nunca fundo de parágrafo.
- **Nunca texto branco sobre lime** (1,52:1).
- Título azul sobre fundo claro, branco sobre fundo azul.
- Corpo em `#333333`, jamais `#000`.

## Typography

```
Font           Poppins (400, 600, 700, 800, 900)
Display        Black 900, clamp(2rem, 5vw, 4rem), line-height 1.1
H1             ExtraBold 800, clamp(1.75rem, 4vw, 3rem)
H2             ExtraBold 800, clamp(1.375rem, 3vw, 2.25rem)
H3             Bold 700, clamp(1.125rem, 2vw, 1.5rem)
Body           Regular 400, 16px, line-height 1.6
Small          Regular 400, 14px
Caption        Regular 400, 12px
Eyebrow        SemiBold 600, uppercase, letter-spacing 0.15em
Label / badge  SemiBold 600, 12px, letter-spacing 0.05em
```

Nunca outra família. Nunca serifada, nunca system-ui.

## Shape

```
Button, badge, chip   9999px (pill)
Input, select         8px    (--go-radius-sm)
Card                  12px   (--go-radius-md)
Panel, dialog         16px   (--go-radius-lg)
Hero, container       24px   (--go-radius-xl)
```

## Elevation

```
sm   0 2px 8px rgba(0, 89, 169, .06)
md   0 4px 16px rgba(0, 89, 169, .08)
lg   0 8px 32px rgba(0, 89, 169, .10)
lime 0 4px 20px rgba(215, 219, 0, .3)
```

Sombra é azulada e discreta. Sem sombra neutra cinza.

## Components

Base shadcn/ui em `src/components/ui/` (**não editar**), mais um vocabulário próprio em `src/styles.css`:

```
.go-btn-primary / .go-btn-next / .go-btn-back / .go-btn-submit
.go-input / .go-textarea / .go-select / .go-input-invalid
.go-radio-label / .go-radio-checked
.go-grid-check (+ -item, -box, -on, -familia, -marca-claude)
.go-info-tooltip (+ -arrow) / .go-info-icon / .go-hint-link
.go-porque / .go-spinner / .go-shake
```

Componentes de domínio reutilizáveis (fonte única, não duplicar):

```
AvisoPendencia          3 estados de pendência, tira de uma linha expansível
StatusBadge             estado do projeto, sempre com rótulo textual
ChipEstadoParecer       parecer do líder
QuemFezOQue             contribuições, colapsado em card / aberto na ficha
ExemplosCampoAjuda      modal de exemplos via portal
Calendario              seletor de data e período, portal, 42 células fixas
```

## Rules

- **Estado nunca só por cor.** Todo badge, chip e aviso carrega ícone ou rótulo.
- **Foco de teclado sempre visível.** `outline: 2px solid var(--go-blue)`.
- **`prefers-reduced-motion` respeitado** em toda transição.
- **Listagem é para escanear.** Texto longo vai colapsado, ou na ficha; nunca aberto por padrão num card de lista.
- Português do Brasil com acentuação em todo texto visível.
- Sem gradiente, sem glassmorphism, sem canto reto.
- Toggle de visibilidade por `el.hidden`, não `style.display`.

## Divergências conhecidas da marca oficial

Registradas, não corrigidas. Trocar qualquer uma repinta a aplicação inteira e é **decisão de produto**, não `polish`.

| Token | GoDocs hoje | Brandbook 2026 | Nota |
|---|---|---|---|
| Azul | `#0059A9` | `#2659a5` | Divergência real (+38 no canal R). O valor atual veio do render do PDF (≈ `#005dad`), não da tabela oficial. Ambos passam AA com branco (7,0 × 6,87) |
| Lime | `#D7DB00` | `#d7d900` | Arredondamento, imperceptível |
| Cream | `#FBF4EE` | `#fcf5ef` | Arredondamento, imperceptível |
| Light blue | `#C7E9FD` | `#c7eafe` | Arredondamento, imperceptível |
| Erro | `#dc2626` | `#e5273c` | O vermelho da marca nunca foi adotado |
| Alerta | não existe | `#f8ae13` | Âmbar improvisado caso a caso nas telas |
| Info | não existe | `#3dbfef` | Ciano da marca nunca adotado |
| Raio de card | 12px | 24px | O GoDocs é mais contido que a marca institucional |

Ausentes por serem linguagem de material institucional, não de ferramenta de trabalho: moldura de cor, motivo "janela" (3 pontinhos), selo circular "g", logotipo sangrando.
