/**
 * In-memory session store. Holds each conversation's message history (for the
 * model) and event log (for the admin timeline), plus running metric counters
 * that survive trimming of the bounded event buffer.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, Channel, DecisionOutcome } from '@northwind/shared';

export interface SessionRecord {
  id: string;
  channel: Channel;
  startedAt: number;
  lastActivity: number;
  title: string;
  /** The authenticated customer this conversation belongs to. */
  customerName?: string;
  /** Customer id — used to scope a customer's own chat history securely. */
  customerId?: string;
  /** Orders the agent has asked the customer to confirm a refund for. Gates
   *  process_refund server-side: it may only run after a confirmation that was
   *  requested in an EARLIER turn (i.e. the customer had a chance to confirm). */
  confirmRequestedOrders: Set<string>;
  /** Full conversation history fed back to the model each turn. */
  messages: Anthropic.MessageParam[];
  events: AgentEvent[];
  /** Running counters — incremented as events arrive so metrics stay correct
   *  even after the bounded `events` buffer trims its oldest entries. */
  toolCallCount: number;
  retryCount: number;
  messageCount: number;
  decisions: DecisionOutcome[];
}

const MAX_EVENTS_PER_SESSION = 600;
const sessions = new Map<string, SessionRecord>();

export function getOrCreateSession(id: string, channel: Channel): SessionRecord {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      channel,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      title: 'New conversation',
      confirmRequestedOrders: new Set(),
      messages: [],
      events: [],
      toolCallCount: 0,
      retryCount: 0,
      messageCount: 0,
      decisions: [],
    };
    sessions.set(id, s);
  }
  return s;
}

export function getSessionEvents(id: string): AgentEvent[] {
  return sessions.get(id)?.events ?? [];
}

export function listSessionRecords(): SessionRecord[] {
  return [...sessions.values()];
}

/** A customer's own non-empty conversations (newest first). */
export function listSessionsForCustomer(customerId: string): SessionRecord[] {
  return [...sessions.values()]
    .filter((s) => s.customerId === customerId && s.messageCount > 0)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

/** One conversation, but only if it belongs to this customer (ownership check). */
export function getSessionForCustomer(customerId: string, id: string): SessionRecord | undefined {
  const s = sessions.get(id);
  return s && s.customerId === customerId ? s : undefined;
}

export function clearSessions(): void {
  sessions.clear();
}

/** Append an event to its session and maintain counters/title (no fan-out). */
export function recordEvent(event: AgentEvent): void {
  const s = sessions.get(event.sessionId);
  if (!s) return;

  s.lastActivity = event.ts;
  // Update running counters BEFORE the buffer is trimmed, so metrics survive.
  if (event.type === 'tool_call') s.toolCallCount++;
  else if (event.type === 'tool_retry' || event.type === 'api_retry') s.retryCount++;
  else if (event.type === 'decision') s.decisions.push(event.outcome);
  else if (event.type === 'user_message' || event.type === 'assistant_message') s.messageCount++;

  s.events.push(event);
  if (s.events.length > MAX_EVENTS_PER_SESSION) {
    s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION);
  }
  if (event.type === 'user_message' && s.title === 'New conversation') {
    s.title = event.text.slice(0, 80);
  }
}
