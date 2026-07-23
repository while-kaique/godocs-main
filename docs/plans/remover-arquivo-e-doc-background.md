# Plano — Remover arquivo enviado + processar doc em background (Etapa 2 do /submeter)

**Status:** ✅ aprovado (Luis, 2026-07-22)

**Objetivo:** Na Etapa 2 do formulário de submissão, (1) permitir remover de verdade um arquivo já
enviado (hoje "fica na memória") e (2) começar a processar a documentação em segundo plano assim que os
arquivos são subidos, para a Etapa 3 abrir sem espera.

## Contexto / decisões fechadas com o usuário
- **Pedido 1 — restrição honesta (Opção A):** o servidor guarda o texto da doc como **um `doc`
  concatenado** (`chat.functions.ts` `insertChatMessage role:"doc"`), **não por arquivo**, e o cliente não
  retém os `File` antigos. Logo **não** há como "regerar de um subconjunto". Remover um arquivo enviado
  **invalida a doc** e exige **re-upload** dos que se quer manter. Para 1 arquivo (o caso reportado) é
  transparente. Nada de gambiarra de subconjunto.
- **Pedido 2 — background (Opção "processar tudo ao subir"):** disparar `iniciar-submissao` em segundo
  plano quando os arquivos entram na Etapa 2 e os campos mínimos da doc estão prontos. Escopo **só
  submissão NOVA** (`!editProjetoId`) — a edição já tem seu próprio caminho de reprocesso e é mais frágil
  (BUG ABERTO de legado). 

### Tarefas
- **T1 — F1 UI (`src/lib/submeter/step2.tsx`):** adicionar props `onRemoverExistente?(nome)` e
  `docExistenteInvalidado?`. No box "Arquivos enviados anteriormente", ✕ por item (sempre visível,
  `aria-label`, foco de teclado visível, não-só-cor) chamando `onRemoverExistente`. Copy adaptativa:
  padrão = "texto reaproveitado"; quando `docExistenteInvalidado` = aviso de que é preciso re-subir.
  (guarda: teste de render/interação não trivial; validação visual no navegador)
- **T2 — F1 estado (`src/routes/submeter.tsx`):** estado `docExistenteInvalidado`; handler
  `onRemoverExistente` = remove de `nomesExistentes` + liga a flag + `clearError('documentacao')`; passar
  props ao `Step2`. `validateStep(2)`: quando `docExistenteInvalidado && arquivos.length===0` → erro
  pedindo re-upload (mesmo com `nomesExistentes` ainda não-vazio). Persistir a flag no `DraftSnapshot`
  (draft-storage.ts) + `saveDraft` + `rehydrateFromLocal` + seed (default false). Limpar a flag ao subir
  arquivos novos e nos sucessos de `reprocessarComNovosArquivos`/`handleIniciarAgente`. (guarda: teste da
  função pura de validação da Etapa 2)
- **T3 — F1 validação pura:** extrair/isolar a regra da Etapa 2 (arquivos vs. existentes vs. invalidado)
  numa função pura testável (ex. em `validation.ts` do submeter, ao lado de `validarEtapa1`) e usá-la no
  `validateStep`. (guarda: `tests/` cobrindo os 4 casos: sem nada→erro; só existentes→ok; existentes+
  invalidado sem upload→erro; com upload→ok)
- **T4 — F2 disparo background (`src/routes/submeter.tsx`):** efeito com debounce (~800ms) que, quando
  `!editProjetoId && arquivos.length>0 && !projetoId && camposMinimosProntos` (nome≥3, contexto≥60,
  usaAiProxy setado; Etapa 1 já concluída) e a assinatura (arquivos+meta) mudou, chama `iniciar-submissao`
  SEM `especial`/`tipos` (caminho não-especial). Dedup por ref de assinatura + ref de "em voo". Sucesso →
  setar `projetoId`, `nomesExistentes`, `agentMeta`, `agentArquivosSig`, `agentTipos([])`, `chatMessages`,
  `chatFase`, `chatComplete` (espelha o sucesso de `handleIniciarAgente`). Erro → silencioso + volta a
  permitir o disparo síncrono no Continuar (fallback). Guardar a Promise em voo num ref.
- **T5 — F2 idempotência da Etapa 2.5 (`src/routes/submeter.tsx`):** quando `projetoId` já existe (criado
  pelo background), os botões da 2.5 **não** podem recriar o projeto: `handleIniciarAgente` (não-especial)
  → aguarda o background em voo e **delega a `handleContinuarAgente`** (já sincroniza tipos/meta e navega).
  `handleEnviarEspecial` (novo, não-edição) → se `projetoId` existe, **converte** via `atualizar-metadados`
  `{especial:true, contexto_especial, reset_doc:true}` + `submeter-validacao`, em vez de novo
  `iniciar-submissao`. (guarda: revisão de conformidade + teste manual dos 3 caminhos: nao+tipos /
  especial / troca de arquivos antes do Continuar)
- **T6 — F2 status discreto (`step2.tsx`):** prop `bgStatus: 'idle'|'processando'|'pronto'|'erro'`; linha
  sutil perto da árvore ("Analisando a documentação em segundo plano…" / "Documentação pronta — pode
  avançar"). Não bloqueia a navegação; identidade GoGroup + a11y.
- **T7 — spec + testes + build:** atualizar `spec-docs/SPEC_FEATURES_NOVAS.md`; `npm run test` verde;
  `npm run build && npm run build:worker` (worker.js commitado — regra 1). Sem edição server-side prevista
  (reusa `iniciar-submissao`/`atualizar-metadados`), então build:worker é conferência.

### Critérios de aceitação
1. Um arquivo em "Arquivos enviados anteriormente" pode ser removido pelo ✕ e **não reaparece** (some da
   lista e do rascunho persistido; reload mantém removido).
2. Depois de remover, se não houver upload novo, o "Continuar" **bloqueia** com mensagem clara pedindo
   re-upload; subir arquivo novo destrava e regenera a doc.
3. Ao subir arquivos e preencher os campos mínimos, a doc começa a processar em background (status visível)
   e, chegando na Etapa 3, se pronta, **entra sem spinner**; se ainda rodando, aguarda como hoje.
4. O background **nunca** cria projeto duplicado: escolher tipo (não-especial) ou especial na 2.5 reusa o
   projeto criado pelo background.
5. Suíte de testes verde; `worker.js`/`dist` reconstruídos; sem regressão do fluxo de edição/legado.

### Fronteiras (não exceder)
- **Sem** mudança de schema/servidor para guardar texto por-arquivo (isso seria a Opção B, fora de escopo).
- **Sem** background na **edição** (`editProjetoId`) — só submissão nova.
- **Sem** mexer no fluxo financeiro (saving/receita) nem no analisador.
- **Sem** alterar o BUG ABERTO de legado (não regredir; não "consertar de raspão").

### Blast-radius
Arquivos: `src/routes/submeter.tsx`, `src/lib/submeter/step2.tsx`, `src/lib/submeter/draft-storage.ts`,
(nova) função pura de validação da Etapa 2, `spec-docs/SPEC_FEATURES_NOVAS.md`, testes em `tests/`.
Dependentes: fluxo do agente (`chat.functions.ts` `iniciarSubmissao`/`atualizarMetadados`) — **reusado, não
alterado**. Invariantes: doc = texto concatenado (não por-arquivo); `iniciar-submissao` cria rascunho;
mudança de arquivos ⇒ reprocesso; edição não deve regredir. Confiança: **média** (F1 alta; F2 mexe em
estado do wizard sensível — mitigado por reusar `handleContinuarAgente` + testes + staging).
