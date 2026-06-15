/**
 * Express application factory — wires middleware and mounts the route modules.
 * Kept separate from the bootstrap (index.ts) so it's easy to read and test.
 */

import express, { type Express } from 'express';
import cors from 'cors';
import { authRouter } from './http/routes/auth.js';
import { chatRouter } from './http/routes/chat.js';
import { adminRouter } from './http/routes/admin.js';
import { metaRouter } from './http/routes/meta.js';
import { voiceRouter } from './http/routes/voice.js';
import { serveClientBuild } from './http/static.js';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.use('/api/auth', authRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', metaRouter);
  app.use('/api', voiceRouter);

  serveClientBuild(app);
  return app;
}
