// Página de testes/simulação — developer tool para observar o comportamento da IA.

import { createFileRoute } from '@tanstack/react-router';
import { TestesProvider, useTestesStore } from '@/lib/testes/use-testes-store';
import { ScenarioLauncher } from '@/lib/testes/scenario-launcher';
import { ChatSimulation } from '@/lib/testes/chat-simulation';
import { StateInspector } from '@/lib/testes/state-inspector';
import { ApiInspector } from '@/lib/testes/api-inspector';

export const Route = createFileRoute('/_authenticated/testes')({
  head: () => ({
    meta: [{ title: 'Testes · GoDocs Admin' }],
  }),
  component: TestesPage,
});

// ─── Quick Actions Bar ──────────────────────────────────────────────────────

function QuickActionsBar() {
  const [state, dispatch] = useTestesStore();

  const toggleStyle = (active: boolean, colorActive: string) => ({
    padding: '5px 12px',
    borderRadius: 6,
    border: active ? `1px solid ${colorActive}` : '1px solid #2a2a3f',
    background: active ? colorActive + '15' : '#14141f',
    color: active ? colorActive : '#6b6e80',
    fontSize: 11,
    fontWeight: 600 as const,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
    transition: 'all 0.15s',
    boxShadow: active ? `0 0 12px ${colorActive}30` : 'none',
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        background: '#0d0d14',
        borderBottom: '1px solid #1e1e2e',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b6e80', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>
        Ações
      </span>

      <button
        style={{
          padding: '5px 12px',
          borderRadius: 6,
          border: '1px solid #2a2a3f',
          background: '#14141f',
          color: '#6b6e80',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'Poppins, sans-serif',
        }}
        onClick={() => dispatch({ type: 'RESET_ALL' })}
      >
        Resetar
      </button>

      <div style={{ width: 1, height: 20, background: '#1e1e2e' }} />

      <button
        style={toggleStyle(state.forceError, '#e53e3e')}
        onClick={() => dispatch({ type: 'TOGGLE_FORCE_ERROR' })}
      >
        {state.forceError ? '● Forçar Erro ON' : '○ Forçar Erro'}
      </button>

      <button
        style={toggleStyle(state.slowMode, '#eab308')}
        onClick={() => dispatch({ type: 'TOGGLE_SLOW_MODE' })}
      >
        {state.slowMode ? '● Modo Lento ON' : '○ Modo Lento'}
      </button>

      <div style={{ flex: 1 }} />

      <span style={{ fontSize: 10, color: '#3a3a4a', fontFamily: 'monospace' }}>
        GoDocs Test Console
      </span>
    </div>
  );
}

// ─── Page Shell ─────────────────────────────────────────────────────────────

function TestesPageInner() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr 320px',
        gridTemplateRows: 'auto 1fr 240px',
        height: '100vh',
        background: '#0a0a0f',
        color: '#e0e0e0',
        fontFamily: 'Poppins, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Left sidebar — spans all rows */}
      <div style={{ gridColumn: '1', gridRow: '1 / -1' }}>
        <ScenarioLauncher />
      </div>

      {/* Top bar — center + right */}
      <div style={{ gridColumn: '2 / 4', gridRow: '1' }}>
        <QuickActionsBar />
      </div>

      {/* Chat — center */}
      <div style={{ gridColumn: '2', gridRow: '2' }}>
        <ChatSimulation />
      </div>

      {/* State inspector — right, rows 2-3 */}
      <div style={{ gridColumn: '3', gridRow: '2 / 4' }}>
        <StateInspector />
      </div>

      {/* API inspector — bottom center */}
      <div style={{ gridColumn: '2', gridRow: '3' }}>
        <ApiInspector />
      </div>
    </div>
  );
}

function TestesPage() {
  return (
    <TestesProvider>
      <TestesPageInner />
    </TestesProvider>
  );
}
