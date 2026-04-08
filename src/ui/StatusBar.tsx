import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { Box, Text } from 'ink';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import type { AgentPhase } from '../acp/types.js';
import { logFilePath } from '../logging/logger.js';

interface StatusBarProps {
  supervisors: AgentSupervisor[];
  startedAt: number;
}

const PHASE_ICONS: Record<AgentPhase, string> = {
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

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function StatusBar({ supervisors, startedAt }: StatusBarProps) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Subscribe to all supervisors for phase counting
  const subscribe = useCallback(
    (cb: () => void) => {
      supervisors.forEach((s) => s.on('stateChange', cb));
      return () => supervisors.forEach((s) => s.off('stateChange', cb));
    },
    [supervisors],
  );

  const getSnapshot = useCallback(() => {
    const counts: Record<string, number> = {};
    for (const s of supervisors) {
      counts[s.state.phase] = (counts[s.state.phase] ?? 0) + 1;
    }
    return JSON.stringify(counts);
  }, [supervisors]);

  const countsStr = useSyncExternalStore(subscribe, getSnapshot);
  const counts = JSON.parse(countsStr) as Record<string, number>;

  const phaseDisplay = (['thinking', 'planning', 'tool_call', 'responding', 'done', 'error'] as AgentPhase[])
    .filter((p) => (counts[p] ?? 0) > 0)
    .map((p) => `${PHASE_ICONS[p]} ${counts[p]}`)
    .join('  ');

  return (
    <Box flexDirection="column">
      <Box>
        <Text inverse bold>
          {' '}{supervisors.length} agents{' '}
        </Text>
        <Text> {phaseDisplay || 'starting...'} </Text>
        <Text dimColor> {formatElapsed(elapsed)} </Text>
        <Text dimColor> Ctrl+C to quit</Text>
      </Box>
    </Box>
  );
}

export function Footer() {
  return (
    <Box marginTop={1}>
      <Text dimColor>logs: {logFilePath}</Text>
    </Box>
  );
}
