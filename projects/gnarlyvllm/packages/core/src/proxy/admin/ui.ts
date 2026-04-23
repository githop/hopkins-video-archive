import { join } from 'node:path';

/**
 * Render the dashboard HTML by reading separate CSS, JS, and HTML template files
 * and assembling them into a single response. This keeps source files maintainable
 * while still returning a self-contained HTML document to the client.
 */
export async function renderDashboard(): Promise<string> {
  const dir = join(import.meta.dir, 'admin');

  const [html, css, js] = await Promise.all([
    Bun.file(join(dir, 'dashboard.html')).text(),
    Bun.file(join(dir, 'dashboard.css')).text(),
    Bun.file(join(dir, 'dashboard.js')).text(),
  ]);

  return html
    .replace('/* DASHBOARD_CSS */', css)
    .replace('/* DASHBOARD_JS */', js);
}
