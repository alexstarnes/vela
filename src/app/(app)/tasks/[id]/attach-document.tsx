'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Upload } from 'lucide-react';
import { attachDocument } from '@/lib/actions/documents';

export function AttachDocument({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('prd');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setContent(await file.text());
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const result = await attachDocument({ taskId, key: key.trim(), contentMd: content });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setContent('');
      router.refresh();
    } catch {
      setError('Failed to attach document');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
        style={{ background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)', color: 'var(--stone-400)' }}
      >
        <FilePlus2 size={11} />
        Attach document
      </button>
    );
  }

  return (
    <div
      className="rounded-md p-2.5 space-y-2"
      style={{ background: 'var(--dark-surface2)', border: '1px solid var(--dark-border)' }}
    >
      <div>
        <label className="block text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--stone-500)' }}>
          Key
        </label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full text-[11px] font-mono px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-amber-500"
          style={{ background: 'var(--dark-bg)', border: '1px solid var(--dark-border)', color: '#ECEAE4' }}
          placeholder="prd"
        />
        <p className="mt-1 text-[9px] leading-4" style={{ color: 'var(--stone-500)' }}>
          Key <span className="font-mono" style={{ color: '#F5A623' }}>prd</span> routes this task
          through the critique ring on its next heartbeat.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[9px] font-mono uppercase tracking-wider" style={{ color: 'var(--stone-500)' }}>
            Markdown
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 text-[9px] font-mono"
            style={{ color: '#F5A623' }}
          >
            <Upload size={9} />
            Load .md file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="w-full text-[11px] font-mono px-2 py-1.5 rounded resize-y focus:outline-none focus:ring-1 focus:ring-amber-500"
          style={{ background: 'var(--dark-bg)', border: '1px solid var(--dark-border)', color: '#ECEAE4' }}
          placeholder="# Product Requirements&#10;&#10;Paste markdown here, or load a file."
        />
        {content.length > 0 && (
          <p className="text-[9px] font-mono" style={{ color: 'var(--stone-600)' }}>
            {content.length.toLocaleString()} chars
          </p>
        )}
      </div>
      {error && (
        <p className="text-[10px]" style={{ color: '#C4413A' }}>
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={handleSubmit}
          disabled={busy || content.trim().length === 0}
          className="text-[10px] font-mono px-2 py-1 rounded disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
          style={{ background: '#3D8B5C20', color: '#3D8B5C' }}
        >
          {busy ? 'Attaching…' : 'Attach revision'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="text-[10px] font-mono px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-stone-500"
          style={{ background: 'var(--dark-bg)', color: 'var(--stone-500)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
