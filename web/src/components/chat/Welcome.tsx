import { EXAMPLE_PROMPT } from '../../lib/scenarios';

export default function Welcome({ onPick, name }: { onPick: (text: string) => void; name?: string }) {
  const firstName = name?.split(' ')[0];
  return (
    <div className="fade-in mx-auto mt-6 max-w-md text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xl text-white shadow">
        ↺
      </div>
      <div className="text-[15px] font-semibold text-slate-800">
        Hi{firstName ? ` ${firstName}` : ''}, I'm Aria from Northwind Goods.
      </div>
      <p className="mt-1 text-sm text-slate-500">
        I can help with refunds and returns. Tell me your order ID or the email on your account, and
        what you'd like to return.
      </p>
      <button
        onClick={() => onPick(EXAMPLE_PROMPT)}
        className="mt-4 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-700"
      >
        Start with an example →
      </button>
    </div>
  );
}
