import { SCENARIOS } from '../../lib/scenarios';

/** The right-hand column: one-click demo scenarios + a short explainer. */
export default function ScenarioSidebar({
  pending,
  onPick,
  onShowOrders,
}: {
  pending: boolean;
  onPick: (text: string) => void;
  onShowOrders: () => void;
}) {
  return (
    <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto lg:flex">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          How can we help you?
        </div>
        <div className="flex flex-col gap-1.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              disabled={pending}
              onClick={() => (s.action === 'orders' ? onShowOrders() : onPick(s.text))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-left text-[13px] text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              <span className="font-medium text-slate-800">{s.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{s.text}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
