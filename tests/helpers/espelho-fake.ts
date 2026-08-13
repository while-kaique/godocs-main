// Fake em memória da camada de dados do ESPELHO, para os testes UNITÁRIOS que já mockam
// `@/integrations/db/client.server` inteiro (o `dashboard-admin.test.ts` nasceu assim, e
// trocar a suíte dele por banco real seria churn sem ganho de cobertura).
//
// ⚠️ Fake reproduz a INTENÇÃO, não o SQL. Quem cobre upsert por conflito, `IN (...)` e o
// JSON de ida-e-volta é `tests/sheet-espelho.test.ts` + `tests/dashboard-espelho.test.ts`,
// que rodam contra better-sqlite3 de verdade. Se um comportamento só passar aqui,
// desconfie do fake.
type Registro = {
  projeto_id: string;
  linha: string;
  linha_resumo: string;
  linha_hash: string | null;
  patch: string | null;
  escrito_em: string | null;
  lido_em: string | null;
};

export function criarEspelhoFake() {
  const tabela = new Map<string, Registro>();
  const runs: Record<string, unknown>[] = [];

  return {
    tabela,
    runs,
    limpar() {
      tabela.clear();
      runs.length = 0;
    },
    /** Só o que o espelho precisa — as demais funções do client são stubs no call site. */
    api: {
      getEspelhoIndice: async () =>
        [...tabela.values()].map((r) => ({
          projeto_id: r.projeto_id,
          linha_hash: r.linha_hash,
          patch: r.patch,
          escrito_em: r.escrito_em,
        })),
      getEspelhoResumos: async () =>
        [...tabela.values()].map((r) => ({
          projeto_id: r.projeto_id,
          linha_resumo: r.linha_resumo,
          lido_em: r.lido_em,
        })),
      getEspelhoLinha: async (id: string) => tabela.get(String(id).trim().toLowerCase()),
      getEspelhoLinhasPorIds: async (ids: string[]) =>
        ids
          .map((i) => tabela.get(String(i).trim().toLowerCase()))
          .filter((r): r is Registro => r != null),
      upsertEspelhoLinha: async (v: Registro) => {
        tabela.set(v.projeto_id, { ...v });
      },
      deleteEspelhoLinha: async (id: string) => {
        tabela.delete(String(id).trim().toLowerCase());
      },
      insertSyncRun: async (v: Record<string, unknown>) => {
        runs.unshift({ ...v, iniciado_em: new Date().toISOString() });
      },
      getUltimaSyncRun: async () => runs[0],
      getUltimaSyncRunOk: async () => runs.find((r) => r.ok === 1),
      getSyncRunsRecentes: async () => runs.slice(0, 20),
    },
  };
}
