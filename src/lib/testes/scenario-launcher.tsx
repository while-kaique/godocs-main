// Sidebar esquerda — seleção de cenários de teste + botão iniciar.

import { useState, useCallback, useMemo } from 'react';
import { SCENARIOS, type TestScenario } from './scenarios';
import { useTestesStore, type ChatMessage } from './use-testes-store';
import { createTestApiFetch } from './api-interceptor';

// ─── Estilos dark theme ─────────────────────────────────────────────────────

const S = {
  sidebar: {
    background: '#0d0d14',
    borderRight: '1px solid #1e1e2e',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    height: '100%',
  },
  header: {
    padding: '16px 16px 12px',
    borderBottom: '1px solid #1e1e2e',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#6b6e80',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px',
  },
  card: {
    padding: '10px 12px',
    marginBottom: 4,
    borderRadius: 8,
    border: '1px solid #1e1e2e',
    background: '#14141f',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  cardActive: {
    borderColor: '#0059A9',
    background: '#0a1a2f',
  },
  cardIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0e0',
  },
  cardDesc: {
    fontSize: 11,
    color: '#6b6e80',
    marginTop: 2,
    lineHeight: 1.4,
  },
  footer: {
    padding: '12px',
    borderTop: '1px solid #1e1e2e',
  },
  btn: {
    width: '100%',
    padding: '10px',
    borderRadius: 8,
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'Poppins, sans-serif',
  },
  btnPrimary: {
    background: '#0059A9',
    color: '#fff',
  },
  btnDisabled: {
    background: '#1e1e2e',
    color: '#4a4a5a',
    cursor: 'not-allowed',
  },
  statusBar: {
    padding: '8px 12px',
    fontSize: 11,
    color: '#6b6e80',
    borderTop: '1px solid #1e1e2e',
    fontFamily: 'monospace',
  },
} as const;

// ─── Componente ─────────────────────────────────────────────────────────────

export function ScenarioLauncher() {
  const [state, dispatch] = useTestesStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const testApiFetch = useMemo(
    () =>
      createTestApiFetch({
        forceError: state.forceError,
        slowMode: state.slowMode,
        onLog: (entry) => dispatch({ type: 'ADD_API_LOG', entry }),
      }),
    [state.forceError, state.slowMode, dispatch],
  );

  const selectScenario = useCallback(
    (scenario: TestScenario) => {
      dispatch({ type: 'SET_SCENARIO', scenario });
    },
    [dispatch],
  );

  const iniciar = useCallback(async () => {
    const scenario = state.currentScenarioData;
    if (!scenario) return;

    dispatch({ type: 'SET_LOADING', loading: true });

    try {
      const payload = {
        ...scenario.formData,
        docs: scenario.docs,
      };

      const result = await testApiFetch<{
        projeto_id: string;
        response: {
          type: string;
          content: string;
          options: string[] | null;
          fase: string;
          isPreview: boolean;
          isComplete: boolean;
          coletado: Record<string, unknown>;
          saving: Record<string, unknown>;
          receita: Record<string, unknown>;
        };
      }>('/api/chat/iniciar-submissao', payload);

      dispatch({ type: 'SET_PROJETO_ID', id: result.projeto_id });

      const resp = result.response;
      const msg: ChatMessage = {
        role: 'assistant',
        content: resp.content,
        rawJson: resp,
        options: resp.options ?? undefined,
        isPreview: resp.isPreview,
        fase: resp.fase as ChatMessage['fase'],
      };
      dispatch({ type: 'ADD_CHAT_MESSAGE', message: msg });
      dispatch({ type: 'SET_CHAT_FASE', fase: resp.fase as ChatMessage['fase'] ?? 'doc' });
      if (resp.coletado) dispatch({ type: 'SET_COLETADO', coletado: resp.coletado as never });
      if (resp.saving) dispatch({ type: 'SET_SAVING', saving: resp.saving as never });
      if (resp.receita) dispatch({ type: 'SET_RECEITA', receita: resp.receita as never });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: { role: 'assistant', content: `❌ Erro ao iniciar: ${errMsg}` },
      });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.currentScenarioData, testApiFetch, dispatch]);

  const canStart = !!state.activeScenario && !state.loading && !state.projetoId;
  const hasProjetoAtivo = !!state.projetoId;

  return (
    <div style={S.sidebar}>
      <div style={S.header}>Cenários de Teste</div>

      <div style={S.list}>
        {SCENARIOS.map((s) => {
          const isActive = state.activeScenario === s.id;
          const isHovered = hoveredId === s.id;
          return (
            <div
              key={s.id}
              style={{
                ...S.card,
                ...(isActive ? S.cardActive : {}),
                ...(isHovered && !isActive ? { borderColor: '#2a2a3f', background: '#18182a' } : {}),
              }}
              onClick={() => !hasProjetoAtivo && selectScenario(s)}
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={S.cardIcon}>{s.icon}</span>
                <span style={S.cardLabel}>{s.label}</span>
              </div>
              <div style={S.cardDesc}>{s.description}</div>
            </div>
          );
        })}
      </div>

      {state.projetoId && (
        <div style={S.statusBar}>
          projeto: {state.projetoId.slice(0, 12)}...
        </div>
      )}

      <div style={S.footer}>
        {hasProjetoAtivo ? (
          <button
            style={{ ...S.btn, background: '#2a1a1a', color: '#ff6b6b' }}
            onClick={() => dispatch({ type: 'RESET_ALL' })}
          >
            Resetar Simulação
          </button>
        ) : (
          <button
            style={{
              ...S.btn,
              ...(canStart ? S.btnPrimary : S.btnDisabled),
            }}
            onClick={iniciar}
            disabled={!canStart}
          >
            {state.loading ? 'Iniciando...' : 'Iniciar Simulação'}
          </button>
        )}
      </div>
    </div>
  );
}
