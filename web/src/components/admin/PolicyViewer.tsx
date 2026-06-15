import { useEffect, useState } from 'react';
import { getPolicy } from '../../lib/api';

export default function PolicyViewer() {
  const [text, setText] = useState('');

  useEffect(() => {
    getPolicy().then(setText).catch(() => setText('Could not load policy.'));
  }, []);

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-slate-700">{text}</pre>
    </div>
  );
}
