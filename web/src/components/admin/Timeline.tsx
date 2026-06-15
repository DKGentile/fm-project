import { useEffect, useRef } from 'react';
import type { AgentEvent } from '@northwind/shared';
import { DECISION_META, EVENT_META, fmtClock, prettyJson } from '../../lib/format';

const HIDDEN = new Set(['assistant_delta']);

export default function Timeline({ events }: { events: AgentEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const visible = events.filter((e) => !HIDDEN.has(e.type));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [visible.length]);

  if (visible.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-slate-400">
        No reasoning yet. Start a conversation in the Customer Chat tab and watch it appear here live.
      </div>
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
      <div className="space-y-2">
        {visible.map((e) => (
          <Row key={e.seq} event={e} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Row({ event }: { event: AgentEvent }) {
  const meta = EVENT_META[event.type];

  if (event.type === 'session_start' || event.type === 'turn_complete') {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-slate-400">
        <div className="h-px flex-1 bg-slate-100" />
        {meta.icon} {meta.label}
        <div className="h-px flex-1 bg-slate-100" />
      </div>
    );
  }

  return (
    <div className={`fade-in rounded-lg border-l-2 bg-white pl-3 ${meta.rail}`}>
      <div className="flex items-center gap-2 py-1.5">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.chip}`}>
          <span>{meta.icon}</span>
          {meta.label}
          {'tool' in event ? <span className="font-mono opacity-80">· {event.tool}</span> : null}
        </span>
        <span className="ml-auto font-mono text-[10px] text-slate-400">{fmtClock(event.ts)}</span>
      </div>
      <div className="pb-2 pr-2 text-[13px] text-slate-700">
        <Body event={event} />
      </div>
    </div>
  );
}

function Body({ event }: { event: AgentEvent }) {
  switch (event.type) {
    case 'user_message':
      return <p className="whitespace-pre-wrap">{event.text}</p>;
    case 'thinking':
      return (
        <p className="whitespace-pre-wrap rounded-md bg-violet-50/70 px-2 py-1.5 text-[12px] leading-relaxed text-violet-900">
          {event.text}
        </p>
      );
    case 'assistant_message':
      return <p className="whitespace-pre-wrap text-slate-800">{event.text}</p>;
    case 'tool_call':
      return <Json value={event.input} label="input" />;
    case 'tool_result':
      return (
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
            <span>{event.durationMs} ms</span>
            {event.isError && <span className="font-medium text-rose-500">error</span>}
          </div>
          <Json value={event.output} label="output" error={event.isError} />
        </div>
      );
    case 'tool_retry':
      return (
        <p className="text-amber-800">
          Attempt {event.attempt}/{event.maxAttempts} failed — retrying in {event.nextDelayMs} ms.
          <span className="mt-1 block font-mono text-[11px] text-amber-700/80">{event.error}</span>
        </p>
      );
    case 'api_retry':
      return (
        <p className="text-amber-800">
          Model API attempt {event.attempt}/{event.maxAttempts} failed — retrying in {event.nextDelayMs} ms.
          <span className="mt-1 block font-mono text-[11px] text-amber-700/80">{event.error}</span>
        </p>
      );
    case 'decision': {
      const d = DECISION_META[event.outcome];
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${d.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
            {d.label}
          </span>
          <span className="text-slate-700">{event.detail}</span>
          {event.amount != null && (
            <span className="font-mono text-[12px] text-emerald-700">${event.amount.toFixed(2)}</span>
          )}
          {event.policyRefs?.map((r) => (
            <span key={r} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              {r}
            </span>
          ))}
        </div>
      );
    }
    case 'error':
      return <p className="text-rose-600">{event.message}</p>;
    default:
      return null;
  }
}

function Json({ value, label, error }: { value: unknown; label: string; error?: boolean }) {
  return (
    <details className="group" open>
      <summary className="cursor-pointer select-none text-[11px] text-slate-400 hover:text-slate-600">
        {label}
      </summary>
      <pre
        className={`scroll-thin mt-1 max-h-56 overflow-auto rounded-md border px-2.5 py-2 font-mono text-[11px] leading-relaxed ${
          error ? 'border-rose-100 bg-rose-50/50 text-rose-900' : 'border-slate-100 bg-slate-50 text-slate-700'
        }`}
      >
        {prettyJson(value)}
      </pre>
    </details>
  );
}
