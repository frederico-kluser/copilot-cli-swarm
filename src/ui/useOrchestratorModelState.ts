import { useCallback, useSyncExternalStore } from 'react';
import type { Orchestrator, OrchestratorModelState } from '../orchestrator/Orchestrator.js';

export function useOrchestratorModelState(orch: Orchestrator): OrchestratorModelState {
  const subscribe = useCallback(
    (cb: () => void) => {
      orch.on('modelStateChange', cb);
      return () => {
        orch.off('modelStateChange', cb);
      };
    },
    [orch],
  );

  const getSnapshot = useCallback(() => orch.getModelState(), [orch]);

  return useSyncExternalStore(subscribe, getSnapshot);
}