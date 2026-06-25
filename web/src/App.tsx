import { useEffect, useState, type ReactNode } from 'react';
import type { AppConfig } from '@demitri/shared';
import { getConfig, resetDemo } from './lib/api';
import { useAuth } from './hooks/useAuth';
import ChatPanel from './components/chat/ChatPanel';
import AdminDashboard from './components/admin/AdminDashboard';

const BRAND = '[Private Client]';

/**
 * Two separate surfaces, reachable by URL only (there is no in-app navigation
 * between them — like a real deployment):
 *   /admin            → internal support / ops console
 *   /refund_request   → customer-facing refund assistant (the default)
 */
export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { auth, login, logout } = useAuth();
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('demitri.theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('demitri.theme', dark ? 'dark' : 'light');
    } catch {
      /* storage may be unavailable */
    }
  }, [dark]);

  // Show the customer path in the URL bar when landing on the bare root.
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', '/refund_request');
    }
  }, []);

  async function onReset() {
    if (!confirm('Reset the CRM and clear all sessions? This replays the demo from scratch.')) return;
    await resetDemo();
    location.reload();
  }

  const themeToggle = (
    <button
      onClick={() => setDark((d) => !d)}
      title="Toggle dark mode"
      aria-label="Toggle dark mode"
      className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition hover:bg-slate-50"
    >
      {dark ? '☀' : '🌙'}
    </button>
  );

  // ───────────────────────── /admin — internal ops console ─────────────────────────
  if (window.location.pathname.startsWith('/admin')) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-5 py-3">
            <Logo title={`${BRAND} · Support Console`} subtitle="Internal · AI refund operations" />
            <div className="ml-auto flex items-center gap-2 text-[11px]">
              {config && (
                <>
                  <Badge title="Agent model">{config.model}</Badge>
                  <Badge title="Reasoning effort">effort: {config.effort}</Badge>
                  <Badge title="Voice provider">
                    voice: {config.voiceProvider === 'elevenlabs' ? 'ElevenLabs' : 'browser'}
                  </Badge>
                  {config.flakyGateway && <Badge title="Simulated flaky gateway">gateway: flaky</Badge>}
                </>
              )}
              {themeToggle}
              <button
                onClick={onReset}
                className="rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Reset demo
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 overflow-hidden px-5 py-4">
          <AdminDashboard />
        </main>
      </div>
    );
  }

  // ───────────────────── /refund_request — customer-facing page ─────────────────────
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-5 py-3">
          <Logo title={BRAND} subtitle="Returns & Refunds" />
          <div className="ml-auto">{themeToggle}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1100px] flex-1 overflow-hidden px-5 py-4">
        <ChatPanel
          key={auth?.customer.id ?? 'anon'}
          config={config}
          auth={auth}
          onLogin={login}
          onLogout={logout}
        />
      </main>
    </div>
  );
}

function Logo({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
        <span className="text-lg">↺</span>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500">{subtitle}</div>
      </div>
    </div>
  );
}

function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="hidden rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-slate-600 sm:inline"
    >
      {children}
    </span>
  );
}
