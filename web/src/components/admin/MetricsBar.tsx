import type { Metrics } from '@demitri/shared';

type Tone = 'slate' | 'emerald' | 'rose' | 'amber' | 'sky';

const TONES: Record<Tone, string> = {
  slate: 'text-slate-800',
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  sky: 'text-sky-600',
};

function Metric({ label, value, tone = 'slate' }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${TONES[tone]}`}>{value}</div>
    </div>
  );
}

export default function MetricsBar({ metrics: m }: { metrics: Metrics | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
      <Metric label="Sessions" value={m?.sessions ?? 0} />
      <Metric label="Approved" value={m?.approved ?? 0} tone="emerald" />
      <Metric label="Denied" value={m?.denied ?? 0} tone="rose" />
      <Metric label="Escalated" value={m?.escalated ?? 0} tone="amber" />
      <Metric label="Info req." value={m?.infoRequested ?? 0} tone="sky" />
      <Metric label="Tool calls" value={m?.toolCalls ?? 0} />
      <Metric label="Retries" value={m?.retries ?? 0} tone={m && m.retries > 0 ? 'amber' : 'slate'} />
    </div>
  );
}
