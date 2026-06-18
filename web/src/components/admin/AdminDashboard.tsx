import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getSessionEvents } from '../../lib/api';
import { useAdminData } from '../../hooks/useAdminData';
import MetricsBar from './MetricsBar';
import SessionList from './SessionList';
import Timeline from './Timeline';
import CrmViewer from './CrmViewer';
import PolicyViewer from './PolicyViewer';
import EvalPanel from './EvalPanel';

type SubView = 'reasoning' | 'crm' | 'policy' | 'evals';

export default function AdminDashboard() {
  const { state, addEvents, eventsFor } = useAdminData();
  const [selected, setSelected] = useState<string | null>(null);
  const [sub, setSub] = useState<SubView>('reasoning');
  const loadedRef = useRef<Set<string>>(new Set());

  const sessions = state?.sessions ?? [];

  // Auto-select the most recent session.
  useEffect(() => {
    if (!selected && sessions.length > 0) setSelected(sessions[0].id);
  }, [sessions, selected]);

  // Lazy-load history for a selected session we haven't streamed.
  useEffect(() => {
    if (!selected || loadedRef.current.has(selected)) return;
    loadedRef.current.add(selected);
    getSessionEvents(selected)
      .then((evs) => addEvents(selected, evs))
      // On failure, drop the marker so re-selecting the session retries the fetch.
      .catch(() => loadedRef.current.delete(selected));
  }, [selected, addEvents]);

  const events = selected ? eventsFor(selected) : [];

  return (
    <div className="flex h-full flex-col gap-3">
      <MetricsBar metrics={state?.metrics} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        <SessionList sessions={sessions} selected={selected} onSelect={setSelected} />

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
            <SubTab active={sub === 'reasoning'} onClick={() => setSub('reasoning')}>
              Live reasoning
            </SubTab>
            <SubTab active={sub === 'crm'} onClick={() => setSub('crm')}>
              CRM data
            </SubTab>
            <SubTab active={sub === 'policy'} onClick={() => setSub('policy')}>
              Refund policy
            </SubTab>
            <SubTab active={sub === 'evals'} onClick={() => setSub('evals')}>
              Policy evals
            </SubTab>
            {sub === 'reasoning' && selected && (
              <span className="ml-auto truncate font-mono text-[11px] text-slate-400">{selected.slice(0, 8)}…</span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {sub === 'reasoning' && <Timeline events={events} />}
            {sub === 'crm' && <CrmViewer />}
            {sub === 'policy' && <PolicyViewer />}
            {sub === 'evals' && <EvalPanel />}
          </div>
        </section>
      </div>
    </div>
  );
}

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
        active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
