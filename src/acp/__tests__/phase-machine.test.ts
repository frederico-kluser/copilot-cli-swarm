import { describe, it, expect } from 'vitest';
import {
  initialState,
  reducePhase,
  reduceAgentState,
  resetState,
  type AgentState,
} from '../phase-machine.js';
import type { SessionUpdate } from '../types.js';

const thought = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { text },
});

const plan = (): SessionUpdate => ({
  sessionUpdate: 'plan',
  entries: [
    { content: 'step 1', priority: 'high', status: 'pending' },
    { content: 'step 2', priority: 'medium', status: 'pending' },
  ],
});

const toolCall = (id = 'tc1', title = 'shell'): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id,
  title,
  kind: 'execute',
  rawInput: { command: 'ls' },
});

const toolCallUpdate = (
  id = 'tc1',
  status: 'pending' | 'in_progress' | 'completed' | 'failed' = 'completed',
): SessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  status,
});

const messageChunk = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

const configOptionUpdate = (currentValue = 'gpt-5'): SessionUpdate => ({
  sessionUpdate: 'config_option_update',
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue,
      options: [
        {
          group: 'OpenAI',
          options: [
            { value: 'gpt-5', name: 'GPT-5' },
            { value: 'gpt-5-mini', name: 'GPT-5 mini' },
          ],
        },
      ],
    },
  ],
});

describe('phase-machine', () => {
  it('initialState.phase === spawning', () => {
    expect(initialState.phase).toBe('spawning');
  });

  it('reducePhase: agent_thought_chunk → thinking', () => {
    expect(reducePhase('spawning', thought('hi'))).toBe('thinking');
  });

  it('thinking → planning ao receber plan', () => {
    expect(reducePhase('thinking', plan())).toBe('planning');
  });

  it('planning → tool_call ao receber tool_call', () => {
    expect(reducePhase('planning', toolCall())).toBe('tool_call');
  });

  it('tool_call_update completed mantém tool_call', () => {
    expect(reducePhase('tool_call', toolCallUpdate('tc1', 'completed'))).toBe('tool_call');
  });

  it('tool_call_update failed → error', () => {
    expect(reducePhase('tool_call', toolCallUpdate('tc1', 'failed'))).toBe('error');
  });

  it('agent_message_chunk acumula texto (3 chunks)', () => {
    let state = reduceAgentState(initialState, messageChunk('Hello '));
    state = reduceAgentState(state, messageChunk('world '));
    state = reduceAgentState(state, messageChunk('!'));
    expect(state.lastMessage).toBe('Hello world !');
    expect(state.phase).toBe('responding');
  });

  it('resetState volta ao initialState', () => {
    const state = reduceAgentState(initialState, thought('something'));
    const reset = resetState();
    expect(reset).toEqual(initialState);
    expect(reset).not.toBe(state);
  });

  it('transição proibida: done → thinking mantém done', () => {
    const doneState: AgentState = { ...initialState, phase: 'done' };
    expect(reducePhase(doneState.phase, thought('hi'))).toBe('done');
  });

  it('plan entries são copiados, não referenciados', () => {
    const planUpdate = plan();
    const state = reduceAgentState(initialState, planUpdate);
    if ('entries' in planUpdate) {
      (planUpdate as { entries: Array<{ content: string }> }).entries[0]!.content = 'mutated';
    }
    expect(state.plan![0]!.content).toBe('step 1');
  });

  it('lastThought acumula em múltiplos agent_thought_chunk', () => {
    let state = reduceAgentState(initialState, thought('A'));
    state = reduceAgentState(state, thought('B'));
    state = reduceAgentState(state, thought('C'));
    expect(state.lastThought).toBe('ABC');
  });

  it('currentTool.status reflete último tool_call_update', () => {
    let state = reduceAgentState(initialState, toolCall('tc1', 'shell'));
    expect(state.currentTool?.status).toBe('pending');
    state = reduceAgentState(state, toolCallUpdate('tc1', 'in_progress'));
    expect(state.currentTool?.status).toBe('in_progress');
    state = reduceAgentState(state, toolCallUpdate('tc1', 'completed'));
    expect(state.currentTool?.status).toBe('completed');
  });

  it('error state blocks further transitions', () => {
    const errorState: AgentState = { ...initialState, phase: 'error', error: 'boom' };
    const next = reduceAgentState(errorState, thought('ignored'));
    expect(next.phase).toBe('error');
    expect(next).toBe(errorState);
  });

  it('config_option_update atualiza metadata de modelo sem trocar de fase', () => {
    const state = reduceAgentState({ ...initialState, phase: 'idle' }, configOptionUpdate('gpt-5-mini'));

    expect(state.phase).toBe('idle');
    expect(state.currentModel).toBe('gpt-5-mini');
    expect(state.currentModelLabel).toBe('GPT-5 mini');
  });

  it('done ainda aceita refresh de modelo via config_option_update', () => {
    const doneState: AgentState = {
      ...initialState,
      phase: 'done',
      currentModel: 'gpt-5',
      currentModelLabel: 'GPT-5',
    };

    const next = reduceAgentState(doneState, configOptionUpdate('gpt-5-mini'));

    expect(next.phase).toBe('done');
    expect(next.currentModel).toBe('gpt-5-mini');
    expect(next.currentModelLabel).toBe('GPT-5 mini');
  });

  it('error ainda aceita refresh de modelo via config_option_update', () => {
    const errorState: AgentState = {
      ...initialState,
      phase: 'error',
      error: 'boom',
      currentModel: 'gpt-5',
      currentModelLabel: 'GPT-5',
    };

    const next = reduceAgentState(errorState, configOptionUpdate('gpt-5-mini'));

    expect(next.phase).toBe('error');
    expect(next.error).toBe('boom');
    expect(next.currentModel).toBe('gpt-5-mini');
  });
});
