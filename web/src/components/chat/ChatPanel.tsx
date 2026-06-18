import { useEffect, useRef } from 'react';
import type { AppConfig } from '@northwind/shared';
import type { AuthSession } from '../../hooks/useAuth';
import { useChat } from '../../hooks/useChat';
import MessageBubble from './MessageBubble';
import OrderMenu from './OrderMenu';
import ConfirmCard from './ConfirmCard';
import ActivityCard from './ActivityCard';
import Composer from './Composer';
import Welcome from './Welcome';
import ScenarioSidebar from './ScenarioSidebar';
import HistoryPanel from './HistoryPanel';
import LoginOverlay from './LoginOverlay';

interface ChatPanelProps {
  config: AppConfig | null;
  auth: AuthSession | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onLogout: () => void;
}

export default function ChatPanel({ config, auth, onLogin, onLogout }: ChatPanelProps) {
  const chat = useChat(config, auth, onLogout);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages, chat.activity, chat.pending]);

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      {/* `relative` so the login overlay can sit over just the chat box. */}
      <section className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white">
              A
            </div>
            <div className="text-sm font-semibold text-slate-800">Aria · Refund Support</div>
            {auth && (
              <span className="ml-1 flex items-center gap-1 text-[11px] text-emerald-600">
                <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> online
              </span>
            )}
          </div>
          {auth && (
            <div className="flex items-center gap-2 text-xs">
              <span className="hidden text-slate-400 sm:inline">{auth.customer.name}</span>
              <button
                onClick={chat.newConversation}
                className="rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                + New chat
              </button>
              <button
                onClick={onLogout}
                className="rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-500 transition hover:bg-slate-50"
              >
                Log out
              </button>
            </div>
          )}
        </header>

        <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {chat.messages.length === 0 && (
            <Welcome name={auth?.customer.name} onSeeOrders={() => void chat.showOrders()} />
          )}
          {chat.messages.map((m) => {
            if (m.kind === 'orders') {
              return (
                <OrderMenu
                  key={m.id}
                  orders={m.orders ?? []}
                  disabled={chat.pending}
                  onSelect={(o) =>
                    void chat.send(
                      `I'd like a refund for order ${o.id}${
                        o.items.length === 1 ? ` — ${o.items[0].name}` : ''
                      }.`,
                    )
                  }
                />
              );
            }
            if (m.kind === 'confirm' && m.confirm) {
              return (
                <ConfirmCard
                  key={m.id}
                  confirm={m.confirm}
                  resolved={m.resolved}
                  disabled={chat.pending}
                  onConfirm={() => {
                    chat.resolveConfirm(m.id, 'yes');
                    void chat.send(`Yes — please go ahead and refund order ${m.confirm!.orderId}.`);
                  }}
                  onCancel={() => {
                    chat.resolveConfirm(m.id, 'no');
                    void chat.send(`Actually, never mind — please don't refund order ${m.confirm!.orderId}.`);
                  }}
                />
              );
            }
            return <MessageBubble key={m.id} role={m.role} text={m.text} />;
          })}
          {/* Live work trace while Aria is responding; it disappears once the
              reply lands (the outcome is in her summary + the Admin Dashboard).
              Kept on screen only if the turn errored, so errors stay visible. */}
          {chat.activity && (chat.pending || chat.activity.error) && (
            <ActivityCard activity={chat.activity} pending={chat.pending} />
          )}
        </div>

        <Composer
          input={chat.input}
          setInput={chat.setInput}
          onSend={() => void chat.send(chat.input)}
          pending={chat.pending}
          listening={chat.listening}
          onMic={chat.startListening}
          sttSupported={chat.sttSupported}
          voiceOn={chat.voiceOn}
          setVoiceOn={chat.setVoiceOn}
        />

        {!auth && <LoginOverlay onLogin={onLogin} />}
      </section>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <ScenarioSidebar
          pending={chat.pending || !auth}
          onPick={(t) => void chat.send(t)}
          onShowOrders={() => void chat.showOrders()}
        />
        {auth && (
          <HistoryPanel
            chats={chat.history}
            activeId={chat.sessionId}
            onOpen={(id) => void chat.openChat(id)}
          />
        )}
      </div>
    </div>
  );
}
