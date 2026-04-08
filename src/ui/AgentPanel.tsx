import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import type { AgentPhase } from '../acp/types.js';
import { useAgentState } from './useAgentState.js';

const PHASE_ICON: Record<AgentPhase, string> = {
  spawning: '...',
  idle: 'ZZZ',
  thinking: '[T]',
  planning: '[P]',
  tool_call: '[>]',
  responding: '[R]',
  done: '[OK]',
  error: '[!!]',
  rate_limited: '[~~]',
};

const PHASE_LABEL: Record<AgentPhase, string> = {
  spawning: 'spawning',
  idle: 'idle',
  thinking: 'thinking',
  planning: 'planning',
  tool_call: 'tool_call',
  responding: 'responding',
  done: 'done',
  error: 'error',
  rate_limited: 'rate_limited',
};

function phaseBorderColor(phase: AgentPhase): string {
  if (phase === 'error') return 'red';
  if (phase === 'rate_limited') return 'yellow';
  if (phase === 'done' || phase === 'idle' || phase === 'spawning') return 'gray';
  return 'green';
}

interface AgentPanelProps {
  supervisor: AgentSupervisor;
  width: string;
}

export const AgentPanel = memo(function AgentPanel({ supervisor, width }: AgentPanelProps) {
  const state = useAgentState(supervisor);
  const borderColor = phaseBorderColor(state.phase);
  const icon = PHASE_ICON[state.phase];
  const label = PHASE_LABEL[state.phase];

  // Last 3 lines of message
  const messageLines = state.lastMessage
    .split('\n')
    .filter(Boolean)
    .slice(-3);

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      <Box>
        <Text bold>
          {icon} Agent {supervisor.id.slice(0, 6)}
        </Text>
        <Text color={borderColor}> {label}</Text>
      </Box>

      {state.currentTool && (
        <Text dimColor>
          tool: {state.currentTool.title} ({state.currentTool.status})
        </Text>
      )}

      {state.plan && (
        <Text dimColor>
          plan: {state.plan.filter((e) => e.status === 'completed').length}/{state.plan.length} steps
        </Text>
      )}

      {state.phase === 'error' && state.error && (
        <Text color="red" wrap="wrap">
          {state.error.slice(0, 200)}
          {state.error.length > 200 ? '...' : ''}
        </Text>
      )}

      {state.phase === 'rate_limited' && (
        <Text color="yellow">
          rate limited, retry {state.retryCount}/3
          {state.retryResumeAt
            ? ` in ${Math.max(0, Math.ceil((state.retryResumeAt - Date.now()) / 1000))}s`
            : ''}
        </Text>
      )}

      {messageLines.length > 0 && state.phase !== 'error' && (
        <Box flexDirection="column" marginTop={1}>
          {messageLines.map((line, i) => (
            <Text key={i} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {state.lastThought && state.phase === 'thinking' && (
        <Text dimColor italic wrap="truncate-end">
          {state.lastThought.slice(-80)}
        </Text>
      )}
    </Box>
  );
});
