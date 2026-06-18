import { useEffect, useState } from 'react';
import type { Customer } from '@demitri/shared';
import { getCrm } from '../../lib/api';

const STATUS_COLOR: Record<string, string> = {
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  shipped: 'bg-sky-50 text-sky-700 border-sky-200',
  processing: 'bg-slate-50 text-slate-600 border-slate-200',
  refunded: 'bg-violet-50 text-violet-700 border-violet-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
};

export default function CrmViewer() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    getCrm().then((d) => setCustomers(d.customers)).catch(() => setCustomers([]));
  }, []);

  const filtered = customers.filter((c) => {
    if (!q.trim()) return true;
    const hay = `${c.name} ${c.email} ${c.id} ${c.orders.map((o) => o.id).join(' ')} ${c.scenario ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter customers, orders, scenarios…"
        className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
      />
      <div className="space-y-3">
        {filtered.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-slate-800">
                  {c.name} <span className="font-mono text-[11px] font-normal text-slate-400">{c.id}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {c.email} · {c.phone}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-[10px]">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{c.loyaltyTier}</span>
                <span className={`rounded px-1.5 py-0.5 ${c.refundsLast12mo > 3 ? 'bg-rose-100 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
                  {c.refundsLast12mo} refunds / 12mo
                </span>
              </div>
            </div>
            {c.scenario && <div className="mt-1.5 text-[11px] italic text-slate-400">{c.scenario}</div>}
            <div className="mt-2 space-y-1.5">
              {c.orders.map((o) => (
                <div key={o.id} className="rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-1.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="font-mono font-medium text-slate-700">{o.id}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[o.status] ?? ''}`}>
                      {o.status}
                    </span>
                    <span className="ml-auto font-mono text-[12px] text-slate-600">${o.total.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {o.items.map((i) => (
                      <span key={i.sku} className="mr-2 inline-block">
                        {i.name}
                        <span className="ml-1 text-slate-400">
                          ({i.category}
                          {i.condition && i.condition !== 'new' ? ` · ${i.condition}` : ''})
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    ordered {o.date}
                    {o.deliveredDate ? ` · delivered ${o.deliveredDate}` : ' · not delivered'} · {o.paymentMethod}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
