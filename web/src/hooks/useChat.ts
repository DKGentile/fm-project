/**
 * All customer-chat state + behaviour: streaming a turn, building message
 * bubbles, tracking per-turn tool activity, and the voice (STT/TTS) lifecycle.
 * Keeps ChatPanel purely presentational.
 */

import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, AppConfig, DecisionOutcome } from '@northwind/shared';
import { streamChat, UnauthorizedError } from '../lib/api';
import { newId } from '../lib/ids';
import type { AuthSession } from './useAuth';
import {
  createRecognizer,
  speak,
  speechRecognitionSupported,
  stopSpeaking,
  type Recognizer,
} from '../lib/voice';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
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
      case 'tool_result':
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
      setMessages((prev) => [...prev, { id: newId(), role: 'user', text: trimmed }]);
      setActivity({ tools: [], decisions: [], retries: 0, reasoning: false });
      setPending(true);
      bubbleIdRef.current = null;
      lastReplyRef.current = '';
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
          pendingRef.current = false;
          setPending(false);
          if (voiceOnRef.current && lastReplyRef.current && configRef.current) {
            void speak(lastReplyRef.current, configRef.current.voiceProvider);
          }
        }
      }
    },
    [sessionId, handleEvent, auth, onUnauthorized],
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

  return {
    messages,
    input,
    setInput,
    pending,
    activity,
    voiceOn,
    setVoiceOn,
    listening,
    sttSupported: speechRecognitionSupported(),
    send,
    startListening,
    newConversation,
  };
}
