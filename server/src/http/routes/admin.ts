/**
 * Admin dashboard endpoints (mounted at /api/admin):
 *   GET  /stream       live feed of ALL sessions' events (SSE)
 *   GET  /state        metrics + session summaries snapshot
 *   GET  /session/:id  full event log for one session
 *   POST /reset        reset CRM + clear sessions (replay the demo)
 */

import { Router, type Request, type Response } from 'express';
import { subscribe } from '../../events/eventBus.js';
import { clearSessions, getSessionEvents } from '../../events/sessionStore.js';
import { getAdminState } from '../../events/metrics.js';
import { store } from '../../crm/store.js';
import { resetGateway } from '../../payments/gateway.js';
import { openSse, writeSse, writeSseComment } from '../sse.js';

export const adminRouter = Router();

adminRouter.get('/stream', (req: Request, res: Response) => {
  openSse(res);
  writeSseComment(res, 'connected');

  const unsubscribe = subscribe((event) => writeSse(res, event));
  const heartbeat = setInterval(() => writeSseComment(res, 'ping'), 20_000);

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

adminRouter.get('/state', (_req, res) => res.json(getAdminState()));

adminRouter.get('/session/:id', (req, res) => res.json(getSessionEvents(req.params.id)));

adminRouter.post('/reset', async (_req, res) => {
  try {
    await store.reset();
    resetGateway();
    clearSessions();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
