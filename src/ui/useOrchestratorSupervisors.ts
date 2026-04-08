import { useState, useEffect } from 'react';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import type { Orchestrator } from '../orchestrator/Orchestrator.js';

export function useOrchestratorSupervisors(orch: Orchestrator): AgentSupervisor[] {
  const [supervisors, setSupervisors] = useState<AgentSupervisor[]>(
    () => [...orch.supervisors],
  );

  useEffect(() => {
    // Sync in case agents were added between render and effect
    setSupervisors([...orch.supervisors]);

    const onAdded = () => {
      setSupervisors([...orch.supervisors]);
    };

    orch.on('agentAdded', onAdded);
    return () => {
      orch.off('agentAdded', onAdded);
    };
  }, [orch]);

  return supervisors;
}
