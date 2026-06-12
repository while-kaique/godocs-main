// Painel inferior — log de chamadas API com status, timing e JSON expandível.

import { useState } from 'react';
import { useTestesStore } from './use-testes-store';
import type { ApiLogEntry } from './api-interceptor';

// ─── JSON Highlight ─────────────────────────────────────────────────────────

function highlightJson(obj: unknown, maxChars = 3000): string {
  const raw = JSON.stringify(obj, null, 2) ?? '';
  const text = raw.length > maxChars ? raw.slice(0, maxChars) + '\n... (truncado)' : raw;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#569cd6">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#ce9178">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#b5cea8">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span style="color:#569cd6">$1</span>');
}

// ─── Estilos ────────────────────────────────────────────────────────────────

const S = {
  panel: {
    background: '#08080d',
    borderTop: '1px solid #1e1e2e',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 12px',
    borderBottom: '1px solid #1e1e2e',
    background: '#0d0d14',
    flexShrink: 0,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#6b6e80',
  },
  filterSelect: {
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid #2a2a3f',
    background: '#14141f',
    color: '#a0a0b0',
    fontSize: 10,
    fontFamily: 'monospace',
    outline: 'none',
  },
  clearBtn: {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid #2a2a3f',
    background: 'transparent',
    color: '#6b6e80',
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #0f0f18',
    transition: 'background 0.1s',
  },
  methodBadge: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  statusBadge: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 9,
    fontWeight: 700,
  },
  durationBadge: {
    fontSize: 9,
    color: '#4a4a6a',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  expandedArea: {
    padding: '8px 12px 8px 32px',
    borderBottom: '1px solid #1a1a28',
  },
  jsonLabel: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    color: '#4a4a6a',
    marginBottom: 4,
    marginTop: 6,
  },
  jsonPre: {
    padding: 8,
    borderRadius: 4,
    background: '#0a0a12',
    border: '1px solid #1a1a28',
    fontSize: 10,
    lineHeight: 1.4,
    overflowX: 'auto' as const,
    maxHeight: 160,
    overflowY: 'auto' as const,
    color: '#a0a0b0',
    margin: 0,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#2a2a3a',
    fontSize: 12,
    fontStyle: 'italic' as const,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function statusColor(status: number | null): { bg: string; color: string } {
  if (status === null || status === 0) return { bg: '#eab30820', color: '#eab308' };
  if (status >= 200 && status < 300) return { bg: '#16a34a20', color: '#16a34a' };
  if (status >= 400 && status < 500) return { bg: '#e53e3e20', color: '#e53e3e' };
  return { bg: '#dc262620', color: '#dc2626' };
}

function methodColor(method: string): { bg: string; color: string } {
  if (method === 'GET') return { bg: '#4ec9b020', color: '#4ec9b0' };
  return { bg: '#569cd620', color: '#569cd6' };
}

const FILTER_OPTIONS = [
  { label: 'Todos', value: '' },
  { label: 'iniciar-submissao', value: '/api/chat/iniciar-submissao' },
  { label: 'enviar-mensagem', value: '/api/chat/enviar-mensagem' },
  { label: 'iniciar-saving', value: '/api/chat/iniciar-saving' },
  { label: 'iniciar-receita', value: '/api/chat/iniciar-receita' },
  { label: 'atualizar-tipos', value: '/api/chat/atualizar-tipos' },
  { label: 'analisar', value: '/api/chat/analisar' },
  { label: 'submeter-validacao', value: '/api/chat/submeter-validacao' },
];

// ─── Componente ─────────────────────────────────────────────────────────────

export function ApiInspector() {
  const [state, dispatch] = useTestesStore();
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const logs = filter ? state.apiLogs.filter((l) => l.url === filter) : state.apiLogs;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={S.panel}>
      <div style={S.toolbar}>
        <span style={S.title}>API Inspector</span>
        <select style={S.filterSelect} value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: '#4a4a6a' }}>{logs.length} chamada(s)</span>
        <button style={S.clearBtn} onClick={() => dispatch({ type: 'CLEAR_API_LOGS' })}>
          Limpar
        </button>
      </div>

      <div style={S.list}>
        {logs.length === 0 ? (
          <div style={S.empty}>Nenhuma chamada registrada</div>
        ) : (
          logs.map((log) => (
            <LogRow key={log.id} log={log} expanded={expanded.has(log.id)} onToggle={() => toggle(log.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function LogRow({ log, expanded, onToggle }: { log: ApiLogEntry; expanded: boolean; onToggle: () => void }) {
  const mc = methodColor(log.method);
  const sc = statusColor(log.status);
  const urlShort = log.url.replace('/api/chat/', '').replace('/api/', '');
  const time = new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour12: false });

  return (
    <>
      <div
        style={{ ...S.row, background: expanded ? '#0d0d18' : 'transparent' }}
        onClick={onToggle}
      >
        <span style={{ fontSize: 9, color: '#3a3a4a' }}>{time}</span>
        <span style={{ ...S.methodBadge, background: mc.bg, color: mc.color }}>{log.method}</span>
        <span style={{ color: '#a0a0b0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{urlShort}</span>
        <span style={{ ...S.statusBadge, background: sc.bg, color: sc.color }}>{log.status ?? '—'}</span>
        <span style={S.durationBadge}>{log.duration}ms</span>
        <span style={{ color: '#3a3a4a', fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div style={S.expandedArea}>
          {log.error && (
            <div style={{ color: '#e53e3e', fontSize: 10, marginBottom: 6 }}>
              Erro: {log.error}
            </div>
          )}
          {log.requestBody !== null && (
            <>
              <div style={S.jsonLabel}>Request</div>
              <pre style={S.jsonPre} dangerouslySetInnerHTML={{ __html: highlightJson(log.requestBody) }} />
            </>
          )}
          {log.responseBody !== null && (
            <>
              <div style={S.jsonLabel}>Response</div>
              <pre style={S.jsonPre} dangerouslySetInnerHTML={{ __html: highlightJson(log.responseBody) }} />
            </>
          )}
        </div>
      )}
    </>
  );
}
