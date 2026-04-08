import React from 'react';
import { Box } from 'ink';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar, Footer } from './StatusBar.js';

interface AppProps {
  supervisors: AgentSupervisor[];
  startedAt: number;
}

export function App({ supervisors, startedAt }: AppProps) {
  return (
    <Box flexDirection="column">
      <StatusBar supervisors={supervisors} startedAt={startedAt} />
      <AgentGrid supervisors={supervisors} />
      <Footer />
    </Box>
  );
}
