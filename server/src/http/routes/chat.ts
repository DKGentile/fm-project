/**
 * POST /api/chat/stream — run one agent turn and stream this session's events
 * (SSE) to the caller. Events are also published to the bus so the admin
 * dashboard mirrors them live.
 */

import { Router, type Request, type Response } from 'express';
import type {
  AgentEvent,
  AgentEventBody,
  Channel,
  ChatHistoryItem,
  ChatTranscriptMessage,
} from '@northwind/shared';
import { runAgentTurn } from '../../agent/runAgentTurn.js';
import { nextSeq, publish } from '../../events/eventBus.js';
import { customerIdForToken } from '../../auth/auth.js';
import { store } from '../../crm/store.js';
import { getSessionForCustomer, listSessionsForCustomer } from '../../events/sessionStore.js';
import { getBearerToken } from '../bearer.js';
import { openSse, writeSse, writeSseComment } from '../sse.js';

export const chatRouter = Router();

/** Hard cap on a single user message. A refund request is a sentence or two;
 *  this stops a pasted mega-string from blowing up token usage (and is backed
 *  by the 256kb JSON body limit in app.ts as a coarse outer guard). */
const MAX_MESSAGE_CHARS = 4000;

chatRouter.post('/stream', async (req: Request, res: Response) => {
  const sessionId = String(req.body?.sessionId ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  const channel: Channel = req.body?.channel === 'voice' ? 'voice' : 'chat';

  if (!sessionId || !message) {
    res.status(400).json({ error: 'sessionId and message are required.' });
    return;
  }

  if (message.length > MAX_MESSAGE_CHARS) {
    res
      .status(413)
      .json({ error: `Message too long — please keep it under ${MAX_MESSAGE_CHARS} characters.` });
    return;
  }

  // Resolve the authenticated customer; the agent is scoped to this account.
  const customer = await store.getById(customerIdForToken(getBearerToken(req)) ?? '');
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

/**
 * GET /api/chat/orders — the signed-in customer's orders, for the in-chat order
 * picker. Deterministic (no LLM/tokens): listing orders is plain data, so we
 * serve it directly rather than asking the agent to enumerate them.
 */
chatRouter.get('/orders', async (req: Request, res: Response) => {
  const customerId = customerIdForToken(getBearerToken(req));
  if (!customerId) {
    res.status(401).json({ error: 'Not authenticated. Please log in again.' });
    return;
  }
  const customer = await store.getById(customerId);
  if (!customer) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  res.json({ orders: customer.orders });
});

/**
 * GET /api/chat/history — the signed-in customer's own past conversations.
 * Scoped to the authenticated customer; one customer can never list another's.
 */
chatRouter.get('/history', (req: Request, res: Response) => {
  const customerId = customerIdForToken(getBearerToken(req));
  if (!customerId) {
    res.status(401).json({ error: 'Not authenticated. Please log in again.' });
    return;
  }
  const chats: ChatHistoryItem[] = listSessionsForCustomer(customerId).map((s) => ({
    id: s.id,
    title: s.title,
    channel: s.channel,
    startedAt: s.startedAt,
    lastActivity: s.lastActivity,
    messageCount: s.messageCount,
    decisions: s.decisions,
  }));
  res.json({ chats });
});

/**
 * GET /api/chat/history/:id — the reconstructed transcript of one past chat,
 * but only if it belongs to the authenticated customer (ownership-checked).
 */
chatRouter.get('/history/:id', (req: Request, res: Response) => {
  const customerId = customerIdForToken(getBearerToken(req));
  if (!customerId) {
    res.status(401).json({ error: 'Not authenticated. Please log in again.' });
    return;
  }
  const session = getSessionForCustomer(customerId, req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  const messages: ChatTranscriptMessage[] = [];
  for (const event of session.events) {
    if (event.type === 'user_message') messages.push({ role: 'user', text: event.text });
    else if (event.type === 'assistant_message') messages.push({ role: 'assistant', text: event.text });
  }
  res.json({
    id: session.id,
    title: session.title,
    channel: session.channel,
    startedAt: session.startedAt,
    messages,
  });
});
