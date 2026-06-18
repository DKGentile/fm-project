/**
 * Admin dashboard endpoints (mounted at /api/admin):
 *   GET  /stream       live feed of ALL sessions' events (SSE)
 *   GET  /state        metrics + session summaries snapshot
 *   GET  /session/:id  full event log for one session
 *   GET  /eval/stream  run the policy eval suite, streaming each scored result
 *   POST /reset        reset CRM + clear sessions (replay the demo)
 */

import { Router, type Request, type Response } from 'express';
import { subscribe } from '../../events/eventBus.js';
import { clearSessions, getSessionEvents } from '../../events/sessionStore.js';
import { getAdminState } from '../../events/metrics.js';
import { store } from '../../crm/store.js';
import { resetGateway } from '../../payments/gateway.js';
import { runEvals } from '../../eval/runEval.js';
import { openSse, writeSse, writeSseComment, writeSseJson } from '../sse.js';

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

adminRouter.get('/eval/stream', async (_req: Request, res: Response) => {
  openSse(res);
  writeSseComment(res, 'connected');
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // stop the run (and its token spend) if the client leaves
  const heartbeat = setInterval(() => writeSseComment(res, 'ping'), 10_000); // survive idle gaps

  try {
    const summary = await runEvals((result) => {
      if (!ac.signal.aborted) writeSseJson(res, { type: 'eval_result', result });
    }, ac.signal);
    if (!ac.signal.aborted) writeSseJson(res, { type: 'eval_done', summary });
  } catch (err) {
    if (!ac.signal.aborted) {
      writeSseJson(res, { type: 'eval_error', message: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

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
