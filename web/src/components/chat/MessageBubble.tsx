import type { ReactNode } from 'react';

/** Inline **bold** → <strong>; everything else stays literal text. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Minimal markdown: paragraphs, blank-line spacing, and "- "/"* " bullet lists. */
function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`u${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-4">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim() === '') blocks.push(<div key={`s${blocks.length}`} className="h-2" />);
    else blocks.push(<p key={`p${blocks.length}`}>{renderInline(line)}</p>);
  }
  flush();
  return blocks;
}

export default function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={`fade-in flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed shadow-sm ${
          isUser
            ? 'whitespace-pre-wrap rounded-br-sm bg-slate-900 text-white'
            : 'rounded-bl-sm border border-slate-200 bg-slate-50 text-slate-800'
        }`}
      >
        {isUser ? text : text ? renderMarkdown(text) : <span className="caret text-slate-300" />}
      </div>
    </div>
  );
}
