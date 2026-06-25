import type { ReactNode } from 'react';

/** Order ids look like O1001 — a standalone "O" followed by 3+ digits. */
const ORDER_ID = /\bO\d{3,}\b/;

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

/** A one-click "Refund" chip that starts the refund flow for a named order. */
function RefundButton({
  orderId,
  onRefund,
  disabled,
}: {
  orderId: string;
  onRefund: (orderId: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => onRefund(orderId)}
      title={`Request a refund for ${orderId}`}
      className="ml-1.5 inline-flex items-center rounded-md bg-blue-600 px-1.5 py-0.5 align-middle text-[10px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
    >
      Refund
    </button>
  );
}

/** Placeholder "Contact" chip — same format as Refund, not yet wired up. */
function ContactButton({ disabled }: { disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={() => {}}
      title="Contact support"
      className="ml-1.5 inline-flex items-center rounded-md bg-blue-600 px-1.5 py-0.5 align-middle text-[10px] font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
    >
      Contact
    </button>
  );
}

/** Render one text line plus, if it names an order, inline Refund + Contact buttons. */
function line(text: string, key: string, onRefund?: (id: string) => void, disabled?: boolean): ReactNode {
  const id = onRefund ? text.match(ORDER_ID)?.[0] : undefined;
  return (
    <span key={key}>
      {renderInline(text)}
      {id && (
        <>
          <RefundButton orderId={id} onRefund={onRefund!} disabled={disabled} />
          <ContactButton disabled={disabled} />
        </>
      )}
    </span>
  );
}

/** Minimal markdown: paragraphs, blank-line spacing, and "- "/"* " bullet lists. */
function renderMarkdown(text: string, onRefund?: (id: string) => void, disabled?: boolean): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`u${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-4">
          {bullets.map((b, i) => (
            <li key={i}>{line(b, `li${i}`, onRefund, disabled)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)/.exec(raw);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (raw.trim() === '') blocks.push(<div key={`s${blocks.length}`} className="h-2" />);
    else blocks.push(<p key={`p${blocks.length}`}>{line(raw, `p${blocks.length}`, onRefund, disabled)}</p>);
  }
  flush();
  return blocks;
}

export default function MessageBubble({
  role,
  text,
  onRefund,
  disabled,
}: {
  role: 'user' | 'assistant';
  text: string;
  /** Assistant only: render a Refund button next to any order id in the reply. */
  onRefund?: (orderId: string) => void;
  disabled?: boolean;
}) {
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
        {isUser ? (
          text
        ) : text ? (
          renderMarkdown(text, onRefund, disabled)
        ) : (
          <span className="caret text-slate-300" />
        )}
      </div>
    </div>
  );
}
