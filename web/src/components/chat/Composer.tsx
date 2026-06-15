interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  listening: boolean;
  onMic: () => void;
  sttSupported: boolean;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
}

export default function Composer({
  input,
  setInput,
  onSend,
  pending,
  listening,
  onMic,
  sttSupported,
  voiceOn,
  setVoiceOn,
}: ComposerProps) {
  return (
    <div className="border-t border-slate-100 px-3 py-3">
      <div className="flex items-end gap-2">
        <button
          onClick={onMic}
          disabled={!sttSupported || pending}
          title={sttSupported ? 'Hold a conversation by voice' : 'Speech recognition not supported in this browser'}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${
            listening
              ? 'border-rose-300 bg-rose-50 text-rose-600'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
          } disabled:opacity-40`}
        >
          {listening ? <span className="live-dot">●</span> : '🎙'}
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={1}
          placeholder={listening ? 'Listening…' : 'Ask about a refund — include your order ID or email…'}
          className="max-h-32 flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[14px] outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
        />

        <button
          onClick={() => setVoiceOn(!voiceOn)}
          title="Read replies aloud"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${
            voiceOn
              ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
              : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50'
          }`}
        >
          {voiceOn ? '🔊' : '🔈'}
        </button>

        <button
          onClick={onSend}
          disabled={pending || !input.trim()}
          className="grid h-10 shrink-0 place-items-center rounded-xl bg-slate-900 px-4 text-[14px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? '…' : 'Send'}
        </button>
      </div>
      <div className="mt-1 px-1 text-[10px] text-slate-400">
        Enter to send · Shift+Enter for newline · 🎙 speak · 🔊 read replies aloud
      </div>
    </div>
  );
}
