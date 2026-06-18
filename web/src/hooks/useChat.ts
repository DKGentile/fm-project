/**
 * All customer-chat state + behaviour: streaming a turn, building message
 * bubbles, tracking per-turn tool activity, and the voice (STT/TTS) lifecycle.
 * Keeps ChatPanel purely presentational.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, AppConfig, ChatHistoryItem, DecisionOutcome, Order } from '@northwind/shared';
import {
  getChatHistory,
  getChatTranscript,
  getMyOrders,
  streamChat,
  UnauthorizedError,
} from '../lib/api';
import { newId } from '../lib/ids';
import type { AuthSession } from './useAuth';
import {
  createRecognizer,
  speak,
  speechRecognitionSupported,
  stopSpeaking,
  type Recognizer,
} from '../lib/voice';

export interface ConfirmDetails {
  orderId: string;
  sku?: string;
  item: string;
  amount: number;
  method: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 'orders' / 'confirm' render interactive cards instead of plain text. */
  kind?: 'text' | 'orders' | 'confirm';
  orders?: Order[];
  confirm?: ConfirmDetails;
  /** A confirm card's locked outcome — once set, the card is read-only. */
  resolved?: 'yes' | 'no' | 'dismissed';
}

export interface ToolActivity {
  id: string;
  tool: string;
  status: 'running' | 'done' | 'error';
}

export interface TurnActivity {
  tools: ToolActivity[];
  decisions: { outcome: DecisionOutcome; detail: string }[];
  retries: number;
  reasoning: boolean;
  error?: string;
}

export function useChat(
  config: AppConfig | null,
  auth: AuthSession | null,
  onUnauthorized: () => void,
) {
  const [sessionId, setSessionId] = useState(newId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState<TurnActivity | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [history, setHistory] = useState<ChatHistoryItem[]>([]);

  const bubbleIdRef = useRef<string | null>(null);
  const lastReplyRef = useRef('');
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  // Mirror config into a ref so a turn that started before /api/config resolved
  // still reads the current value (e.g. for TTS) instead of a stale closure.
  const configRef = useRef(config);
  configRef.current = config;
  // Synchronous re-entrancy guard (immune to stale state in voice-triggered sends).
  const pendingRef = useRef(false);
  // A pending refund confirmation captured mid-turn; rendered as a card at turn end.
  const pendingConfirmRef = useRef<ConfirmDetails | null>(null);
  // Keep a handle on the live recognizer so it can be stopped / not double-started.
  const recognizerRef = useRef<Recognizer | null>(null);
  // Abort the in-flight stream when the conversation is reset mid-turn.
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback((e: AgentEvent) => {
    switch (e.type) {
      case 'thinking':
        setActivity((a) => (a ? { ...a, reasoning: true } : a));
        break;
      case 'assistant_delta':
        setMessages((prev) => {
          if (!bubbleIdRef.current) {
            const id = newId();
            bubbleIdRef.current = id;
            return [...prev, { id, role: 'assistant', text: e.text }];
          }
          const id = bubbleIdRef.current;
          return prev.map((m) => (m.id === id ? { ...m, text: m.text + e.text } : m));
        });
        break;
      case 'assistant_message': {
        // Accumulate across tool turns so spoken (TTS) output is the full reply.
        lastReplyRef.current = lastReplyRef.current ? `${lastReplyRef.current} ${e.text}` : e.text;
        const id = bubbleIdRef.current;
        if (id) {
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: e.text } : m)));
        } else {
          const nid = newId();
          setMessages((prev) => [...prev, { id: nid, role: 'assistant', text: e.text }]);
        }
        bubbleIdRef.current = null;
        setActivity((a) => (a ? { ...a, reasoning: false } : a));
        break;
      }
      case 'tool_call':
        setActivity((a) =>
          a ? { ...a, tools: [...a.tools, { id: e.toolUseId, tool: e.tool, status: 'running' }] } : a,
        );
        break;
      case 'tool_result': {
        // Capture a refund-confirmation request; we render it as a card once the
        // turn's text has settled (see send()'s reconcile step).
        if (e.tool === 'request_refund_confirmation' && !e.isError) {
          const o = e.output as
            | { confirmationRequired?: boolean; orderId?: string; sku?: string; item?: string; refundAmount?: number; method?: string }
            | null;
          if (o?.confirmationRequired) {
            pendingConfirmRef.current = {
              orderId: o.orderId ?? '',
              sku: o.sku,
              item: o.item ?? 'this item',
              amount: o.refundAmount ?? 0,
              method: o.method ?? 'your payment method',
            };
          }
        }
        setActivity((a) =>
          a
            ? {
                ...a,
                tools: a.tools.map((t) =>
                  t.id === e.toolUseId ? { ...t, status: e.isError ? 'error' : 'done' } : t,
                ),
              }
            : a,
        );
        break;
      }
      case 'tool_retry':
      case 'api_retry':
        setActivity((a) => (a ? { ...a, retries: a.retries + 1 } : a));
        break;
      case 'decision':
        setActivity((a) =>
          a ? { ...a, decisions: [...a.decisions, { outcome: e.outcome, detail: e.detail }] } : a,
        );
        break;
      case 'error':
        setActivity((a) => (a ? { ...a, error: e.message } : a));
        break;
      default:
        break;
    }
  }, []);

  // Load the customer's past chats (and refresh after each turn so the current
  // one appears / moves to the top). Scoped server-side to the logged-in account.
  const refreshHistory = useCallback(async () => {
    if (!auth) {
      setHistory([]);
      return;
    }
    try {
      setHistory(await getChatHistory(auth.token));
    } catch {
      /* non-critical; leave the existing list */
    }
  }, [auth]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const send = useCallback(
    async (text: string, channel: 'chat' | 'voice' = 'chat') => {
      const trimmed = text.trim();
      if (!trimmed || pendingRef.current || !auth) return;
      pendingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const onEvent = (e: AgentEvent) => {
        if (!controller.signal.aborted) handleEvent(e);
      };

      stopSpeaking();
      setInput('');
      // Starting a new turn supersedes any still-open confirm card — lock it so a
      // stale "Yes, refund it" button can't fire a refund the customer moved on from.
      setMessages((prev) =>
        prev.map((m) => (m.kind === 'confirm' && !m.resolved ? { ...m, resolved: 'dismissed' } : m)),
      );
      setMessages((prev) => [...prev, { id: newId(), role: 'user', text: trimmed }]);
      setActivity({ tools: [], decisions: [], retries: 0, reasoning: false });
      setPending(true);
      bubbleIdRef.current = null;
      lastReplyRef.current = '';
      pendingConfirmRef.current = null;
      try {
        await streamChat(
          { sessionId, message: trimmed, channel, token: auth.token },
          onEvent,
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) return; // turn was discarded; leave the UI alone
        if (err instanceof UnauthorizedError) {
          onUnauthorized();
          return;
        }
        setActivity((a) => ({
          tools: a?.tools ?? [],
          decisions: a?.decisions ?? [],
          retries: a?.retries ?? 0,
          reasoning: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        if (!controller.signal.aborted) {
          // Reconcile replies from the server's recorded transcript (the same
          // path history uses, which is known to render) BEFORE we clear the
          // activity box — so the reply is on screen the instant the box
          // disappears. Appends any assistant message that didn't make it into a
          // live bubble, deduped by text.
          if (auth) {
            try {
              const t = await getChatTranscript(auth.token, sessionId);
              if (t && !controller.signal.aborted) {
                setMessages((prev) => {
                  const shown = new Set(
                    prev.filter((m) => m.role === 'assistant' && !m.kind).map((m) => m.text),
                  );
                  const missing = t.messages
                    .filter((m) => m.role === 'assistant' && !shown.has(m.text))
                    .map((m) => ({ id: newId(), role: 'assistant' as const, text: m.text }));
                  return missing.length ? [...prev, ...missing] : prev;
                });
                const lastReply = t.messages.filter((m) => m.role === 'assistant').pop();
                if (lastReply) lastReplyRef.current = lastReply.text;
              }
            } catch {
              /* best-effort reconcile */
            }
          }
          // If Aria asked to confirm a refund this turn, render the confirm card
          // now — after her text, before the activity box is cleared.
          if (pendingConfirmRef.current) {
            const confirm = pendingConfirmRef.current;
            pendingConfirmRef.current = null;
            setMessages((prev) => [
              ...prev,
              { id: newId(), role: 'assistant', kind: 'confirm', text: '', confirm },
            ]);
          }
          pendingRef.current = false;
          setPending(false); // drop the activity box now that the reply is shown
          if (voiceOnRef.current && lastReplyRef.current && configRef.current) {
            void speak(lastReplyRef.current, configRef.current.voiceProvider);
          }
          void refreshHistory(); // surface the just-created / updated chat
        }
      }
    },
    [sessionId, handleEvent, auth, onUnauthorized, refreshHistory],
  );

  const startListening = useCallback(() => {
    // Second click while listening: cancel rather than start an overlapping one.
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    const rec = createRecognizer({
      onResult: (t) => void send(t, 'voice'),
      onEnd: () => {
        setListening(false);
        recognizerRef.current = null;
      },
      onError: () => {
        setListening(false);
        recognizerRef.current = null;
      },
    });
    if (!rec) return;
    recognizerRef.current = rec; // retain so it survives GC and can be stopped
    setListening(true);
    rec.start();
  }, [listening, send]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort(); // cancel any in-flight stream (and its server turn)
    stopSpeaking();
    recognizerRef.current?.stop();
    pendingRef.current = false;
    setPending(false);
    bubbleIdRef.current = null;
    lastReplyRef.current = '';
    setMessages([]);
    setActivity(null);
    setSessionId(newId());
  }, []);

  // Re-open a past chat: load its transcript and resume the same server session,
  // so the customer can keep the conversation going with full context intact.
  const openChat = useCallback(
    async (id: string) => {
      if (!auth || id === sessionId) return;
      abortRef.current?.abort();
      stopSpeaking();
      recognizerRef.current?.stop();
      pendingRef.current = false;
      setPending(false);
      bubbleIdRef.current = null;
      lastReplyRef.current = '';
      setActivity(null);
      const transcript = await getChatTranscript(auth.token, id);
      if (!transcript) return;
      setMessages(transcript.messages.map((m) => ({ id: newId(), role: m.role, text: m.text })));
      setSessionId(id);
    },
    [auth, sessionId],
  );

  // Show the customer's orders as an interactive picker — a plain data fetch,
  // no agent turn (so it costs no tokens and never dumps a table). Picking an
  // order hands off to the agent for that one order's refund flow.
  const showOrders = useCallback(async () => {
    if (!auth || pendingRef.current) return;
    try {
      const orders = await getMyOrders(auth.token);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', text: 'Show me my orders' },
        { id: newId(), role: 'assistant', kind: 'orders', text: '', orders },
      ]);
    } catch (err) {
      // A stale token (e.g. after a server restart) should send the user back to
      // login, not silently render an empty "no orders" menu.
      if (err instanceof UnauthorizedError) onUnauthorized();
    }
  }, [auth, onUnauthorized]);

  // Lock a confirm card to the customer's choice (so it can't be re-clicked).
  const resolveConfirm = useCallback((id: string, choice: 'yes' | 'no') => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, resolved: choice } : m)));
  }, []);

  return {
    sessionId,
    messages,
    input,
    setInput,
    pending,
    activity,
    voiceOn,
    setVoiceOn,
    listening,
    history,
    sttSupported: speechRecognitionSupported(),
    send,
    startListening,
    newConversation,
    openChat,
    showOrders,
    resolveConfirm,
  };
}
