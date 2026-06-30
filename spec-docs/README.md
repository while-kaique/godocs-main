# spec-docs

Specs e handoffs de planejamento do GoDocs (versionados no repo).

| Documento | Conteúdo |
|---|---|
| [SPEC_FEATURES_NOVAS.md](SPEC_FEATURES_NOVAS.md) | 5 features (jun/2026): AI Proxy, periodicidade trimestral/semestral, custos do projeto, carga real × escala, antiagente — + a **etapa de auditoria** (gates determinísticos que garantem a informação de análise). Status, decisões fechadas e mapa de onde cada coisa aterrissou. |
| [SPEC_WIDGET_AJUDA.md](SPEC_WIDGET_AJUDA.md) | **Widget de Ajuda & Suporte** (jun/2026, ⏳ planejada): botão flutuante em todas as páginas → painel estilo chat (dúvida × problema + print) → notifica um espaço dedicado do Google Chat. Mão única, print via link do Drive, persiste em `ajuda_chamados`. Decisões D1–D4 + plano file-by-file. |
| [SPEC_COMPLEXIDADE_NIVEIS.md](SPEC_COMPLEXIDADE_NIVEIS.md) | **Níveis de complexidade — redefinição de AUTONOMIA** (jun/2026, 📐 planejada, ainda não implementada): o discriminador da autonomia passa a ser **"toma ação consequente na última ponta, sozinho"** (independe de IA), não a presença de IA. Decisões D1–D3, árvore de decisão nova, freio anti-dashboard e mapa de onde aterrissa no `analyzer.ts`. |
| [SPEC_CORRECOES.md](SPEC_CORRECOES.md) | Registro de correções de bug (uma entrada por fix): sintoma → causa-raiz → fix → onde aterrissou → PR. Atualizado a cada correção relevante (regra 12 do `CLAUDE.md`). |

> São documentos de planejamento/decisão (não substituem a doc técnica em `docs/` nem o `CLAUDE.md`). Atualizar quando uma decisão mudar.
