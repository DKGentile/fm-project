import { useEffect, useState, type ReactNode } from 'react';
import type { AppConfig } from '@northwind/shared';
import { getConfig, resetDemo } from './lib/api';
import { useAuth } from './hooks/useAuth';
import ChatPanel from './components/chat/ChatPanel';
import AdminDashboard from './components/admin/AdminDashboard';

type Tab = 'chat' | 'admin';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { auth, login, logout } = useAuth();
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('northwind.theme') === 'dark';
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
      localStorage.setItem('northwind.theme', dark ? 'dark' : 'light');
    } catch {
      /* storage may be unavailable */
    }
  }, [dark]);

  async function onReset() {
    if (!confirm('Reset the CRM and clear all sessions? This replays the demo from scratch.')) return;
    await resetDemo();
    location.reload();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
              <span className="text-lg">↺</span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-slate-900">Northwind Refund Agent</div>
              <div className="text-[11px] text-slate-500">AI customer support · powered by Claude tool-calling</div>
            </div>
          </div>

          <nav className="ml-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
              Customer Chat
            </TabButton>
            <TabButton active={tab === 'admin'} onClick={() => setTab('admin')}>
              Admin Dashboard
            </TabButton>
          </nav>

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
            <button
              onClick={() => setDark((d) => !d)}
              title="Toggle dark mode"
              aria-label="Toggle dark mode"
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 transition hover:bg-slate-50"
            >
              {dark ? '☀' : '🌙'}
            </button>
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
        {tab === 'chat' ? (
          <ChatPanel
            key={auth?.customer.id ?? 'anon'}
            config={config}
            auth={auth}
            onLogin={login}
            onLogout={logout}
          />
        ) : (
          <AdminDashboard />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
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
