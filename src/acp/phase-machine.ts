import type {
  AgentPhase,
  SessionUpdate,
  PlanEntry,
  SessionConfigOption,
} from './types.js';
import {
  isAgentThoughtChunk,
  isAgentMessageChunk,
  isToolCall,
  isToolCallUpdate,
  isPlan,
  isConfigOptionUpdate,
  cloneSessionConfigOptions,
  getCurrentModel,
  getCurrentModelLabel,
} from './types.js';

export interface AgentState {
  phase: AgentPhase;
  lastMessage: string;
  lastThought: string;
  currentTool: { id: string; title: string; status: string } | null;
  plan: PlanEntry[] | null;
  configOptions: SessionConfigOption[] | null;
  currentModel: string | null;
  currentModelLabel: string | null;
  error: string | null;
  retryCount: number;
  retryResumeAt: number | null;
}

export const initialState: AgentState = {
  phase: 'spawning',
  lastMessage: '',
  lastThought: '',
  currentTool: null,
  plan: null,
  configOptions: null,
  currentModel: null,
  currentModelLabel: null,
  error: null,
  retryCount: 0,
  retryResumeAt: null,
};

export function resetState(): AgentState {
  return { ...initialState };
}

const FORBIDDEN_SOURCE: ReadonlySet<AgentPhase> = new Set(['done', 'error']);

export function withConfigOptions(
  state: AgentState,
  configOptions?: SessionConfigOption[] | null,
): AgentState {
  const nextConfigOptions = cloneSessionConfigOptions(configOptions);

  return {
    ...state,
    configOptions: nextConfigOptions,
    currentModel: getCurrentModel(nextConfigOptions),
    currentModelLabel: getCurrentModelLabel(nextConfigOptions),
  };
}

export function reducePhase(current: AgentPhase, update: SessionUpdate): AgentPhase {
  if (isConfigOptionUpdate(update)) return current;
  if (FORBIDDEN_SOURCE.has(current)) return current;

  if (isAgentThoughtChunk(update)) return 'thinking';
  if (isPlan(update)) return 'planning';
  if (isToolCall(update)) return 'tool_call';
  if (isToolCallUpdate(update)) {
    if (update.status === 'failed') return 'error';
    return 'tool_call';
  }
  if (isAgentMessageChunk(update)) return 'responding';

  return current;
}

export function reduceAgentState(state: AgentState, update: SessionUpdate): AgentState {
  if (isConfigOptionUpdate(update)) {
    return withConfigOptions(state, update.configOptions);
  }

  if (FORBIDDEN_SOURCE.has(state.phase)) return state;

  const nextPhase = reducePhase(state.phase, update);

  if (isAgentThoughtChunk(update)) {
    return {
      ...state,
      phase: nextPhase,
      lastThought: state.lastThought + update.content.text,
    };
  }

  if (isPlan(update)) {
    return {
      ...state,
      phase: nextPhase,
      plan: update.entries.map((e) => ({ ...e })),
    };
  }

  if (isToolCall(update)) {
    return {
      ...state,
      phase: nextPhase,
      currentTool: { id: update.toolCallId, title: update.title, status: 'pending' },
    };
  }

  if (isToolCallUpdate(update)) {
    if (update.status === 'failed') {
      return {
        ...state,
        phase: 'error',
        error: update.error ?? 'tool failed',
        currentTool: state.currentTool
          ? { ...state.currentTool, status: update.status }
          : null,
      };
    }
    return {
      ...state,
      phase: nextPhase,
      currentTool:
        state.currentTool && state.currentTool.id === update.toolCallId
          ? { ...state.currentTool, status: update.status }
          : state.currentTool,
    };
  }

  if (isAgentMessageChunk(update)) {
    return {
      ...state,
      phase: nextPhase,
      lastMessage: state.lastMessage + update.content.text,
    };
  }

  return { ...state, phase: nextPhase };
}
