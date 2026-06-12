// Centro da página — chat com raw JSON, preview, forms de saving/receita inline.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTestesStore, type ChatMessage } from './use-testes-store';
import { createTestApiFetch } from './api-interceptor';
import { SimpleMarkdown } from '@/lib/submeter/step3-chat';
import { MOCK_SAVING_FORM, MOCK_RECEITA_FORM, MOCK_COLETADO_COMPLETO } from './scenarios';
import type { ChatFase } from '@/lib/agents/types';

// ─── JSON Syntax Highlighter ────────────────────────────────────────────────

function highlightJson(obj: unknown, maxChars = 5000): string {
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
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#08080d',
    overflow: 'hidden',
  },
  phaseBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderBottom: '1px solid #1e1e2e',
    background: '#0d0d14',
    fontSize: 12,
    flexShrink: 0,
  },
  phaseBadge: {
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#3a3a4a',
    fontSize: 14,
    fontStyle: 'italic' as const,
  },
  userBubble: {
    alignSelf: 'flex-end' as const,
    maxWidth: '75%',
    padding: '10px 14px',
    borderRadius: '16px 16px 4px 16px',
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  assistantBubble: {
    alignSelf: 'flex-start' as const,
    maxWidth: '85%',
    padding: '12px 14px',
    borderRadius: '16px 16px 16px 4px',
    fontSize: 13,
    lineHeight: 1.5,
  },
  jsonToggle: {
    fontSize: 10,
    color: '#4a4a6a',
    cursor: 'pointer',
    marginTop: 6,
    fontFamily: 'monospace',
    userSelect: 'none' as const,
  },
  jsonBlock: {
    marginTop: 6,
    padding: 8,
    borderRadius: 6,
    background: '#0a0a12',
    border: '1px solid #1a1a28',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 1.4,
    overflowX: 'auto' as const,
    maxHeight: 200,
    overflowY: 'auto' as const,
    color: '#a0a0b0',
  },
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid #1e1e2e',
    background: '#0d0d14',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #2a2a3f',
    background: '#14141f',
    color: '#e0e0e0',
    fontSize: 13,
    fontFamily: 'Poppins, sans-serif',
    outline: 'none',
    resize: 'none' as const,
  },
  sendBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#0059A9',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
    whiteSpace: 'nowrap' as const,
  },
  optionBtn: {
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #2a2a3f',
    background: '#14141f',
    color: '#a0a0c0',
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
    transition: 'all 0.15s',
  },
  inlineForm: {
    padding: '12px 16px',
    borderTop: '1px solid #1e1e2e',
    background: '#0d0d14',
    flexShrink: 0,
  },
  formTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#D7DB00',
    marginBottom: 8,
  },
  formBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#D7DB00',
    color: '#000',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Poppins, sans-serif',
    marginTop: 8,
  },
};

// ─── Phase helpers ──────────────────────────────────────────────────────────

function phaseColor(fase: ChatFase): string {
  switch (fase) {
    case 'doc':
    case 'doc_preview':
      return '#0059A9';
    case 'saving':
    case 'saving_preview':
    case 'receita':
    case 'receita_preview':
      return '#D7DB00';
    case 'completo':
      return '#16a34a';
    default:
      return '#6b6e80';
  }
}

function phaseLabel(fase: ChatFase): string {
  const labels: Record<string, string> = {
    doc: 'Documentação',
    doc_preview: 'Preview Doc',
    saving: 'Saving',
    saving_preview: 'Preview Saving',
    receita: 'Receita',
    receita_preview: 'Preview Receita',
    completo: 'Completo',
  };
  return labels[fase] ?? fase;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function ChatSimulation() {
  const [state, dispatch] = useTestesStore();
  const [input, setInput] = useState('');
  const [expandedJson, setExpandedJson] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const isSaving = state.chatFase === 'saving' || state.chatFase === 'saving_preview'
    || state.chatFase === 'receita' || state.chatFase === 'receita_preview';

  const testApiFetch = useMemo(
    () =>
      createTestApiFetch({
        forceError: state.forceError,
        slowMode: state.slowMode,
        onLog: (entry) => dispatch({ type: 'ADD_API_LOG', entry }),
      }),
    [state.forceError, state.slowMode, dispatch],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatMessages.length]);

  // Detectar se devemos mostrar o form de saving/receita
  useEffect(() => {
    if (state.chatFase === 'saving' && state.chatMessages.length > 0 && !state.showSavingForm) {
      const lastMsg = state.chatMessages[state.chatMessages.length - 1];
      if (lastMsg.role === 'assistant' && lastMsg.fase === 'saving') {
        // Transição doc → saving: mostra form
      }
    }
  }, [state.chatFase, state.chatMessages, state.showSavingForm]);

  const sendMessage = useCallback(
    async (content: string, selectedOption?: number) => {
      if (!state.projetoId || !content.trim()) return;

      dispatch({ type: 'ADD_CHAT_MESSAGE', message: { role: 'user', content } });
      dispatch({ type: 'SET_LOADING', loading: true });
      setInput('');

      try {
        const resp = await testApiFetch<{
          type: string;
          content: string;
          options: string[] | null;
          fase: string;
          isPreview: boolean;
          isComplete: boolean;
          coletado: Record<string, unknown>;
          saving: Record<string, unknown>;
          receita: Record<string, unknown>;
        }>('/api/chat/enviar-mensagem', {
          projeto_id: state.projetoId,
          content,
          selected_option: selectedOption,
        });

        const prevFase = state.chatFase;
        const newFase = (resp.fase as ChatFase) ?? state.chatFase;

        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            role: 'assistant',
            content: resp.content,
            rawJson: resp,
            options: resp.options ?? undefined,
            isPreview: resp.isPreview,
            fase: newFase,
          },
        });
        dispatch({ type: 'SET_CHAT_FASE', fase: newFase });
        if (resp.coletado) dispatch({ type: 'SET_COLETADO', coletado: resp.coletado as never });
        if (resp.saving) dispatch({ type: 'SET_SAVING', saving: resp.saving as never });
        if (resp.receita) dispatch({ type: 'SET_RECEITA', receita: resp.receita as never });

        // Transição doc_preview → saving/receita: mostrar form
        if (prevFase === 'doc_preview' && (newFase === 'saving' || newFase === 'receita')) {
          if (newFase === 'saving') dispatch({ type: 'SET_SHOW_SAVING_FORM', show: true });
          else dispatch({ type: 'SET_SHOW_RECEITA_FORM', show: true });
        }
        // Transição saving_preview → receita: mostrar form receita
        if (prevFase === 'saving_preview' && newFase === 'receita') {
          dispatch({ type: 'SET_SHOW_RECEITA_FORM', show: true });
        }

        if (resp.isComplete || newFase === 'completo') {
          dispatch({ type: 'SET_CHAT_COMPLETE', complete: true });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: { role: 'assistant', content: `❌ Erro: ${errMsg}` },
        });
      } finally {
        dispatch({ type: 'SET_LOADING', loading: false });
      }
    },
    [state.projetoId, state.chatFase, testApiFetch, dispatch],
  );

  const handleSavingSubmit = useCallback(async () => {
    if (!state.projetoId) return;
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_SHOW_SAVING_FORM', show: false });

    try {
      const resp = await testApiFetch<{
        type: string;
        content: string;
        options: string[] | null;
        fase: string;
        isPreview: boolean;
        isComplete: boolean;
        coletado: Record<string, unknown>;
        saving: Record<string, unknown>;
        receita: Record<string, unknown>;
      }>('/api/chat/iniciar-saving', {
        projeto_id: state.projetoId,
        ...MOCK_SAVING_FORM,
      });

      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          role: 'assistant',
          content: resp.content,
          rawJson: resp,
          options: resp.options ?? undefined,
          fase: resp.fase as ChatFase,
        },
      });
      dispatch({ type: 'SET_CHAT_FASE', fase: resp.fase as ChatFase });
      if (resp.saving) dispatch({ type: 'SET_SAVING', saving: resp.saving as never });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro';
      dispatch({ type: 'ADD_CHAT_MESSAGE', message: { role: 'assistant', content: `❌ ${errMsg}` } });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.projetoId, testApiFetch, dispatch]);

  const handleReceitaSubmit = useCallback(async () => {
    if (!state.projetoId) return;
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_SHOW_RECEITA_FORM', show: false });

    try {
      const resp = await testApiFetch<{
        type: string;
        content: string;
        options: string[] | null;
        fase: string;
        isPreview: boolean;
        isComplete: boolean;
        coletado: Record<string, unknown>;
        saving: Record<string, unknown>;
        receita: Record<string, unknown>;
      }>('/api/chat/iniciar-receita', {
        projeto_id: state.projetoId,
        ...MOCK_RECEITA_FORM,
      });

      dispatch({
        type: 'ADD_CHAT_MESSAGE',
        message: {
          role: 'assistant',
          content: resp.content,
          rawJson: resp,
          options: resp.options ?? undefined,
          fase: resp.fase as ChatFase,
        },
      });
      dispatch({ type: 'SET_CHAT_FASE', fase: resp.fase as ChatFase });
      if (resp.receita) dispatch({ type: 'SET_RECEITA', receita: resp.receita as never });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro';
      dispatch({ type: 'ADD_CHAT_MESSAGE', message: { role: 'assistant', content: `❌ ${errMsg}` } });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.projetoId, testApiFetch, dispatch]);

  const handleSkipToSaving = useCallback(async () => {
    if (!state.projetoId) return;
    dispatch({ type: 'SET_COLETADO', coletado: MOCK_COLETADO_COMPLETO as never });
    dispatch({ type: 'SET_CHAT_FASE', fase: 'saving' });
    dispatch({ type: 'SET_SHOW_SAVING_FORM', show: true });
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: { role: 'assistant', content: '⏭️ Pulando para fase saving (dados da doc preenchidos com mock).' },
    });
  }, [state.projetoId, dispatch]);

  const handleSkipToReceita = useCallback(async () => {
    if (!state.projetoId) return;
    dispatch({ type: 'SET_COLETADO', coletado: MOCK_COLETADO_COMPLETO as never });
    dispatch({ type: 'SET_CHAT_FASE', fase: 'receita' });
    dispatch({ type: 'SET_SHOW_RECEITA_FORM', show: true });
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: { role: 'assistant', content: '⏭️ Pulando para fase receita (dados da doc preenchidos com mock).' },
    });
  }, [state.projetoId, dispatch]);

  const toggleJson = (idx: number) => {
    setExpandedJson((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const color = phaseColor(state.chatFase);
  const lastMsg = state.chatMessages[state.chatMessages.length - 1];
  const hasOptions = lastMsg?.role === 'assistant' && lastMsg.options && lastMsg.options.length > 0;

  return (
    <div style={S.container}>
      {/* Phase bar */}
      <div style={S.phaseBar}>
        <span style={{ color: '#6b6e80' }}>Fase:</span>
        <span style={{ ...S.phaseBadge, background: color + '20', color, border: `1px solid ${color}40` }}>
          {phaseLabel(state.chatFase)}
        </span>
        {state.projetoId && (
          <>
            <span style={{ color: '#2a2a3a' }}>|</span>
            <span style={{ color: '#6b6e80', fontSize: 11, fontFamily: 'monospace' }}>
              {state.chatMessages.length} msgs
            </span>
          </>
        )}
        {state.projetoId && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              style={{ ...S.optionBtn, fontSize: 10, padding: '3px 8px' }}
              onClick={handleSkipToSaving}
              title="Pre-preenche doc e pula para saving"
            >
              ⏭ Saving
            </button>
            <button
              style={{ ...S.optionBtn, fontSize: 10, padding: '3px 8px' }}
              onClick={handleSkipToReceita}
              title="Pre-preenche doc e pula para receita"
            >
              ⏭ Receita
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={S.messages}>
        {state.chatMessages.length === 0 ? (
          <div style={S.emptyState}>
            Selecione um cenário e clique "Iniciar Simulação"
          </div>
        ) : (
          state.chatMessages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div style={{ ...S.userBubble, background: isSaving ? '#3a3c00' : '#003366', color: '#e0e0e0' }}>
                  {msg.content}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: '85%' }}>
                  <div
                    style={{
                      ...S.assistantBubble,
                      background: isSaving ? 'rgba(215,219,0,0.08)' : 'rgba(0,89,169,0.1)',
                      border: `1px solid ${isSaving ? 'rgba(215,219,0,0.2)' : 'rgba(0,89,169,0.2)'}`,
                    }}
                  >
                    <SimpleMarkdown text={msg.content} isSaving={isSaving} />
                  </div>
                  {msg.rawJson && (
                    <>
                      <div style={S.jsonToggle} onClick={() => toggleJson(i)}>
                        {expandedJson.has(i) ? '▼ Esconder JSON' : '▶ Ver JSON raw'}
                      </div>
                      {expandedJson.has(i) && (
                        <pre
                          style={S.jsonBlock}
                          dangerouslySetInnerHTML={{ __html: highlightJson(msg.rawJson) }}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {state.loading && (
          <div style={{ ...S.assistantBubble, alignSelf: 'flex-start', background: 'rgba(0,89,169,0.1)', border: '1px solid rgba(0,89,169,0.2)' }}>
            <span style={{ color: '#6b6e80' }}>
              {'● '.repeat(3).split(' ').map((dot, i) => (
                <span key={i} style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`, opacity: 0.4 }}>{dot}</span>
              ))}
              {state.slowMode && <span style={{ fontSize: 10, marginLeft: 8 }}>(modo lento...)</span>}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Option buttons */}
      {hasOptions && !state.loading && (
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px', flexWrap: 'wrap' }}>
          {lastMsg.options!.map((opt, i) => (
            <button key={i} style={S.optionBtn} onClick={() => sendMessage(opt, i)}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Saving form inline */}
      {state.showSavingForm && (
        <div style={S.inlineForm}>
          <div style={S.formTitle}>💰 Formulário Saving (dados mock)</div>
          <div style={{ fontSize: 11, color: '#a0a0b0', marginBottom: 4, fontFamily: 'monospace' }}>
            {MOCK_SAVING_FORM.linhas.map((l, i) => (
              <div key={i}>{l.cargo}: {l.horas_antes}h → {l.horas_depois}h | tipo: {MOCK_SAVING_FORM.tipo_saving}</div>
            ))}
          </div>
          <button style={S.formBtn} onClick={handleSavingSubmit} disabled={state.loading}>
            Enviar Saving Mock
          </button>
        </div>
      )}

      {/* Receita form inline */}
      {state.showReceitaForm && (
        <div style={S.inlineForm}>
          <div style={{ ...S.formTitle, color: '#16a34a' }}>📈 Formulário Receita (dados mock)</div>
          <div style={{ fontSize: 11, color: '#a0a0b0', marginBottom: 4, fontFamily: 'monospace' }}>
            R$ {MOCK_RECEITA_FORM.valor_ganho_mensal}/mês | tipo: {MOCK_RECEITA_FORM.tipo_saving}<br />
            Racional: {MOCK_RECEITA_FORM.racional}
          </div>
          <button style={{ ...S.formBtn, background: '#16a34a' }} onClick={handleReceitaSubmit} disabled={state.loading}>
            Enviar Receita Mock
          </button>
        </div>
      )}

      {/* Input area */}
      {state.projetoId && !state.chatComplete && (
        <div style={S.inputArea}>
          <textarea
            style={S.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Digite uma mensagem..."
            rows={1}
            disabled={state.loading}
          />
          <button
            style={{ ...S.sendBtn, ...(state.loading ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
            onClick={() => sendMessage(input)}
            disabled={state.loading || !input.trim()}
          >
            Enviar
          </button>
        </div>
      )}

      {state.chatComplete && (
        <div style={{ ...S.inputArea, justifyContent: 'center' }}>
          <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>
            ✅ Fluxo completo — pronto para submissão
          </span>
        </div>
      )}
    </div>
  );
}
