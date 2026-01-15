/**
 * LiteLLM container management
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ContainerRunOptions } from '../podman/client.ts';
import type { Settings } from '../config/schema.ts';
import {
  LITELLM_IMAGE,
  liteLLMConfigToYaml,
  type LiteLLMConfig,
} from './config.ts';

export type LiteLLMContainerConfig = {
  config: LiteLLMConfig;
  settings: Settings;
};

/**
 * Build podman run options for a LiteLLM container
 */
export async function buildLiteLLMContainerOptions(
  containerConfig: LiteLLMContainerConfig,
): Promise<ContainerRunOptions> {
  const { config, settings } = containerConfig;

  // Generate config YAML
  const configYaml = liteLLMConfigToYaml(config);

  // Ensure .tmp directory exists
  const tmpDir = join(process.cwd(), '.tmp');
  await mkdir(tmpDir, { recursive: true });

  // Write config to temp file
  const configPath = join(tmpDir, 'litellm-config.yaml');
  await Bun.write(configPath, configYaml);

  return {
    name: 'litellm',
    image: LITELLM_IMAGE,
    ports: [{ host: settings.litellm_port, container: 4000 }],
    volumes: [
      { host: configPath, container: '/app/config.yaml', readonly: true },
    ],
    command: [
      '--config',
      '/app/config.yaml',
      '--port',
      '4000',
      '--host',
      '0.0.0.0',
    ],
    detach: true,
    pull: 'missing',
  };
}
