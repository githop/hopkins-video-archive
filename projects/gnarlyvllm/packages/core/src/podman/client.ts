/**
 * Podman CLI wrapper using Bun.spawn
 */

export type ContainerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'exited'
  | 'unknown';

export type ContainerInfo = {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  status: string;
  ports: string[];
  created: string;
};

export type ContainerRunOptions = {
  name: string;
  image: string;
  ports?: Array<{ host: number; container: number }>;
  env?: Record<string, string>;
  volumes?: Array<{ host: string; container: string; readonly?: boolean }>;
  devices?: string[];
  command?: string[];
  detach?: boolean;
  rm?: boolean;
  pull?: 'always' | 'missing' | 'never';
};

export type PodmanResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  exitCode: number;
};

const CONTAINER_PREFIX = 'gnarlyvllm-';

/**
 * Execute a podman command and return the result
 */
async function execPodman(args: string[]): Promise<PodmanResult<string>> {
  try {
    const proc = Bun.spawn(['podman', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        error:
          stderr.trim() ||
          stdout.trim() ||
          `podman exited with code ${exitCode}`,
        exitCode,
      };
    }

    return {
      success: true,
      data: stdout.trim(),
      exitCode: 0,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      exitCode: -1,
    };
  }
}

/**
 * Check if podman is available
 */
export async function isPodmanAvailable(): Promise<boolean> {
  const result = await execPodman(['--version']);
  return result.success;
}

/**
 * Get podman version
 */
export async function getPodmanVersion(): Promise<string | null> {
  const result = await execPodman(['--version']);
  if (!result.success) return null;
  // "podman version 4.9.3" -> "4.9.3"
  const match = result.data?.match(/version\s+([\d.]+)/);
  return match ? match[1] : (result.data ?? null);
}

/**
 * List containers with gnarlyvllm prefix
 */
export async function listContainers(
  all: boolean = true,
): Promise<PodmanResult<ContainerInfo[]>> {
  const args = [
    'ps',
    '--format',
    'json',
    '--filter',
    `name=${CONTAINER_PREFIX}`,
  ];
  if (all) args.push('-a');

  const result = await execPodman(args);
  if (!result.success) {
    return { ...result, data: [] };
  }

  try {
    const containers = JSON.parse(result.data || '[]') as Array<{
      Id: string;
      Names: string[];
      Image: string;
      State: string;
      Status: string;
      Ports: Array<{
        host_port: number;
        container_port: number;
        protocol: string;
      }> | null;
      Created: string;
    }>;

    const mapped: ContainerInfo[] = containers.map((c) => ({
      id: c.Id,
      name: c.Names[0] || c.Id,
      image: c.Image,
      state: parseContainerState(c.State),
      status: c.Status,
      ports: (c.Ports || []).map(
        (p) => `${p.host_port}:${p.container_port}/${p.protocol}`,
      ),
      created: c.Created,
    }));

    return { success: true, data: mapped, exitCode: 0 };
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse container list: ${err instanceof Error ? err.message : String(err)}`,
      exitCode: 0,
      data: [],
    };
  }
}

function parseContainerState(state: string): ContainerState {
  const lower = state.toLowerCase();
  if (lower === 'running') return 'running';
  if (lower === 'created') return 'created';
  if (lower === 'paused') return 'paused';
  if (lower === 'stopped') return 'stopped';
  if (lower === 'exited') return 'exited';
  return 'unknown';
}

/**
 * Get container by name (with prefix)
 */
export async function getContainer(
  name: string,
): Promise<ContainerInfo | null> {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  const result = await listContainers(true);
  if (!result.success || !result.data) return null;
  return result.data.find((c) => c.name === fullName) || null;
}

/**
 * Run a new container
 */
export async function runContainer(
  options: ContainerRunOptions,
): Promise<PodmanResult<string>> {
  const args = ['run'];

  // Name with prefix
  const fullName = options.name.startsWith(CONTAINER_PREFIX)
    ? options.name
    : `${CONTAINER_PREFIX}${options.name}`;
  args.push('--name', fullName);

  // Detach by default
  if (options.detach !== false) {
    args.push('-d');
  }

  // Remove on exit
  if (options.rm) {
    args.push('--rm');
  }

  // Pull policy
  if (options.pull) {
    args.push('--pull', options.pull);
  }

  // Port mappings
  if (options.ports) {
    for (const port of options.ports) {
      args.push('-p', `${port.host}:${port.container}`);
    }
  }

  // Environment variables
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  // Volume mounts
  if (options.volumes) {
    for (const vol of options.volumes) {
      const mount = vol.readonly
        ? `${vol.host}:${vol.container}:ro`
        : `${vol.host}:${vol.container}`;
      args.push('-v', mount);
    }
  }

  // Device passthrough (for GPU)
  if (options.devices) {
    for (const device of options.devices) {
      args.push('--device', device);
    }
  }

  // Image
  args.push(options.image);

  // Command
  if (options.command) {
    args.push(...options.command);
  }

  return execPodman(args);
}

/**
 * Start a stopped container
 */
export async function startContainer(
  name: string,
): Promise<PodmanResult<string>> {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  return execPodman(['start', fullName]);
}

/**
 * Stop a running container
 */
export async function stopContainer(
  name: string,
  timeout: number = 10,
): Promise<PodmanResult<string>> {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  return execPodman(['stop', '-t', timeout.toString(), fullName]);
}

/**
 * Remove a container
 */
export async function removeContainer(
  name: string,
  force: boolean = false,
): Promise<PodmanResult<string>> {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  const args = ['rm'];
  if (force) args.push('-f');
  args.push(fullName);
  return execPodman(args);
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  name: string,
  options?: { tail?: number; since?: string },
): Promise<PodmanResult<string>> {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  const args = ['logs'];
  if (options?.tail) {
    args.push('--tail', options.tail.toString());
  }
  if (options?.since) {
    args.push('--since', options.since);
  }
  args.push(fullName);
  return execPodman(args);
}

/**
 * Stream container logs (returns the subprocess for piping)
 */
export function streamContainerLogs(name: string): Bun.Subprocess {
  const fullName = name.startsWith(CONTAINER_PREFIX)
    ? name
    : `${CONTAINER_PREFIX}${name}`;
  return Bun.spawn(['podman', 'logs', '-f', '--tail', '20', fullName], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

/**
 * Check if a container is running and healthy
 */
export async function isContainerHealthy(name: string): Promise<boolean> {
  const container = await getContainer(name);
  return container?.state === 'running';
}

/**
 * Wait for container to be running (with timeout)
 */
export async function waitForContainer(
  name: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isContainerHealthy(name)) {
      return true;
    }
    await Bun.sleep(pollIntervalMs);
  }
  return false;
}

/**
 * Stop and remove all gnarlyvllm containers
 */
export async function cleanupAllContainers(): Promise<PodmanResult<string[]>> {
  const listResult = await listContainers(true);
  if (!listResult.success || !listResult.data) {
    return { ...listResult, data: [] };
  }

  const removed: string[] = [];
  const errors: string[] = [];

  for (const container of listResult.data) {
    // Stop if running
    if (container.state === 'running') {
      const stopResult = await stopContainer(container.name);
      if (!stopResult.success) {
        errors.push(`Failed to stop ${container.name}: ${stopResult.error}`);
        continue;
      }
    }

    // Remove
    const rmResult = await removeContainer(container.name);
    if (rmResult.success) {
      removed.push(container.name);
    } else {
      errors.push(`Failed to remove ${container.name}: ${rmResult.error}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: errors.join('\n'),
      data: removed,
      exitCode: 1,
    };
  }

  return { success: true, data: removed, exitCode: 0 };
}

/**
 * Pull an image
 */
export async function pullImage(image: string): Promise<PodmanResult<string>> {
  return execPodman(['pull', image]);
}

/**
 * Check if an image exists locally
 */
export async function imageExists(image: string): Promise<boolean> {
  const result = await execPodman(['image', 'exists', image]);
  return result.success;
}
