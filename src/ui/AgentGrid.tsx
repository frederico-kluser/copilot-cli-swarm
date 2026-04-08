import React from 'react';
import { Box } from 'ink';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import { AgentPanel } from './AgentPanel.js';

interface AgentGridProps {
  supervisors: AgentSupervisor[];
}

export function AgentGrid({ supervisors }: AgentGridProps) {
  const cols =
    supervisors.length <= 2
      ? supervisors.length || 1
      : supervisors.length <= 4
        ? 2
        : 3;
  const width = `${Math.floor(100 / cols)}%`;

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {supervisors.map((s) => (
        <AgentPanel key={s.id} supervisor={s} width={width} />
      ))}
    </Box>
  );
}
