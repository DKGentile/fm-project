import { useEffect, useState, type FormEvent } from 'react';
import { getDemoAccounts, type DemoAccount } from '../../lib/api';

/** A login card that sits over the chat box until the customer authenticates. */
export default function LoginOverlay({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(true);

  useEffect(() => {
    getDemoAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-10 grid place-items-center p-4 backdrop-blur-md">
      <div className="w-[min(94%,400px)] rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg text-white shadow">
            🔒
          </div>
          <div className="text-[15px] font-semibold text-slate-800">Sign in to your account</div>
          <div className="text-[12px] text-slate-500">Log in to chat with Aria about your orders.</div>
        </div>

        <form onSubmit={submit} className="space-y-2.5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoFocus
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          {error && (
            <div className="rounded-md bg-rose-50 px-3 py-1.5 text-[12px] text-rose-600">{error}</div>
          )}
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-[14px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            onClick={() => setShowAccounts((s) => !s)}
            className="text-[12px] font-medium text-indigo-600 transition hover:text-indigo-700"
          >
            {showAccounts ? 'Hide' : 'Show'} demo accounts (password: <span className="font-mono">password</span>)
          </button>
          {showAccounts && (
            <div className="scroll-thin mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    setEmail(a.email);
                    setPassword('password');
                    setError('');
                  }}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-slate-700">{a.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {a.orderCount} order{a.orderCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-400">{a.email}</div>
                  {a.scenario && (
                    <div className="mt-0.5 text-[10px] italic leading-snug text-slate-400">{a.scenario}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
