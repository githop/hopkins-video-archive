export type EntityType = 'model' | 'stack';

export type ActiveEntity = {
  type: EntityType;
  name: string;
};

export type ContainerStatus = {
  name: string;
  state: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  port: number;
  error?: string;
};

import type { GnarlyConfig } from '../config/schema.ts';

export type OrchestratorContext = {
  config: GnarlyConfig;
  activeEntity: ActiveEntity | null;
  litellmRunning: boolean;
  containerStatuses: ContainerStatus[];
  error: string | null;
};

export type OrchestratorEvent =
  | { type: 'SELECT_MODEL'; name: string }
  | { type: 'SELECT_STACK'; name: string }
  | {
      type: 'HYDRATE';
      activeEntity: ActiveEntity;
      containerStatuses: ContainerStatus[];
    }
  | { type: 'STOP_ALL' }
  | { type: 'CONTAINER_READY'; name: string }
  | { type: 'CONTAINER_FAILED'; name: string; error: string }
  | { type: 'ALL_STOPPED' }
  | { type: 'LITELLM_READY' }
  | { type: 'LITELLM_FAILED'; error: string }
  | { type: 'DISMISS_ERROR' };
