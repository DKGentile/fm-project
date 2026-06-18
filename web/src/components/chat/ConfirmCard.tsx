import type { ConfirmDetails } from '../../hooks/useChat';

const RESOLVED_LABEL = {
  yes: '✓ Confirmed',
  no: '✕ Cancelled',
  dismissed: '✕ Dismissed',
} as const;

/** A final "are you sure?" gate before a refund is processed. Picking Yes/No
 *  sends Aria the customer's decision; the card then locks to that choice. It's
 *  also auto-dismissed (locked, read-only) once a new turn supersedes it. */
export default function ConfirmCard({
  confirm,
  resolved,
  onConfirm,
  onCancel,
  disabled,
}: {
  confirm: ConfirmDetails;
  resolved?: 'yes' | 'no' | 'dismissed';
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <div className="fade-in flex justify-start">
      <div className="w-[80%] rounded-2xl rounded-bl-sm border border-amber-200 bg-amber-50/70 px-3.5 py-3 shadow-sm">
        <div className="text-[13px] text-slate-800">
          Just to confirm — refund <strong>{confirm.item}</strong> for{' '}
          <strong>${confirm.amount}</strong> to {confirm.method}?
        </div>

        {resolved ? (
          <div className="mt-2 text-[12px] font-medium text-slate-500">{RESOLVED_LABEL[resolved]}</div>
        ) : (
          <div className="mt-2.5 flex gap-2">
            <button
              disabled={disabled}
              onClick={onConfirm}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              Yes, refund it
            </button>
            <button
              disabled={disabled}
              onClick={onCancel}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              No, keep it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
