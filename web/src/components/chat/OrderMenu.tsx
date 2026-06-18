import type { Order, OrderStatus } from '@demitri/shared';

const STATUS_PILL: Record<OrderStatus, string> = {
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  shipped: 'bg-sky-50 text-sky-700 border-sky-200',
  processing: 'bg-slate-100 text-slate-600 border-slate-200',
  refunded: 'bg-violet-50 text-violet-700 border-violet-200',
  cancelled: 'bg-rose-50 text-rose-600 border-rose-200',
};

/** An interactive in-chat order picker. Picking an order starts that order's
 *  refund flow with the agent; the customer can also just type instead. */
export default function OrderMenu({
  orders,
  onSelect,
  disabled,
}: {
  orders: Order[];
  onSelect: (order: Order) => void;
  disabled: boolean;
}) {
  return (
    <div className="fade-in flex justify-start">
      <div className="w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3.5 py-3 shadow-sm">
        <div className="mb-2 text-[13px] text-slate-700">
          Here are your orders — pick one to start a refund:
        </div>
        {orders.length === 0 ? (
          <div className="text-[12px] text-slate-500">You don't have any orders on file.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {orders.map((o) => {
              const item = o.items[0];
              const more = o.items.length > 1 ? ` +${o.items.length - 1} more` : '';
              return (
                <button
                  key={o.id}
                  disabled={disabled}
                  onClick={() => onSelect(o)}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-slate-800">
                      {item?.name ?? o.id}
                      {more}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {o.id} · {o.deliveredDate ?? o.date} · ${o.total}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_PILL[o.status]}`}
                  >
                    {o.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-2 text-[11px] text-slate-400">
          …or just type your question below — no need to pick one.
        </div>
      </div>
    </div>
  );
}
