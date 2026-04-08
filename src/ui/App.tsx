import React from 'react';
import { Box } from 'ink';
import type { Orchestrator } from '../orchestrator/Orchestrator.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar, Footer } from './StatusBar.js';
import { useOrchestratorSupervisors } from './useOrchestratorSupervisors.js';

interface AppProps {
  orchestrator: Orchestrator;
  startedAt: number;
}

export function App({ orchestrator, startedAt }: AppProps) {
  const supervisors = useOrchestratorSupervisors(orchestrator);

  return (
    <Box flexDirection="column">
      <StatusBar supervisors={supervisors} startedAt={startedAt} />
      <AgentGrid supervisors={supervisors} />
      <Footer />
    </Box>
  );
}
