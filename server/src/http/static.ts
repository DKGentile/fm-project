/**
 * In production (`npm run build` then `npm start`), serve the built web client
 * from the same server. No-op in dev, where Vite serves the UI on its own port.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

export function serveClientBuild(app: Express): void {
  const dist = fileURLToPath(new URL('../../../web/dist', import.meta.url));
  if (!existsSync(dist)) return;
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`));
}
