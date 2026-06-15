export default function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={`fade-in flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-sm ${
          isUser
            ? 'rounded-br-sm bg-slate-900 text-white'
            : 'rounded-bl-sm border border-slate-200 bg-slate-50 text-slate-800'
        }`}
      >
        {text || <span className="caret text-slate-300" />}
      </div>
    </div>
  );
}
