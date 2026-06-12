// Cenários de teste — simulação completa do fluxo de submissão da IA.

import { createFileRoute } from '@tanstack/react-router';
import { useState, useRef, useCallback } from 'react';
import { TestesProvider, useTestesStore } from '@/lib/testes/use-testes-store';
import { ScenarioLauncher } from '@/lib/testes/scenario-launcher';
import { ChatSimulation } from '@/lib/testes/chat-simulation';
import { StateInspector } from '@/lib/testes/state-inspector';
import { ApiInspector } from '@/lib/testes/api-inspector';

export const Route = createFileRoute('/_authenticated/testes/cenarios')({
  head: () => ({
    meta: [{ title: 'Cenários de Teste · GoDocs Admin' }],
  }),
  component: CenariosPage,
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

// ─── Drag Handle (estilo VS Code terminal) ─────────────────────────────────

const MIN_PANEL_HEIGHT = 80;
const DEFAULT_PANEL_HEIGHT = 200;

function ResizableCenter() {
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromBottom = rect.bottom - ev.clientY;
      const clamped = Math.max(MIN_PANEL_HEIGHT, Math.min(fromBottom, rect.height - 120));
      setPanelHeight(clamped);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Chat — ocupa o espaço restante */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ChatSimulation />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          height: 6,
          cursor: 'row-resize',
          background: '#0d0d14',
          borderTop: '1px solid #1e1e2e',
          borderBottom: '1px solid #1e1e2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 40, height: 2, borderRadius: 1, background: '#2a2a3f' }} />
      </div>

      {/* API Inspector — altura controlada pelo drag */}
      <div style={{ height: panelHeight, overflow: 'hidden', flexShrink: 0 }}>
        <ApiInspector />
      </div>
    </div>
  );
}

// ─── Page Shell ─────────────────────────────────────────────────────────────

function CenariosPage() {
  return (
    <TestesProvider>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 320px',
          gridTemplateRows: 'auto 1fr',
          height: '100%',
          background: '#0a0a0f',
          color: '#e0e0e0',
          fontFamily: 'Poppins, sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* Left sidebar — spans all rows */}
        <div style={{ gridColumn: '1', gridRow: '1 / -1', overflow: 'hidden', minHeight: 0 }}>
          <ScenarioLauncher />
        </div>

        {/* Top bar — center + right */}
        <div style={{ gridColumn: '2 / 4', gridRow: '1' }}>
          <QuickActionsBar />
        </div>

        {/* Center: chat + resizable API inspector */}
        <div style={{ gridColumn: '2', gridRow: '2', overflow: 'hidden', minHeight: 0 }}>
          <ResizableCenter />
        </div>

        {/* State inspector — right */}
        <div style={{ gridColumn: '3', gridRow: '2', overflow: 'hidden', minHeight: 0 }}>
          <StateInspector />
        </div>
      </div>
    </TestesProvider>
  );
}
