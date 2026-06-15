/**
 * POST /api/chat/stream — run one agent turn and stream this session's events
 * (SSE) to the caller. Events are also published to the bus so the admin
 * dashboard mirrors them live.
 */

import { Router, type Request, type Response } from 'express';
import type { AgentEvent, AgentEventBody, Channel } from '@northwind/shared';
import { runAgentTurn } from '../../agent/runAgentTurn.js';
import { nextSeq, publish } from '../../events/eventBus.js';
import { customerIdForToken } from '../../auth/auth.js';
import { store } from '../../crm/store.js';
import { getBearerToken } from '../bearer.js';
import { openSse, writeSse, writeSseComment } from '../sse.js';

export const chatRouter = Router();

chatRouter.post('/stream', async (req: Request, res: Response) => {
  const sessionId = String(req.body?.sessionId ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  const channel: Channel = req.body?.channel === 'voice' ? 'voice' : 'chat';

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required.' });
    return;
  }

  // Resolve the authenticated customer; the agent is scoped to this account.
  const customer = store.getById(customerIdForToken(getBearerToken(req)) ?? '');
  if (!customer) {
    res.status(401).json({ error: 'Not authenticated. Please log in again.' });
    return;
  }

  openSse(res);
  let closed = false;
  const ac = new AbortController();
  // Detect a real client disconnect via the RESPONSE stream. (req's 'close'
  // fires as soon as express.json() finishes reading the body — not when the
  // client leaves — so using it here would abort every turn immediately.)
  res.on('close', () => {
    closed = true;
    ac.abort(); // stop model streaming + tool work when the client disconnects
  });

  // Keepalive comments during long "thinking" pauses so idle HTTP clients and
  // proxies don't drop the stream before the agent emits its next event.
  const heartbeat = setInterval(() => {
    if (!closed) writeSseComment(res, 'keepalive');
  }, 15_000);

  // Stamp envelope fields, persist + broadcast to admin, and stream to this caller.
  const emit = (body: AgentEventBody): void => {
    const event = { ...body, seq: nextSeq(), sessionId, ts: Date.now() } as AgentEvent;
    publish(event);
    if (!closed) writeSse(res, event);
  };

  try {
    await runAgentTurn({ sessionId, channel, userText: message, emit, signal: ac.signal, customer });
  } catch (err) {
    if (!closed) {
      writeSse(res, {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
        seq: nextSeq(),
        sessionId,
        ts: Date.now(),
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
});
