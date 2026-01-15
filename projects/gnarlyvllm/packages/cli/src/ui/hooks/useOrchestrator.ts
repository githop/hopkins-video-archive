import { useMachine } from '@xstate/react';
import {
  orchestratorMachine,
  type GnarlyConfig,
  type ActiveEntity,
  type ContainerStatus,
} from '@gnarlyvllm/core';

export function useOrchestrator(config: GnarlyConfig) {
  const [state, send] = useMachine(orchestratorMachine, {
    input: { config },
  });

  return {
    // State values
    state: state.value,
    context: state.context,

    // State checks
    isIdle: state.matches('idle'),
    isRunning: state.matches('running'),
    isSwitching: state.matches('switching'),
    isError: state.matches('error'),
    isStopping: state.matches('stopping'),

    // Actions
    startModel: (name: string) => send({ type: 'SELECT_MODEL', name }),
    startStack: (name: string) => send({ type: 'SELECT_STACK', name }),
    hydrate: (
      activeEntity: ActiveEntity,
      containerStatuses: ContainerStatus[],
    ) => send({ type: 'HYDRATE', activeEntity, containerStatuses }),
    stopAll: () => send({ type: 'STOP_ALL' }),
    dismissError: () => send({ type: 'DISMISS_ERROR' }),
  };
}
