import React from 'react';

interface SelectableItemProps {
  label: string;
  subtitle?: string;
  isSelected: boolean;
  isRunning?: boolean;
  onClick: () => void;
}

export function SelectableItem({
  label,
  subtitle,
  isSelected,
  isRunning,
  onClick,
}: SelectableItemProps) {
  const icon = isRunning ? '●' : '○';
  const iconColor = isRunning ? 'green' : 'cyan';
  const bgColor = isSelected ? '#334455' : undefined;

  return (
    <box
      style={{
        flexDirection: 'column',
        marginBottom: 1,
        backgroundColor: bgColor,
        paddingLeft: isSelected ? 0 : 1,
      }}
      onMouseDown={onClick}
    >
      <box style={{ flexDirection: 'row', height: 1 }}>
        {isSelected && <text content="► " style={{ fg: 'yellow' }} />}
        <text
          content={`${icon} ${label}`}
          style={{ fg: iconColor, height: 1 }}
        />
      </box>
      {subtitle && (
        <text content={`  ${subtitle}`} style={{ fg: '#666666', height: 1 }} />
      )}
    </box>
  );
}
