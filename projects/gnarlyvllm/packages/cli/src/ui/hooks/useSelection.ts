import { useState, useCallback } from 'react';

export type SelectionType = 'stack' | 'model' | 'container' | null;

export type Selection = {
  type: SelectionType;
  name: string;
} | null;

export function useSelection() {
  const [selection, setSelection] = useState<Selection>(null);

  const selectStack = useCallback((name: string) => {
    setSelection({ type: 'stack', name });
  }, []);

  const selectModel = useCallback((name: string) => {
    setSelection({ type: 'model', name });
  }, []);

  const selectContainer = useCallback((name: string) => {
    setSelection({ type: 'container', name });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  return {
    selection,
    selectStack,
    selectModel,
    selectContainer,
    clearSelection,
  };
}
