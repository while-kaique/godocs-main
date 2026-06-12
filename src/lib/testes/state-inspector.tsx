// Sidebar direita — state machine visual + campos preenchidos por fase.

import { useTestesStore } from './use-testes-store';
import type { ChatFase, DocumentacaoColetada, SavingColetado, ReceitaColetada } from '@/lib/agents/types';

// ─── Helpers de progresso (espelham chat.functions.ts) ──────────────────────

const DOC_LABELS: Record<string, string> = {
  nome_projeto: 'nome do projeto',
  o_que_faz: 'o que faz',
  execucao: 'execução',
  dependencias: 'dependências',
  fluxo: 'fluxo',
  configurar_antes: 'configurar antes',
  atencao: 'atenção/riscos',
};

function docProgress(c: DocumentacaoColetada) {
  const entries = Object.entries(c);
  const filled = entries.filter(([, v]) => v !== null).length;
  const missing = entries.filter(([, v]) => v === null).map(([k]) => DOC_LABELS[k] ?? k);
  return { filled, total: entries.length, missing };
}

function savingProgress(s: SavingColetado) {
  const checks: [string, boolean][] = [
    ['pessoas/cargos', s.linhas != null && s.linhas.length > 0],
    ['economia de horas', s.economia_horas_mes != null],
    ['tipo de saving', s.tipo_saving != null],
    ['memorial de cálculo', s.memorial_calculo != null],
  ];
  return {
    filled: checks.filter(([, ok]) => ok).length,
    total: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([n]) => n),
  };
}

function receitaProgress(r: ReceitaColetada) {
  const checks: [string, boolean][] = [
    ['tipo de ganho', r.tipo_saving != null],
    ['valor de receita', r.valor_ganho_mensal != null],
    ['memorial de cálculo', r.memorial_calculo != null],
  ];
  return {
    filled: checks.filter(([, ok]) => ok).length,
    total: checks.length,
    missing: checks.filter(([, ok]) => !ok).map(([n]) => n),
  };
}

// ─── State Machine Phases ───────────────────────────────────────────────────

const PHASES: ChatFase[] = ['doc', 'doc_preview', 'saving', 'saving_preview', 'receita', 'receita_preview', 'completo'];

const PHASE_LABELS: Record<string, string> = {
  doc: 'Documentação',
  doc_preview: 'Preview Doc',
  saving: 'Saving',
  saving_preview: 'Preview Saving',
  receita: 'Receita',
  receita_preview: 'Preview Receita',
  completo: 'Completo',
};

function phaseIndex(fase: ChatFase): number {
  return PHASES.indexOf(fase);
}

// ─── Estilos ────────────────────────────────────────────────────────────────

const S = {
  sidebar: {
    background: '#0d0d14',
    borderLeft: '1px solid #1e1e2e',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
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
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: '#4a4a6a',
    marginBottom: 8,
  },
  phaseNode: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
    transition: 'all 0.2s',
  },
  phaseArrow: {
    textAlign: 'center' as const,
    color: '#2a2a3a',
    fontSize: 10,
    lineHeight: '12px',
    paddingLeft: 14,
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '3px 0',
    fontSize: 11,
    borderBottom: '1px solid #0f0f18',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
  },
  fieldLabel: {
    color: '#6b6e80',
    minWidth: 90,
    flexShrink: 0,
  },
  fieldValue: {
    color: '#a0a0b0',
    fontFamily: 'monospace',
    fontSize: 10,
    wordBreak: 'break-all' as const,
    flex: 1,
  },
  progressLine: {
    padding: '6px 8px',
    borderRadius: 6,
    background: '#14141f',
    border: '1px solid #1e1e2e',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 6,
    lineHeight: 1.5,
  },
  projetoId: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#569cd6',
    padding: '4px 8px',
    background: '#0a0a18',
    borderRadius: 4,
    cursor: 'pointer',
    border: '1px solid #1e1e2e',
    wordBreak: 'break-all' as const,
  },
};

// ─── Componente ─────────────────────────────────────────────────────────────

export function StateInspector() {
  const [state] = useTestesStore();
  const currentIdx = phaseIndex(state.chatFase);

  const doc = docProgress(state.coletado);
  const sav = savingProgress(state.saving);
  const rec = receitaProgress(state.receita);

  const truncate = (val: unknown, max = 50): string => {
    if (val === null || val === undefined) return 'null';
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    return s.length > max ? s.slice(0, max) + '…' : s;
  };

  return (
    <div style={S.sidebar}>
      <div style={S.header}>Estado da Simulação</div>

      <div style={S.content}>
        {/* Projeto ID */}
        {state.projetoId && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Projeto</div>
            <div
              style={S.projetoId}
              onClick={() => navigator.clipboard.writeText(state.projetoId!)}
              title="Clique para copiar"
            >
              {state.projetoId}
            </div>
          </div>
        )}

        {/* State Machine */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Máquina de Estados</div>
          {PHASES.map((phase, i) => {
            const isActive = i === currentIdx;
            const isPast = i < currentIdx;
            let bg = '#14141f';
            let color = '#3a3a4a';
            let border = '1px solid #1e1e2e';
            if (isActive) { bg = '#0059A9'; color = '#fff'; border = '1px solid #0059A9'; }
            else if (isPast) { bg = '#0a1a0a'; color = '#16a34a'; border = '1px solid #16a34a40'; }

            return (
              <div key={phase}>
                <div style={{ ...S.phaseNode, background: bg, color, border }}>
                  {isPast && <span>✓</span>}
                  {isActive && <span>▶</span>}
                  {!isPast && !isActive && <span style={{ opacity: 0.3 }}>○</span>}
                  {PHASE_LABELS[phase]}
                </div>
                {i < PHASES.length - 1 && <div style={S.phaseArrow}>│</div>}
              </div>
            );
          })}
        </div>

        {/* Documentação */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Documentação ({doc.filled}/{doc.total})</div>
          {Object.entries(state.coletado).map(([key, val]) => (
            <div key={key} style={S.fieldRow}>
              <div style={{ ...S.dot, background: val !== null ? '#16a34a' : '#e53e3e' }} />
              <div style={S.fieldLabel}>{DOC_LABELS[key] ?? key}</div>
              <div style={S.fieldValue}>{truncate(val)}</div>
            </div>
          ))}
          <div style={{ ...S.progressLine, color: doc.missing.length === 0 ? '#16a34a' : '#e0e0e0' }}>
            {doc.missing.length === 0
              ? `documentação ${doc.filled}/${doc.total} ✓ completa`
              : `documentação ${doc.filled}/${doc.total} (falta: ${doc.missing.join(', ')})`}
          </div>
        </div>

        {/* Saving */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Saving ({sav.filled}/{sav.total})</div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: (state.saving.linhas?.length ?? 0) > 0 ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>linhas</div>
            <div style={S.fieldValue}>{state.saving.linhas?.length ?? 0} pessoa(s)</div>
          </div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.saving.economia_horas_mes != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>economia h/mês</div>
            <div style={S.fieldValue}>{state.saving.economia_horas_mes ?? 'null'}</div>
          </div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.saving.tipo_saving != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>tipo saving</div>
            <div style={S.fieldValue}>{state.saving.tipo_saving ?? 'null'}</div>
          </div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.saving.memorial_calculo != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>memorial</div>
            <div style={S.fieldValue}>{truncate(state.saving.memorial_calculo, 60)}</div>
          </div>
          <div style={{ ...S.progressLine, color: sav.missing.length === 0 ? '#16a34a' : '#e0e0e0' }}>
            {sav.missing.length === 0
              ? `saving ${sav.filled}/${sav.total} ✓ completo`
              : `saving ${sav.filled}/${sav.total} (falta: ${sav.missing.join(', ')})`}
          </div>
        </div>

        {/* Receita */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Receita ({rec.filled}/{rec.total})</div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.receita.tipo_saving != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>tipo ganho</div>
            <div style={S.fieldValue}>{state.receita.tipo_saving ?? 'null'}</div>
          </div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.receita.valor_ganho_mensal != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>valor/mês</div>
            <div style={S.fieldValue}>{state.receita.valor_ganho_mensal != null ? `R$ ${state.receita.valor_ganho_mensal}` : 'null'}</div>
          </div>
          <div style={S.fieldRow}>
            <div style={{ ...S.dot, background: state.receita.memorial_calculo != null ? '#16a34a' : '#e53e3e' }} />
            <div style={S.fieldLabel}>memorial</div>
            <div style={S.fieldValue}>{truncate(state.receita.memorial_calculo, 60)}</div>
          </div>
          <div style={{ ...S.progressLine, color: rec.missing.length === 0 ? '#16a34a' : '#e0e0e0' }}>
            {rec.missing.length === 0
              ? `receita ${rec.filled}/${rec.total} ✓ completa`
              : `receita ${rec.filled}/${rec.total} (falta: ${rec.missing.join(', ')})`}
          </div>
        </div>
      </div>
    </div>
  );
}
