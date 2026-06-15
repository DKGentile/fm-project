import type { SessionSummary } from '@northwind/shared';
import { DECISION_META, fmtTime } from '../../lib/format';

function SessionRow({ s, active, onClick }: { s: SessionSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition ${
        active ? 'border-indigo-300 bg-indigo-50/70' : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]">{s.channel === 'voice' ? '🎙' : '💬'}</span>
        <span className="truncate text-[12px] font-semibold text-slate-800">
          {s.customerName ?? 'Customer'}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-500">{s.title}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
        <span>{fmtTime(s.lastActivity)}</span>
        <span>· {s.messageCount} msgs</span>
        <span>· {s.toolCallCount} tools</span>
        {s.retryCount > 0 && <span className="text-amber-600">· {s.retryCount} retries</span>}
      </div>
      {s.decisions.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {s.decisions.map((d, i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${DECISION_META[d].dot}`} title={DECISION_META[d].label} />
          ))}
        </div>
      )}
    </button>
  );
}

export default function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: SessionSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 text-[12px] font-semibold text-slate-600">
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live sessions
        <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
          {sessions.length}
        </span>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-2">
        {sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-slate-400">
            No sessions yet. Send a message in the Customer Chat tab.
          </div>
        )}
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} active={s.id === selected} onClick={() => onSelect(s.id)} />
        ))}
      </div>
    </aside>
  );
}
