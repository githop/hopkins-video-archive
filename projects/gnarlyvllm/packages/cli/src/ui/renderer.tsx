import React, { type ReactNode } from 'react';
import { createCliRenderer, type CliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

export async function renderApp(node: ReactNode): Promise<CliRenderer> {
  const renderer = await createCliRenderer({
    useAlternateScreen: true,
    exitOnCtrlC: true,
  });

  const root = createRoot(renderer);
  root.render(node);

  return renderer;
}
