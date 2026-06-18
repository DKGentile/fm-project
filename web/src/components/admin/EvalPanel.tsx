import { useRef, useState } from 'react';
import type { EvalOutcome, EvalResult, EvalSummary } from '@northwind/shared';
import { streamEvals } from '../../lib/api';

const OUTCOME_LABEL: Record<EvalOutcome, string> = {
  approve: 'Approve',
  deny: 'Deny',
  escalate: 'Escalate',
  photo: 'Request photo',
  unknown: '—',
};

/** Runs the policy eval suite and shows a live pass/fail scoreboard — proof the
 *  agent reaches the policy-correct decision, including under adversarial pressure. */
export default function EvalPanel() {
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    setResults([]);
    setSummary(null);
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamEvals((e) => {
        if (e.type === 'eval_result') setResults((r) => [...r, e.result]);
        else if (e.type === 'eval_done') setSummary(e.summary);
        else if (e.type === 'eval_error') setError(e.message);
      }, ac.signal);
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const allPass = summary && summary.passed === summary.total;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold text-slate-800">Policy evals</div>
          <div className="text-[11px] text-slate-500">
            Does Aria reach the policy-correct decision — including when a customer tries to talk her past the rules?
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(summary || running) && (
            <div
              className={`rounded-lg px-2.5 py-1 text-[13px] font-semibold ${
                running
                  ? 'bg-slate-100 text-slate-500'
                  : allPass
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800'
              }`}
            >
              {running ? `${passed}/${results.length} so far…` : `${summary!.passed} / ${summary!.total} passed`}
            </div>
          )}
          <button
            onClick={run}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium text-white transition ${
              running ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-900 hover:bg-slate-700'
            }`}
          >
            {running ? 'Stop' : '▷ Run policy evals'}
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && <div className="mb-2 text-[12px] text-rose-600">⚠ {error}</div>}

        {results.length === 0 && !running && !error && (
          <div className="mt-10 text-center text-[12px] text-slate-400">
            Runs a suite of refund scenarios against the live agent and scores each decision against the
            deterministic policy engine.
            <br />
            Press <span className="font-medium text-slate-600">Run policy evals</span> to start.
          </div>
        )}

        <div className="space-y-1.5">
          {results.map((r) => (
            <div
              key={r.id}
              className="fade-in flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <span className={`text-[13px] ${r.pass ? 'text-emerald-600' : 'text-rose-600'}`}>
                {r.pass ? '✓' : '✕'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-slate-800">{r.label}</div>
                <div className="truncate text-[11px] text-slate-400">“{r.message}”</div>
              </div>
              {r.category === 'adversarial' && (
                <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  adversarial
                </span>
              )}
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{r.rule}</span>
              <span className="w-[120px] shrink-0 text-right text-[11px]">
                {r.pass ? (
                  <span className="text-slate-500">{OUTCOME_LABEL[r.got]}</span>
                ) : (
                  <span className="text-rose-600">
                    got {OUTCOME_LABEL[r.got]} · want {r.expected.map((o) => OUTCOME_LABEL[o]).join('/')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
