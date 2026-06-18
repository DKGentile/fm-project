import type { ChatHistoryItem } from '@demitri/shared';
import { DECISION_META } from '../../lib/format';

/** Compact timestamp: time for today's chats, month/day for older ones. */
function when(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The signed-in customer's own past conversations — click to reopen & resume. */
export default function HistoryPanel({
  chats,
  activeId,
  onOpen,
}: {
  chats: ChatHistoryItem[];
  activeId: string;
  onOpen: (id: string) => void;
}) {
  if (chats.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Your chats
      </div>
      <ul className="space-y-1">
        {chats.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onOpen(c.id)}
              className={`w-full rounded-lg px-2.5 py-1.5 text-left transition ${
                c.id === activeId ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="truncate text-[12px] font-medium">{c.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>{c.channel === 'voice' ? '🎙' : '💬'}</span>
                <span>{when(c.lastActivity)}</span>
                {c.decisions.length > 0 && (
                  <span className="flex items-center gap-1">
                    {c.decisions.map((d, i) => (
                      <span key={i} className={`h-1.5 w-1.5 rounded-full ${DECISION_META[d].dot}`} />
                    ))}
                  </span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
