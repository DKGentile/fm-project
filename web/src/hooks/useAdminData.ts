/**
 * Live admin data. The server is the source of truth for metrics + session
 * summaries (polled + refreshed on key events); the SSE stream feeds a live
 * per-session event buffer (with lazy-loaded history) for the timeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminState, AgentEvent } from '@demitri/shared';
import { getAdminState, openAdminStream } from '../lib/api';

const REFRESH_MS = 5000;
const REFRESH_ON = new Set<AgentEvent['type']>([
  'session_start',
  'user_message',
  'decision',
  'turn_complete',
  'error',
]);

export function useAdminData() {
  const [state, setState] = useState<AdminState | null>(null);
  const eventsRef = useRef<Map<string, AgentEvent[]>>(new Map());
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const refresh = useCallback(async () => {
    try {
      setState(await getAdminState());
    } catch {
      /* ignore transient fetch errors */
    }
  }, []);

  const addEvents = useCallback((id: string, incoming: AgentEvent[]) => {
    const cur = eventsRef.current.get(id) ?? [];
    const seen = new Set(cur.map((e) => e.seq));
    const merged = [...cur];
    for (const e of incoming) {
      if (!seen.has(e.seq)) {
        merged.push(e);
        seen.add(e.seq);
      }
    }
    merged.sort((a, b) => a.seq - b.seq);
    eventsRef.current.set(id, merged);
    bump();
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, REFRESH_MS);
    const close = openAdminStream((e) => {
      addEvents(e.sessionId, [e]);
      if (REFRESH_ON.has(e.type)) refresh();
    });
    return () => {
      clearInterval(iv);
      close();
    };
  }, [refresh, addEvents]);

  const eventsFor = useCallback((id: string): AgentEvent[] => eventsRef.current.get(id) ?? [], []);

  return { state, addEvents, eventsFor };
}
