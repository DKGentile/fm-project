/**
 * Event bus. Every AgentEvent flows through publish():
 *   1. it is recorded against its session (timeline + metrics)
 *   2. it is broadcast to all live subscribers (the admin SSE stream)
 * The chat endpoint additionally streams a session's own events to that caller.
 */

import type { AgentEvent } from '@demitri/shared';
import { recordEvent } from './sessionStore.js';

type Subscriber = (event: AgentEvent) => void;

let seq = 0;
const subscribers = new Set<Subscriber>();

/** Monotonic event sequence id, stamped onto every emitted event. */
export function nextSeq(): number {
  return ++seq;
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publish(event: AgentEvent): void {
  recordEvent(event);
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      /* a slow subscriber shouldn't break the agent loop */
    }
  }
}
