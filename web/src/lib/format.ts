import type { AgentEventType, DecisionOutcome } from '@northwind/shared';

export interface EventMeta {
  label: string;
  icon: string;
  /** Tailwind classes for the chip. */
  chip: string;
  /** Accent border colour for the timeline rail. */
  rail: string;
}

export const EVENT_META: Record<AgentEventType, EventMeta> = {
  session_start: { label: 'Session started', icon: '◆', chip: 'bg-slate-100 text-slate-600', rail: 'border-slate-300' },
  user_message: { label: 'Customer', icon: '🧑', chip: 'bg-slate-800 text-white', rail: 'border-slate-700' },
  thinking: { label: 'Reasoning', icon: '🧠', chip: 'bg-violet-100 text-violet-700', rail: 'border-violet-400' },
  assistant_delta: { label: 'Reply (streaming)', icon: '…', chip: 'bg-indigo-50 text-indigo-600', rail: 'border-indigo-200' },
  assistant_message: { label: 'Aria', icon: '💬', chip: 'bg-indigo-100 text-indigo-700', rail: 'border-indigo-400' },
  tool_call: { label: 'Tool call', icon: '🛠', chip: 'bg-sky-100 text-sky-700', rail: 'border-sky-400' },
  tool_result: { label: 'Tool result', icon: '↩', chip: 'bg-cyan-50 text-cyan-700', rail: 'border-cyan-300' },
  tool_retry: { label: 'Tool retry', icon: '🔁', chip: 'bg-amber-100 text-amber-800', rail: 'border-amber-400' },
  api_retry: { label: 'API retry', icon: '🔁', chip: 'bg-amber-100 text-amber-800', rail: 'border-amber-400' },
  decision: { label: 'Decision', icon: '⚖', chip: 'bg-slate-900 text-white', rail: 'border-slate-900' },
  error: { label: 'Error', icon: '⚠', chip: 'bg-rose-100 text-rose-700', rail: 'border-rose-400' },
  turn_complete: { label: 'Turn complete', icon: '○', chip: 'bg-slate-100 text-slate-500', rail: 'border-slate-200' },
};

export const DECISION_META: Record<DecisionOutcome, { label: string; chip: string; dot: string }> = {
  approved: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  denied: { label: 'Denied', chip: 'bg-rose-100 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  escalated: { label: 'Escalated', chip: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  info_requested: { label: 'Info requested', chip: 'bg-sky-100 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
};

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
