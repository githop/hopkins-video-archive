import React from 'react';
import { useRenderer, useKeyboard } from '@opentui/react';
import { usePodmanState } from './hooks/usePodmanState.ts';
import { useSelection } from './hooks/useSelection.ts';
import { useOrchestrator } from './hooks/useOrchestrator.ts';
import { useHydration } from './hooks/useHydration.ts';
import { SelectableItem } from './components/SelectableItem.tsx';
import { DetailPane } from './components/DetailPane.tsx';
import type { ContainerInfo, GnarlyConfig } from '@gnarlyvllm/core';

interface DashboardProps {
  podmanVersion: string;
  config: GnarlyConfig;
}

export function Dashboard({ podmanVersion, config }: DashboardProps) {
  const { containers, loading, error, refresh } = usePodmanState();
  const {
    selection,
    selectStack,
    selectModel,
    selectContainer,
    clearSelection,
  } = useSelection();
  const orchestrator = useOrchestrator(config);
  const renderer = useRenderer();

  // Hydrate state from existing containers
  useHydration(config, containers, orchestrator, loading);

  useKeyboard((key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      renderer?.destroy();
      process.exit(0);
    }
    if (key.name === 'r') {
      refresh();
    }
    if (key.name === 'return' && selection) {
      // Start selected item
      if (selection.type === 'model') {
        orchestrator.startModel(selection.name);
      } else if (selection.type === 'stack') {
        orchestrator.startStack(selection.name);
      }
    }
    if (key.name === 'x' && selection?.type === 'container') {
      // Stop all (for now - later can stop individual)
      orchestrator.stopAll();
    }
    if (key.name === 'escape') {
      clearSelection();
    }
  });

  // Get running container names (without gnarlyvllm- prefix)
  const runningContainerNames = containers
    .filter((c) => c.state === 'running')
    .map((c) => c.name.replace(/^gnarlyvllm-/, ''));

  // Status message based on orchestrator state
  const getStatusMessage = () => {
    if (orchestrator.isSwitching) return 'Starting...';
    if (orchestrator.isStopping) return 'Stopping...';
    if (orchestrator.isError) return `Error: ${orchestrator.context.error}`;
    if (orchestrator.context.activeEntity) {
      const entity = orchestrator.context.activeEntity;
      return `${entity.type.toUpperCase()}: ${entity.name}`;
    }
    return null;
  };

  const statusMessage = getStatusMessage();

  return (
    <box style={{ flexDirection: 'column', padding: 1, height: '100%' }}>
      {/* Header with status */}
      <box
        style={{
          border: true,
          justifyContent: 'flex-start',
          flexDirection: 'row',
        }}
      >
        <text content="GNARLYVLLM DASHBOARD" style={{ fg: 'white' }} />
        <text
          content={` | Podman: v${podmanVersion}`}
          style={{ fg: '#CCCCCC' }}
        />
        {statusMessage && (
          <text
            content={` | ${statusMessage}`}
            style={{ fg: orchestrator.isError ? 'red' : 'green' }}
          />
        )}
      </box>

      <box style={{ flexGrow: 1, flexDirection: 'row' }}>
        {/* Main Content: Containers + Detail pane */}
        <box style={{ flexDirection: 'column', flexGrow: 1, marginRight: 2 }}>
          {/* Running containers section - fixed height */}
          <box style={{ flexDirection: 'column', flexGrow: 0, flexShrink: 0 }}>
            <box style={{ flexDirection: 'row', marginBottom: 1 }}>
              <text content="Running" style={{ attributes: 1 | 8 }} />
              {loading && (
                <text content=" (Refreshing...)" style={{ fg: 'yellow' }} />
              )}
            </box>

            {error && (
              <text content={`Error: ${error}`} style={{ fg: 'red' }} />
            )}

            <box style={{ flexDirection: 'column' }}>
              <box style={{ flexDirection: 'row', marginBottom: 1, height: 1 }}>
                <box style={{ width: 20 }}>
                  <text content="NAME" style={{ attributes: 1 }} />
                </box>
                <box style={{ width: 12 }}>
                  <text content="STATE" style={{ attributes: 1 }} />
                </box>
                <box style={{ width: 12 }}>
                  <text content="PORTS" style={{ attributes: 1 }} />
                </box>
              </box>

              <box style={{ flexDirection: 'column' }}>
                {containers.length === 0 ? (
                  <text
                    content="No models running."
                    style={{ fg: '#666666' }}
                  />
                ) : (
                  containers.map((c) => (
                    <ContainerRow
                      key={c.id}
                      container={c}
                      isSelected={
                        selection?.type === 'container' &&
                        selection.name === c.name.replace(/^gnarlyvllm-/, '')
                      }
                      onClick={() =>
                        selectContainer(c.name.replace(/^gnarlyvllm-/, ''))
                      }
                    />
                  ))
                )}
              </box>
            </box>
          </box>

          {/* Detail pane for selected item - takes remaining space with scrolling */}
          <scrollbox scrollY style={{ flexGrow: 1, marginTop: 1 }}>
            <DetailPane
              selection={selection}
              config={config}
              containers={containers}
              activeEntity={orchestrator.context.activeEntity}
              runningContainerNames={runningContainerNames}
            />
          </scrollbox>

          {/* Operation status messages */}
          {orchestrator.isSwitching && (
            <box style={{ marginTop: 1, border: true, flexGrow: 0 }}>
              <text content="Starting..." style={{ fg: 'yellow' }} />
            </box>
          )}
          {orchestrator.isStopping && (
            <box style={{ marginTop: 1, border: true, flexGrow: 0 }}>
              <text content="Stopping..." style={{ fg: 'yellow' }} />
            </box>
          )}
        </box>

        {/* Sidebar: Stacks & Models */}
        <box
          style={{
            width: 35,
            flexDirection: 'column',
            border: true,
            paddingLeft: 1,
          }}
        >
          <text
            content="Stacks"
            style={{ attributes: 1 | 8, marginBottom: 1 }}
          />
          {Object.entries(config.stacks).map(([name, stack]) => (
            <SelectableItem
              key={name}
              label={name}
              subtitle={`${stack.models.length} models`}
              isSelected={
                selection?.type === 'stack' && selection.name === name
              }
              isRunning={
                orchestrator.context.activeEntity?.type === 'stack' &&
                orchestrator.context.activeEntity.name === name
              }
              onClick={() => selectStack(name)}
            />
          ))}

          <box style={{ height: 1 }} />

          <text
            content="Models"
            style={{ attributes: 1 | 8, marginBottom: 1 }}
          />
          {Object.entries(config.models).map(([name, model]) => (
            <SelectableItem
              key={name}
              label={name}
              subtitle={model.repo}
              isSelected={
                selection?.type === 'model' && selection.name === name
              }
              isRunning={runningContainerNames.includes(name)}
              onClick={() => selectModel(name)}
            />
          ))}
        </box>
      </box>

      {/* Footer */}
      <box
        style={{
          marginTop: 1,
          paddingTop: 1,
          border: ['top'],
          flexDirection: 'row',
        }}
      >
        <text content="[Click] Select  " style={{ fg: '#999999' }} />
        <text content="[Enter]" style={{ fg: 'white', attributes: 1 }} />
        <text content=" Start  " style={{ fg: '#999999' }} />
        <text content="[X]" style={{ fg: 'white', attributes: 1 }} />
        <text content=" Stop  " style={{ fg: '#999999' }} />
        <text content="[R]" style={{ fg: 'white', attributes: 1 }} />
        <text content=" Refresh  " style={{ fg: '#999999' }} />
        <text content="[Q]" style={{ fg: 'white', attributes: 1 }} />
        <text content=" Quit" style={{ fg: '#999999' }} />
      </box>
    </box>
  );
}

interface ContainerRowProps {
  container: ContainerInfo;
  isSelected: boolean;
  onClick: () => void;
}

function ContainerRow({ container, isSelected, onClick }: ContainerRowProps) {
  const isRunning = container.state === 'running';
  const stateColor = isRunning ? 'green' : '#999999';
  const displayName = container.name.replace(/^gnarlyvllm-/, '');
  const ports =
    container.ports.length > 0
      ? container.ports.map((p) => p.split('/')[0]).join(', ')
      : '-';

  const bgColor = isSelected ? '#334455' : undefined;

  return (
    <box
      style={{ flexDirection: 'row', height: 1, backgroundColor: bgColor }}
      onMouseDown={onClick}
    >
      <box style={{ width: 20 }}>
        {isSelected && <text content="► " style={{ fg: 'yellow' }} />}
        <text
          content={displayName}
          style={{ fg: isRunning ? 'brightGreen' : 'white' }}
        />
      </box>
      <box style={{ width: 12 }}>
        <text content={container.state} style={{ fg: stateColor }} />
      </box>
      <box style={{ width: 12 }}>
        <text content={ports} style={{ fg: '#CCCCCC' }} />
      </box>
    </box>
  );
}
