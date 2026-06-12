// Estado central da página de testes — useReducer + React Context.

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { ApiLogEntry } from './api-interceptor';
import type { TestScenario } from './scenarios';
import type {
  ChatFase,
  DocumentacaoColetada,
  SavingColetado,
  ReceitaColetada,
} from '@/lib/agents/types';
import { documentacaoVazia, savingVazio, receitaVazia } from '@/lib/agents/types';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  rawJson?: unknown;
  options?: string[];
  isPreview?: boolean;
  fase?: ChatFase;
};

export type TestesState = {
  apiLogs: ApiLogEntry[];
  projetoId: string | null;
  chatMessages: ChatMessage[];
  chatFase: ChatFase;
  coletado: DocumentacaoColetada;
  saving: SavingColetado;
  receita: ReceitaColetada;
  loading: boolean;
  forceError: boolean;
  slowMode: boolean;
  activeScenario: string | null;
  currentScenarioData: TestScenario | null;
  showSavingForm: boolean;
  showReceitaForm: boolean;
  chatComplete: boolean;
};

const initialState: TestesState = {
  apiLogs: [],
  projetoId: null,
  chatMessages: [],
  chatFase: 'doc',
  coletado: documentacaoVazia(),
  saving: savingVazio(),
  receita: receitaVazia(),
  loading: false,
  forceError: false,
  slowMode: false,
  activeScenario: null,
  currentScenarioData: null,
  showSavingForm: false,
  showReceitaForm: false,
  chatComplete: false,
};

// ─── Actions ────────────────────────────────────────────────────────────────

export type TestesAction =
  | { type: 'SET_SCENARIO'; scenario: TestScenario }
  | { type: 'ADD_API_LOG'; entry: ApiLogEntry }
  | { type: 'CLEAR_API_LOGS' }
  | { type: 'SET_PROJETO_ID'; id: string }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'SET_CHAT_FASE'; fase: ChatFase }
  | { type: 'SET_COLETADO'; coletado: DocumentacaoColetada }
  | { type: 'SET_SAVING'; saving: SavingColetado }
  | { type: 'SET_RECEITA'; receita: ReceitaColetada }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'TOGGLE_FORCE_ERROR' }
  | { type: 'TOGGLE_SLOW_MODE' }
  | { type: 'SET_SHOW_SAVING_FORM'; show: boolean }
  | { type: 'SET_SHOW_RECEITA_FORM'; show: boolean }
  | { type: 'SET_CHAT_COMPLETE'; complete: boolean }
  | { type: 'RESET_ALL' };

// ─── Reducer ────────────────────────────────────────────────────────────────

function testesReducer(state: TestesState, action: TestesAction): TestesState {
  switch (action.type) {
    case 'SET_SCENARIO':
      return { ...initialState, activeScenario: action.scenario.id, currentScenarioData: action.scenario, forceError: state.forceError, slowMode: state.slowMode };
    case 'ADD_API_LOG':
      return { ...state, apiLogs: [action.entry, ...state.apiLogs].slice(0, 100) };
    case 'CLEAR_API_LOGS':
      return { ...state, apiLogs: [] };
    case 'SET_PROJETO_ID':
      return { ...state, projetoId: action.id };
    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.message] };
    case 'SET_CHAT_FASE':
      return { ...state, chatFase: action.fase };
    case 'SET_COLETADO':
      return { ...state, coletado: action.coletado };
    case 'SET_SAVING':
      return { ...state, saving: action.saving };
    case 'SET_RECEITA':
      return { ...state, receita: action.receita };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'TOGGLE_FORCE_ERROR':
      return { ...state, forceError: !state.forceError };
    case 'TOGGLE_SLOW_MODE':
      return { ...state, slowMode: !state.slowMode };
    case 'SET_SHOW_SAVING_FORM':
      return { ...state, showSavingForm: action.show };
    case 'SET_SHOW_RECEITA_FORM':
      return { ...state, showReceitaForm: action.show };
    case 'SET_CHAT_COMPLETE':
      return { ...state, chatComplete: action.complete };
    case 'RESET_ALL':
      return { ...initialState, forceError: state.forceError, slowMode: state.slowMode };
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

type TestesContextType = [TestesState, Dispatch<TestesAction>];

const TestesContext = createContext<TestesContextType | null>(null);

export function TestesProvider({ children }: { children: React.ReactNode }) {
  const value = useReducer(testesReducer, initialState);
  return <TestesContext value={value}>{children}</TestesContext>;
}

export function useTestesStore(): TestesContextType {
  const ctx = useContext(TestesContext);
  if (!ctx) throw new Error('useTestesStore deve ser usado dentro de TestesProvider');
  return ctx;
}
