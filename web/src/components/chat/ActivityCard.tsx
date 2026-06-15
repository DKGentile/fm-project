import { DECISION_META } from '../../lib/format';
import type { TurnActivity } from '../../hooks/useChat';

/** The compact "agent is working" strip shown under the customer's message. */
export default function ActivityCard({ activity, pending }: { activity: TurnActivity; pending: boolean }) {
  return (
    <div className="fade-in flex justify-start">
      <div className="w-[80%] rounded-2xl rounded-bl-sm border border-indigo-100 bg-indigo-50/60 px-3.5 py-2.5 text-[12px]">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-indigo-700">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {pending ? (activity.reasoning ? 'Reasoning & verifying policy…' : 'Working…') : 'Done'}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {activity.tools.map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
                t.status === 'done'
                  ? 'border-emerald-200 bg-white text-emerald-700'
                  : t.status === 'error'
                    ? 'border-rose-200 bg-white text-rose-600'
                    : 'border-indigo-200 bg-white text-indigo-600'
              }`}
            >
              {t.status === 'done' ? '✓' : t.status === 'error' ? '✕' : '⏳'} {t.tool}
            </span>
          ))}
        </div>

        {activity.retries > 0 && (
          <div className="mt-1.5 text-[11px] font-medium text-amber-700">
            🔁 recovered from {activity.retries} transient failure{activity.retries > 1 ? 's' : ''}
          </div>
        )}

        {activity.decisions.map((d, i) => (
          <span
            key={i}
            className={`mt-1.5 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${DECISION_META[d.outcome].chip}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${DECISION_META[d.outcome].dot}`} />
            {DECISION_META[d.outcome].label}
          </span>
        ))}

        {activity.error && <div className="mt-1.5 text-[11px] text-rose-600">⚠ {activity.error}</div>}
      </div>
    </div>
  );
}
