'use client';

import { useState } from 'react';
import { Play, Loader } from 'lucide-react';

interface RunNowButtonProps {
  agentId: string;
  agentName: string;
}

export function RunNowButton({ agentId, agentName }: RunNowButtonProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleClick = async () => {
    setLoading(true);
    setStatus('idle');
    try {
      const res = await fetch(`/api/heartbeat?agentId=${agentId}`, { method: 'POST' });
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setLoading(false);
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const bg =
    status === 'success' ? '#3D8B5C20' :
    status === 'error' ? '#C4413A20' :
    'var(--dark-surface2)';

  const fg =
    status === 'success' ? '#3D8B5C' :
    status === 'error' ? '#C4413A' :
    'var(--stone-400)';

  const label =
    status === 'success' ? 'Done' :
    status === 'error' ? 'Error' :
    'Run Now';

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={`Run heartbeat for ${agentName}`}
      className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 focus:ring-offset-[var(--dark-bg)] disabled:opacity-50 transition-colors"
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${status === 'idle' ? 'var(--dark-border)' : fg + '40'}`,
      }}
    >
      {loading ? (
        <Loader size={9} strokeWidth={1.5} className="animate-spin" />
      ) : (
        <Play size={9} strokeWidth={1.5} />
      )}
      {label}
    </button>
  );
}
