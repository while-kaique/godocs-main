// Inspetor de Prompts — visualiza todos os system prompts dos agentes de IA.

import { useState, useMemo, useCallback, useRef } from 'react';
import { getPromptRegistry, AGENT_COLORS, type PromptEntry } from './prompt-registry';

// ─── Constantes de cor e estilo ─────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  doc: '#0059A9',
  doc_preview: '#3b82f6',
  saving: '#D7DB00',
  saving_preview: '#a3a600',
  receita: '#16a34a',
  receita_preview: '#15803d',
  completo: '#16a34a',
};

// ─── Syntax highlighting para prompt text ───────────────────────────────────

function highlightPromptLine(line: string, agentColor: string): string {
  let html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // ## headers → agent color
  if (/^##?\s/.test(html)) {
    return `<span style="color:${agentColor};font-weight:700">${html}</span>`;
  }
  // UPPERCASE LABELS: (like "REGRAS:", "FORMATO:", etc.)
  html = html.replace(/^([A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ _/()]+:)/g, `<span style="color:#e0e0e0;font-weight:600">$1</span>`);
  // **bold** → white
  html = html.replace(/\*\*([^*]+)\*\*/g, '<span style="color:#e0e0e0;font-weight:600">$1</span>');
  // `backtick` → accent dim
  html = html.replace(/`([^`]+)`/g, `<span style="color:${agentColor}88;background:#ffffff08;padding:0 3px;border-radius:2px">$1</span>`);
  // ${...} template expressions → orange
  html = html.replace(/(\$\{[^}]+\})/g, '<span style="color:#e8920c">$1</span>');
  // - bullet items
  if (/^\s*-\s/.test(html)) {
    html = html.replace(/^(\s*)(-)/, `$1<span style="color:${agentColor}">$2</span>`);
  }
  // numbered items
  if (/^\s*\d+\.\s/.test(html)) {
    html = html.replace(/^(\s*)(\d+\.)/, `$1<span style="color:${agentColor}">$2</span>`);
  }
  return html;
}

function renderPromptHtml(text: string, agentColor: string): string {
  return text.split('\n').map(line => highlightPromptLine(line, agentColor)).join('\n');
}

// ─── Estilos ────────────────────────────────────────────────────────────────

const S = {
  root: {
    display: 'flex',
    height: '100%',
    background: '#0a0a0f',
    color: '#e0e0e0',
    fontFamily: 'Poppins, sans-serif',
    overflow: 'hidden',
  },
  // Sidebar
  sidebar: {
    width: 270,
    minWidth: 270,
    background: '#0d0d14',
    borderRight: '1px solid #1e1e2e',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '16px 14px 12px',
    borderBottom: '1px solid #1e1e2e',
  },
  searchInput: {
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: '1px solid #2a2a3f',
    background: '#14141f',
    color: '#e0e0e0',
    fontSize: 12,
    fontFamily: 'Poppins, sans-serif',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  sidebarList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  },
  agentGroup: {
    marginBottom: 4,
  },
  agentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    userSelect: 'none' as const,
  },
  agentDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  agentChevron: {
    marginLeft: 'auto',
    fontSize: 10,
    color: '#3a3a4a',
    transition: 'transform 0.15s',
  },
  promptItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px 6px 30px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#8a8a9a',
    transition: 'all 0.12s',
    borderLeft: '2px solid transparent',
  },
  promptItemActive: {
    color: '#e0e0e0',
    background: '#14141f',
  },
  promptItemFaseBadge: {
    fontSize: 9,
    padding: '1px 6px',
    borderRadius: 10,
    fontWeight: 600 as const,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  // Main panel
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minWidth: 0,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    color: '#3a3a4a',
  },
  emptyIcon: {
    fontSize: 48,
    opacity: 0.3,
  },
  // Header
  header: {
    padding: '20px 24px 16px',
    borderBottom: '1px solid #1e1e2e',
    background: '#0d0d14',
    flexShrink: 0,
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap' as const,
  },
  functionName: {
    fontSize: 18,
    fontWeight: 700 as const,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '-0.02em',
  },
  badge: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600 as const,
    fontFamily: 'monospace',
  },
  filePath: {
    fontSize: 11,
    color: '#4a4a6a',
    fontFamily: "'JetBrains Mono', monospace",
  },
  // Info bar
  infoBar: {
    display: 'flex',
    gap: 12,
    padding: '12px 24px',
    borderBottom: '1px solid #1e1e2e',
    background: '#08080d',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  infoCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid #1e1e2e',
    background: '#0d0d14',
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
  },
  infoLabel: {
    color: '#4a4a6a',
    fontWeight: 600 as const,
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  infoValue: {
    color: '#a0a0b0',
  },
  // Description
  descSection: {
    padding: '14px 24px',
    borderBottom: '1px solid #1e1e2e',
    flexShrink: 0,
  },
  descTitle: {
    fontSize: 10,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#4a4a6a',
    marginBottom: 6,
  },
  descText: {
    fontSize: 13,
    lineHeight: 1.6,
    color: '#b0b0c0',
  },
  contextParams: {
    display: 'flex',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap' as const,
  },
  paramBadge: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid #2a2a3f',
    background: '#14141f',
    color: '#8a8a9a',
    fontFamily: "'JetBrains Mono', monospace",
  },
  // Code viewer
  codeContainer: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
  },
  codeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 24px',
    background: '#08080d',
    borderBottom: '1px solid #1e1e2e',
    flexShrink: 0,
  },
  codeTitle: {
    fontSize: 10,
    fontWeight: 700 as const,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#4a4a6a',
  },
  copyBtn: {
    marginLeft: 'auto',
    padding: '3px 10px',
    borderRadius: 4,
    border: '1px solid #2a2a3f',
    background: 'transparent',
    color: '#6b6e80',
    fontSize: 10,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
    transition: 'all 0.15s',
  },
  codeScroll: {
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
  },
  codeBlock: {
    display: 'flex',
    margin: 0,
    padding: 0,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontSize: 12,
    lineHeight: 1.65,
    tabSize: 2,
  },
  lineNumbers: {
    padding: '16px 0',
    textAlign: 'right' as const,
    color: '#2a2a3f',
    userSelect: 'none' as const,
    minWidth: 48,
    paddingRight: 12,
    borderRight: '1px solid #1a1a28',
    flexShrink: 0,
    fontSize: 11,
  },
  codeContent: {
    flex: 1,
    padding: '16px 20px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflowX: 'auto' as const,
    color: '#8a8a9a',
  },
  charCount: {
    fontSize: 10,
    color: '#3a3a4a',
    fontFamily: 'monospace',
  },
} as const;

// ─── Componente ─────────────────────────────────────────────────────────────

export function PromptInspector() {
  const registry = useMemo(() => getPromptRegistry(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => registry.find(p => p.id === selectedId) ?? null,
    [registry, selectedId],
  );

  const promptText = useMemo(
    () => selected?.getPromptText() ?? '',
    [selected],
  );

  const promptHtml = useMemo(
    () => selected ? renderPromptHtml(promptText, selected.agentColor) : '',
    [promptText, selected],
  );

  const lines = useMemo(() => promptText.split('\n'), [promptText]);

  // Group by agent
  const grouped = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const filtered = search
      ? registry.filter(p =>
          p.functionName.toLowerCase().includes(lowerSearch) ||
          p.description.toLowerCase().includes(lowerSearch) ||
          p.agent.toLowerCase().includes(lowerSearch) ||
          (p.fase ?? '').toLowerCase().includes(lowerSearch))
      : registry;

    const map = new Map<string, PromptEntry[]>();
    for (const p of filtered) {
      const arr = map.get(p.agent) ?? [];
      arr.push(p);
      map.set(p.agent, arr);
    }
    return map;
  }, [registry, search]);

  const toggleAgent = useCallback((agent: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [promptText]);

  return (
    <div style={S.root}>
      {/* ── Sidebar ── */}
      <div style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <input
            style={S.searchInput}
            type="text"
            placeholder="Buscar prompts..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={S.sidebarList}>
          {[...grouped.entries()].map(([agent, prompts]) => {
            const color = prompts[0]?.agentColor ?? '#6b6e80';
            const isCollapsed = collapsedAgents.has(agent);
            return (
              <div key={agent} style={S.agentGroup}>
                <div
                  style={{ ...S.agentHeader, color }}
                  onClick={() => toggleAgent(agent)}
                >
                  <div style={{ ...S.agentDot, background: color }} />
                  {agent}
                  <span style={{ fontSize: 10, fontWeight: 400, color: '#3a3a4a', textTransform: 'none', letterSpacing: 0 }}>
                    ({prompts.length})
                  </span>
                  <span style={{ ...S.agentChevron, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                    ▼
                  </span>
                </div>
                {!isCollapsed && prompts.map(p => {
                  const isActive = selectedId === p.id;
                  const phaseColor = p.fase ? PHASE_COLORS[p.fase] ?? '#6b6e80' : undefined;
                  return (
                    <div
                      key={p.id}
                      style={{
                        ...S.promptItem,
                        ...(isActive ? {
                          ...S.promptItemActive,
                          borderLeftColor: color,
                        } : {}),
                      }}
                      onClick={() => setSelectedId(p.id)}
                      onMouseEnter={e => {
                        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#0f0f1a';
                      }}
                      onMouseLeave={e => {
                        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                      }}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.functionName}
                      </span>
                      {p.fase && phaseColor && (
                        <span style={{
                          ...S.promptItemFaseBadge,
                          background: phaseColor + '18',
                          color: phaseColor,
                          border: `1px solid ${phaseColor}30`,
                        }}>
                          {p.fase}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {grouped.size === 0 && (
            <div style={{ padding: '20px 14px', color: '#3a3a4a', fontSize: 12, textAlign: 'center' }}>
              Nenhum prompt encontrado
            </div>
          )}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid #1e1e2e', fontSize: 10, color: '#2a2a3a', fontFamily: 'monospace' }}>
          {registry.length} prompts registrados
        </div>
      </div>

      {/* ── Main Panel ── */}
      <div style={S.main}>
        {!selected ? (
          <div style={S.emptyState}>
            <div style={S.emptyIcon}>{'{ }'}</div>
            <div style={{ fontSize: 14 }}>Selecione um prompt na sidebar</div>
            <div style={{ fontSize: 11, maxWidth: 300, textAlign: 'center', lineHeight: 1.5 }}>
              Os prompts são carregados dinamicamente das funções reais dos agentes — alterações no código se refletem aqui automaticamente.
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={S.header}>
              <div style={S.headerTop}>
                <span style={{ ...S.functionName, color: selected.agentColor }}>
                  {selected.functionName}
                </span>
                <span style={{
                  ...S.badge,
                  background: selected.agentColor + '18',
                  color: selected.agentColor,
                  border: `1px solid ${selected.agentColor}30`,
                }}>
                  {selected.agent}
                </span>
                {selected.fase && (
                  <span style={{
                    ...S.badge,
                    background: (PHASE_COLORS[selected.fase] ?? '#6b6e80') + '18',
                    color: PHASE_COLORS[selected.fase] ?? '#6b6e80',
                    border: `1px solid ${(PHASE_COLORS[selected.fase] ?? '#6b6e80')}30`,
                  }}>
                    fase: {selected.fase}
                  </span>
                )}
              </div>
              <div style={S.filePath}>{selected.filePath}</div>
            </div>

            {/* Info bar */}
            <div style={S.infoBar}>
              <div style={S.infoCard}>
                <span style={S.infoLabel}>temp</span>
                <span style={S.infoValue}>{selected.llmParams.temperature}</span>
              </div>
              <div style={S.infoCard}>
                <span style={S.infoLabel}>tokens</span>
                <span style={S.infoValue}>{selected.llmParams.maxTokens.toLocaleString()}</span>
              </div>
              <div style={S.infoCard}>
                <span style={S.infoLabel}>modelo</span>
                <span style={{
                  ...S.infoValue,
                  color: selected.llmParams.modelTier === 'strong' ? '#e8920c' : '#16a34a',
                }}>
                  {selected.llmParams.modelTier === 'strong' ? 'LLM_MODEL' : 'LLM_MODEL_FAST'}
                </span>
              </div>
              <div style={S.infoCard}>
                <span style={S.infoLabel}>json</span>
                <span style={{ ...S.infoValue, color: selected.llmParams.jsonMode ? '#16a34a' : '#e53e3e' }}>
                  {selected.llmParams.jsonMode ? 'sim' : 'não'}
                </span>
              </div>
            </div>

            {/* Description */}
            <div style={S.descSection}>
              <div style={S.descTitle}>Descrição</div>
              <div style={S.descText}>{selected.description}</div>
              <div style={S.contextParams}>
                {selected.contextParams.map(p => (
                  <span key={p} style={S.paramBadge}>{p}</span>
                ))}
              </div>
            </div>

            {/* Code viewer */}
            <div style={S.codeContainer}>
              <div style={S.codeHeader}>
                <span style={S.codeTitle}>System Prompt</span>
                <span style={S.charCount}>
                  {lines.length} linhas · {promptText.length.toLocaleString()} chars · ~{Math.ceil(promptText.length / 4).toLocaleString()} tokens
                </span>
                <button
                  style={{
                    ...S.copyBtn,
                    ...(copied ? { color: '#16a34a', borderColor: '#16a34a40' } : {}),
                  }}
                  onClick={handleCopy}
                >
                  {copied ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <div style={S.codeScroll} ref={codeRef}>
                <div style={S.codeBlock}>
                  <div style={S.lineNumbers}>
                    {lines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <pre
                    style={S.codeContent}
                    dangerouslySetInnerHTML={{ __html: promptHtml }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
