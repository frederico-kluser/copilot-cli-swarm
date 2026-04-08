import { useSyncExternalStore, useCallback } from 'react';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import type { AgentState } from '../acp/phase-machine.js';

export function useAgentState(supervisor: AgentSupervisor): AgentState {
  const subscribe = useCallback(
    (cb: () => void) => {
      supervisor.on('stateChange', cb);
      return () => {
        supervisor.off('stateChange', cb);
      };
    },
    [supervisor],
  );

  const getSnapshot = useCallback(() => supervisor.state, [supervisor]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
