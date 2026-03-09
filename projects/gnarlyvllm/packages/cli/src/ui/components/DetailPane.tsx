import React from 'react';
import type {
  GnarlyConfig,
  ContainerInfo,
  ResolvedModelConfig,
  ActiveEntity,
} from '@gnarlyvllm/core';
import { resolveModelConfig, PROXY_CONTAINER_NAME } from '@gnarlyvllm/core';
import type { Selection } from '../hooks/useSelection.ts';

interface DetailPaneProps {
  selection: Selection;
  config: GnarlyConfig;
  containers: ContainerInfo[];
  activeEntity: ActiveEntity | null;
  runningContainerNames: string[];
}

/**
 * Infer which stack is active based on running containers
 * Since the orchestrator ensures only one model/stack runs at a time,
 * we can accurately determine if a stack is running by checking if all its models are running
 */
function inferActiveStack(
  config: GnarlyConfig,
  runningContainerNames: string[],
): string | undefined {
  // Exclude proxy from the check
  const runningModels = runningContainerNames.filter(
    (n) => n !== PROXY_CONTAINER_NAME,
  );

  for (const [stackName, stack] of Object.entries(config.stacks)) {
    const allModelsRunning = stack.models.every((m) =>
      runningModels.includes(m),
    );
    const onlyTheseModels = stack.models.length === runningModels.length;

    if (allModelsRunning && onlyTheseModels) {
      return stackName;
    }
  }

  return undefined;
}

export function DetailPane({
  selection,
  config,
  containers,
  activeEntity,
  runningContainerNames,
}: DetailPaneProps) {
  if (!selection) return null;

  // Infer stack context from running containers
  const inferredStackName = inferActiveStack(config, runningContainerNames);

  // Determine which stack context to use for resolving configs
  // Priority: orchestrator state > inferred from containers
  const activeStackName =
    activeEntity?.type === 'stack' ? activeEntity.name : inferredStackName;

  if (selection.type === 'model') {
    // Check if this model is currently running
    const isModelRunning = runningContainerNames.includes(selection.name);
    // Only use stack context if the model is running and part of that stack
    const stackContext =
      isModelRunning &&
      activeStackName &&
      config.stacks[activeStackName]?.models.includes(selection.name)
        ? activeStackName
        : undefined;

    return (
      <ModelDetail
        name={selection.name}
        config={config}
        activeStackName={stackContext}
      />
    );
  }
  if (selection.type === 'stack') {
    return <StackDetail name={selection.name} config={config} />;
  }
  if (selection.type === 'container') {
    // For containers, always show what they're running with (use inferred stack)
    return (
      <ContainerDetail
        name={selection.name}
        containers={containers}
        config={config}
        activeStackName={activeStackName}
      />
    );
  }
  return null;
}

function ModelDetail({
  name,
  config,
  activeStackName,
}: {
  name: string;
  config: GnarlyConfig;
  activeStackName?: string;
}) {
  const model = config.models[name];
  if (!model)
    return <text content={`Model ${name} not found`} style={{ fg: 'red' }} />;

  // Resolve model config with stack overrides if applicable
  const resolvedModel = resolveModelConfig(config, name, activeStackName);
  const flags = buildFlagsFromResolved(resolvedModel);

  return (
    <box
      style={{ border: true, flexDirection: 'column', padding: 1 }}
      title={name}
    >
      <text content={`Repo: ${model.repo}`} style={{ height: 1 }} />
      <text content={`Task: ${model.task}`} style={{ height: 1 }} />
      <text content={`Port: ${model.port}`} style={{ height: 1 }} />
      {activeStackName && (
        <text
          content={`Stack: ${activeStackName}`}
          style={{ height: 1, fg: '#888888' }}
        />
      )}
      {flags.length > 0 && (
        <>
          <text
            content="Flags:"
            style={{ height: 1, marginTop: 1, attributes: 1 }}
          />
          {flags.map((flag, i) => (
            <text
              key={i}
              content={`  ${flag}`}
              style={{ height: 1, fg: '#888888' }}
            />
          ))}
        </>
      )}
    </box>
  );
}

function StackDetail({ name, config }: { name: string; config: GnarlyConfig }) {
  const stack = config.stacks[name];
  if (!stack)
    return <text content={`Stack ${name} not found`} style={{ fg: 'red' }} />;

  return (
    <box
      style={{ border: true, flexDirection: 'column', padding: 1 }}
      title={name}
    >
      {stack.description && (
        <text
          content={stack.description}
          style={{ height: 1, fg: '#CCCCCC' }}
        />
      )}
      <text
        content={`Models: ${stack.models.join(', ')}`}
        style={{ height: 1, marginTop: 1 }}
      />
    </box>
  );
}

function ContainerDetail({
  name,
  containers,
  config,
  activeStackName,
}: {
  name: string;
  containers: ContainerInfo[];
  config: GnarlyConfig;
  activeStackName?: string;
}) {
  const container = containers.find((c) => c.name === `gnarlyvllm-${name}`);
  if (!container)
    return (
      <text content={`Container ${name} not found`} style={{ fg: 'red' }} />
    );

  // Try to find corresponding model config
  const model = config.models[name];

  return (
    <box
      style={{ border: true, flexDirection: 'column', padding: 1 }}
      title={name}
    >
      <text content={`State: ${container.state}`} style={{ height: 1 }} />
      <text content={`Status: ${container.status}`} style={{ height: 1 }} />
      {container.ports.length > 0 && (
        <text
          content={`Ports: ${container.ports.join(', ')}`}
          style={{ height: 1 }}
        />
      )}
      {model && (
        <>
          <text
            content={`Repo: ${model.repo}`}
            style={{ height: 1, marginTop: 1 }}
          />
          {activeStackName && (
            <text
              content={`Stack: ${activeStackName}`}
              style={{ height: 1, fg: '#888888' }}
            />
          )}
          {buildFlagsFromResolved(
            resolveModelConfig(config, name, activeStackName),
          ).map((flag: string, i: number) => (
            <text
              key={i}
              content={`  ${flag}`}
              style={{ height: 1, fg: '#888888' }}
            />
          ))}
        </>
      )}
    </box>
  );
}

/**
 * Build a list of active flags from resolved model config
 * This reads from the top-level properties (which include stack overrides if applied)
 */
function buildFlagsFromResolved(model: ResolvedModelConfig): string[] {
  const flags: string[] = [];

  // Task-specific flags
  if (model.task === 'embed') {
    flags.push('--runner pooling --convert embed');
  } else if (model.task === 'score') {
    flags.push('--runner pooling --convert classify');
  }

  // Read from top-level properties (not nested under defaults)
  if (model.gpu_memory_utilization !== undefined) {
    flags.push(`--gpu-memory-utilization ${model.gpu_memory_utilization}`);
  }
  if (model.max_model_len !== undefined) {
    flags.push(`--max-model-len ${model.max_model_len}`);
  }
  if (model.quantization) {
    flags.push(`--quantization ${model.quantization}`);
  }
  if (model.enforce_eager) {
    flags.push('--enforce-eager');
  }
  if (model.enable_tool_calling) {
    flags.push('--enable-auto-tool-choice');
    flags.push('--tool-call-parser hermes');
  }
  if (model.reasoning_parser) {
    flags.push(`--reasoning-parser ${model.reasoning_parser}`);
  }
  if (model.max_num_seqs !== undefined) {
    flags.push(`--max-num-seqs ${model.max_num_seqs}`);
  }
  if (model.max_num_batched_tokens !== undefined) {
    flags.push(`--max-num-batched-tokens ${model.max_num_batched_tokens}`);
  }
  if (model.num_scheduler_steps !== undefined) {
    flags.push(`--num-scheduler-steps ${model.num_scheduler_steps}`);
  }
  if (model.hf_overrides) {
    flags.push(`--hf-overrides '${model.hf_overrides}'`);
  }

  // Always present flags
  flags.push('--trust-remote-code');

  return flags;
}
