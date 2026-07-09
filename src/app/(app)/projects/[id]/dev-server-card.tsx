'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Play, Square } from 'lucide-react';

interface DevServerStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  exitCode: number | null;
  recentOutput: string[];
  error?: string;
}

/**
 * Start/stop control for the project's dev server, managed by vela-helper.
 * The localhost link only resolves when this browser runs on the same
 * machine as the helper — which is the primary sitting-at-my-desk use case.
 */
export function DevServerCard({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<DevServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/dev-server`, { cache: 'no-store' });
      const data = (await res.json()) as DevServerStatus & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Helper unreachable');
        setStatus(null);
        return;
      }
      setError(null);
      setStatus(data);
    } catch {
      setError('Helper unreachable');
      setStatus(null);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const act = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/dev-server`, { method });
      const data = (await res.json()) as DevServerStatus & { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Request failed');
      }
    } catch {
      setError('Request failed');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const running = status?.running ?? false;

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--stone-500)' }}>
          Dev Server
        </p>
        <span
          className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full"
          style={{
            background: running ? '#3D8B5C20' : 'var(--dark-surface2)',
            color: running ? '#3D8B5C' : 'var(--stone-500)',
          }}
        >
          {running ? `running${status?.port ? ` :${status.port}` : ''}` : 'stopped'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {running ? (
          <button
            onClick={() => act('DELETE')}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-md disabled:opacity-50"
            style={{ background: '#C4413A20', color: '#C4413A', border: '1px solid #C4413A40' }}
          >
            <Square size={11} strokeWidth={2} />
            Stop
          </button>
        ) : (
          <button
            onClick={() => act('POST')}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-md disabled:opacity-50"
            style={{ background: '#3D8B5C20', color: '#3D8B5C', border: '1px solid #3D8B5C40' }}
          >
            <Play size={11} strokeWidth={2} />
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}

        {running && status?.port && (
          <a
            href={`http://localhost:${status.port}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-md"
            style={{ background: '#F5A62320', color: '#F5A623', border: '1px solid #F5A62340' }}
          >
            <ExternalLink size={11} strokeWidth={2} />
            Open localhost:{status.port}
          </a>
        )}
      </div>

      {running && (
        <p className="text-[10px]" style={{ color: 'var(--stone-500)' }}>
          The link opens on the machine running vela-helper — it won&apos;t resolve from another
          device.
        </p>
      )}

      {error && (
        <p className="text-[11px]" style={{ color: '#C4413A' }}>
          {error}
        </p>
      )}

      {status?.recentOutput && status.recentOutput.length > 0 && (
        <pre
          className="text-[10px] font-mono p-2 rounded-md overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap"
          style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
        >
          {status.recentOutput.join('\n')}
        </pre>
      )}
    </div>
  );
}
