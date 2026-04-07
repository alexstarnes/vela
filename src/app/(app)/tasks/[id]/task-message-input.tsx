'use client';

import { useState, useTransition } from 'react';
import { addTaskMessage } from '@/lib/actions/tasks';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';

interface Props {
  taskId: string;
}

export function TaskMessageInput({ taskId }: Props) {
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSend() {
    if (!message.trim()) return;

    startTransition(async () => {
      await addTaskMessage({ taskId, content: message.trim(), role: 'user' });
      setMessage('');
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  }

  return (
    <div
      className="p-3 flex gap-2"
      style={{ borderTop: '1px solid var(--dark-border)', background: 'var(--dark-surface2)' }}
    >
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a note or respond to agent... (Cmd+Enter to send)"
        className="flex-1 text-[11px] px-3 py-2 rounded-md outline-none"
        style={{
          border: '1px solid var(--dark-border)',
          background: 'var(--dark-surface)',
          color: '#ECEAE4',
        }}
        disabled={isPending}
      />
      <button
        onClick={handleSend}
        disabled={isPending || !message.trim()}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono"
        style={{
          background: message.trim() ? '#F5A623' : 'var(--dark-surface2)',
          color: message.trim() ? '#fff' : 'var(--stone-600)',
          opacity: isPending ? 0.6 : 1,
        }}
      >
        <Send size={12} strokeWidth={1.5} />
        Send
      </button>
    </div>
  );
}
