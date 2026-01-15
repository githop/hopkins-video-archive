/**
 * XState machine for orchestrating model/stack lifecycle
 */

import { setup, assign, fromPromise } from 'xstate';
import type {
  OrchestratorContext,
  OrchestratorEvent,
  ActiveEntity,
  ContainerStatus,
} from './types.ts';
import type { GnarlyConfig } from '../config/schema.ts';
import {
  stopAllVllmContainers,
  startModel,
  startStack,
  ensureLiteLLM,
} from './operations.ts';
import { resolveModelConfig, resolveStackModels } from '../config/index.ts';

export type OrchestratorInput = {
  config: GnarlyConfig;
};

export const orchestratorMachine = setup({
  types: {
    context: {} as OrchestratorContext,
    events: {} as OrchestratorEvent,
    input: {} as OrchestratorInput,
  },
  actions: {
    setActiveEntity: assign({
      activeEntity: ({ event }: { event: OrchestratorEvent }) => {
        if (event.type === 'SELECT_MODEL') {
          return { type: 'model', name: event.name } as ActiveEntity;
        }
        if (event.type === 'SELECT_STACK') {
          return { type: 'stack', name: event.name } as ActiveEntity;
        }
        return null;
      },
    }),
    clearActiveEntity: assign({
      activeEntity: null,
    }),
    setError: assign({
      error: ({ event }: { event: OrchestratorEvent }) => {
        if (event.type === 'CONTAINER_FAILED') return event.error;
        if (event.type === 'LITELLM_FAILED') return event.error;
        return 'Unknown error';
      },
    }),
    clearError: assign({
      error: null,
    }),
    updateContainerStatuses: assign({
      containerStatuses: ({ event }: { event: OrchestratorEvent }) => {
        if (event.type === 'CONTAINER_READY') {
          return [
            { name: event.name, state: 'running', port: 0 } as ContainerStatus,
          ];
        }
        return [];
      },
    }),
  },
  actors: {
    stopModels: fromPromise(async () => {
      await stopAllVllmContainers();
    }),

    startModels: fromPromise(
      async ({
        input,
      }: {
        input: { config: GnarlyConfig; entity: ActiveEntity };
      }) => {
        const { config, entity } = input;

        if (entity.type === 'model') {
          const status = await startModel(config, entity.name);
          if (status.state === 'failed') {
            throw new Error(
              status.error || `Failed to start model ${entity.name}`,
            );
          }
          return [status];
        } else {
          const statuses = await startStack(config, entity.name);
          const failed = statuses.filter((s) => s.state === 'failed');
          if (failed.length === statuses.length) {
            throw new Error('All models in stack failed to start');
          }
          // Return only successful models
          return statuses.filter((s) => s.state === 'running');
        }
      },
    ),

    configureLiteLLM: fromPromise(
      async ({
        input,
      }: {
        input: { config: GnarlyConfig; entity: ActiveEntity };
      }) => {
        const { config, entity } = input;

        // Get the models that should be running
        const models =
          entity.type === 'model'
            ? [resolveModelConfig(config, entity.name)]
            : resolveStackModels(config, entity.name);

        await ensureLiteLLM(models, config.settings);
      },
    ),
  },
}).createMachine({
  id: 'orchestrator',
  initial: 'idle',
  context: ({ input }: { input: OrchestratorInput }) => ({
    config: input.config,
    activeEntity: null,
    litellmRunning: false,
    containerStatuses: [],
    error: null,
  }),
  states: {
    idle: {
      on: {
        SELECT_MODEL: {
          target: 'switching',
          actions: 'setActiveEntity',
        },
        SELECT_STACK: {
          target: 'switching',
          actions: 'setActiveEntity',
        },
        HYDRATE: {
          target: 'running',
          actions: assign({
            activeEntity: ({ event }) =>
              event.type === 'HYDRATE' ? event.activeEntity : null,
            containerStatuses: ({ event }) =>
              event.type === 'HYDRATE' ? event.containerStatuses : [],
            litellmRunning: true,
          }),
        },
      },
    },
    switching: {
      initial: 'stoppingModels',
      states: {
        stoppingModels: {
          invoke: {
            src: 'stopModels',
            onDone: 'startingModels',
            onError: {
              target: '#orchestrator.error',
              actions: assign({
                error: ({ event }) => String(event.error),
              }),
            },
          },
        },
        startingModels: {
          invoke: {
            src: 'startModels',
            input: ({ context }: { context: OrchestratorContext }) => ({
              config: context.config,
              entity: context.activeEntity!,
            }),
            onDone: {
              target: 'configuringLiteLLM',
              actions: assign({
                containerStatuses: ({ event }: { event: any }) => event.output,
              }),
            },
            onError: {
              target: '#orchestrator.error',
              actions: assign({
                error: ({ event }: { event: any }) => String(event.error),
              }),
            },
          },
        },
        configuringLiteLLM: {
          invoke: {
            src: 'configureLiteLLM',
            input: ({ context }: { context: OrchestratorContext }) => ({
              config: context.config,
              entity: context.activeEntity!,
            }),
            onDone: {
              target: '#orchestrator.running',
              actions: assign({
                litellmRunning: true,
              }),
            },
            onError: {
              target: '#orchestrator.error',
              actions: assign({
                error: ({ event }: { event: any }) => String(event.error),
              }),
            },
          },
        },
      },
    },
    running: {
      on: {
        SELECT_MODEL: {
          target: 'switching',
          actions: 'setActiveEntity',
        },
        SELECT_STACK: {
          target: 'switching',
          actions: 'setActiveEntity',
        },
        STOP_ALL: 'stopping',
      },
    },
    stopping: {
      invoke: {
        src: 'stopModels',
        onDone: {
          target: 'idle',
          actions: ['clearActiveEntity', assign({ containerStatuses: [] })],
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => String(event.error),
          }),
        },
      },
    },
    error: {
      on: {
        SELECT_MODEL: {
          target: 'switching',
          actions: ['clearError', 'setActiveEntity'],
        },
        SELECT_STACK: {
          target: 'switching',
          actions: ['clearError', 'setActiveEntity'],
        },
        DISMISS_ERROR: {
          target: 'idle',
          actions: 'clearError',
        },
      },
    },
  },
});
