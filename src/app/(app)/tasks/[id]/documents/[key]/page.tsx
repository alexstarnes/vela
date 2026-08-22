export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getTask } from '@/lib/actions/tasks';
import { listDocumentRevisions } from '@/lib/documents';
import { MarkdownDocument } from '@/components/document-viewer/markdown-document';
import { diffLines, diffCounts, collapseUnchangedRuns, type DiffOp } from '@/lib/documents/diff';

function diffRowStyle(type: DiffOp['type']): { background: string; color: string; opacity: number } {
  if (type === 'add') return { background: 'rgba(61,139,92,0.14)', color: '#8FCBA4', opacity: 1 };
  if (type === 'del') return { background: 'rgba(196,65,58,0.14)', color: '#E09A94', opacity: 1 };
  return { background: 'transparent', color: 'var(--stone-400)', opacity: 0.55 };
}

function gutterSymbol(type: DiffOp['type']): string {
  if (type === 'add') return '+';
  if (type === 'del') return '−';
  return '';
}

export default async function TaskDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; key: string }>;
  searchParams: Promise<{ rev?: string }>;
}) {
  const { id, key } = await params;
  const { rev } = await searchParams;

  const [task, revisions] = await Promise.all([getTask(id), listDocumentRevisions(id, key)]);
  if (!task || revisions.length === 0) notFound();

  // revisions arrive newest-first
  const latest = revisions[0];
  const requested = rev ? Number.parseInt(rev, 10) : latest.revision;
  const selected = revisions.find((r) => r.revision === requested) ?? latest;
  const previous = revisions.find((r) => r.revision === selected.revision - 1) ?? null;
  const diffOps = previous ? diffLines(previous.contentMd, selected.contentMd) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--dark-border)' }}>
        <div className="flex items-center gap-1 mb-1.5">
          <Link href={`/tasks/${task.id}`} style={{ color: 'var(--stone-500)' }}>
            <ChevronLeft size={14} strokeWidth={1.5} />
          </Link>
          <p className="text-xs font-mono" style={{ color: 'var(--stone-500)' }}>
            Tasks / {task.project?.name ?? 'Unknown'} / {task.id.slice(0, 8)} / documents / {key}
          </p>
        </div>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-lg font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
            {task.title} — {key.toUpperCase()} document
          </h1>
          <div className="flex items-center gap-1.5">
            {revisions
              .slice()
              .reverse()
              .map((r) => {
                const active = r.revision === selected.revision;
                return (
                  <Link
                    key={r.revision}
                    href={`/tasks/${task.id}/documents/${key}?rev=${r.revision}`}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: active ? '#F5A62320' : 'var(--dark-surface2)',
                      color: active ? '#F5A623' : 'var(--stone-500)',
                      border: `1px solid ${active ? '#F5A62345' : 'var(--dark-border)'}`,
                    }}
                  >
                    rev {r.revision}
                  </Link>
                );
              })}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] font-mono" style={{ color: 'var(--stone-500)' }}>
          Revision {selected.revision} of {latest.revision} ·{' '}
          {selected.createdByAgentId ? 'agent-authored' : 'attached by operator'}{' '}
          · {new Date(selected.createdAt).toLocaleString()} ·{' '}
          {selected.contentMd.length.toLocaleString()} chars
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-8">
          {diffOps && previous && (
            <details className="group">
              <summary
                className="text-[9px] font-mono uppercase tracking-wider cursor-pointer select-none list-none flex items-center gap-1.5"
                style={{ color: 'var(--stone-500)' }}
              >
                <span className="group-open:rotate-90 inline-block transition-transform">▸</span>
                {(() => {
                  const { added, removed } = diffCounts(diffOps);
                  return (
                    <>
                      Changes vs revision {previous.revision} ·{' '}
                      <span style={{ color: '#8FCBA4' }}>+{added}</span>{' '}
                      <span style={{ color: '#E09A94' }}>&minus;{removed}</span> lines
                    </>
                  );
                })()}
              </summary>
              <div
                className="overflow-x-auto rounded-lg border font-mono text-[11px] leading-5 mt-2"
                style={{ borderColor: 'var(--dark-border)' }}
              >
                {collapseUnchangedRuns(diffOps, 8).map((row) =>
                  row.kind === 'collapsed' ? (
                    <div
                      key={row.key}
                      className="px-3 py-1 text-center text-[10px]"
                      style={{ background: 'var(--dark-surface2)', color: 'var(--stone-600)' }}
                    >
                      ⋯ {row.count} unchanged lines
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      className="flex"
                      style={{ background: diffRowStyle(row.op.type).background }}
                    >
                      <span
                        className="w-5 shrink-0 text-center select-none"
                        style={{ color: diffRowStyle(row.op.type).color }}
                      >
                        {gutterSymbol(row.op.type)}
                      </span>
                      <span
                        className="whitespace-pre px-1"
                        style={{
                          color: diffRowStyle(row.op.type).color,
                          opacity: diffRowStyle(row.op.type).opacity,
                        }}
                      >
                        {row.op.text || ' '}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </details>
          )}

          <MarkdownDocument
            markdown={selected.contentMd}
            sourceLabel={`documents key=${key} revision=${selected.revision}`}
            badgeLabel="Task document"
            descriptionOverride={`Revision ${selected.revision} of the '${key}' document attached to this task. Revisions are append-only — every version stays in the history above.`}
          />
        </div>
      </div>
    </div>
  );
}
