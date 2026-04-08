export const dynamic = 'force-dynamic';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { notFound } from 'next/navigation';
import { MarkdownDocument } from '@/components/document-viewer/markdown-document';

const SOURCE_PATH = path.join(process.cwd(), 'support', 'AGENT_ORCHESTRATION_V2.md');

export default async function OrchestrationModelPage() {
  try {
    const markdown = await readFile(SOURCE_PATH, 'utf8');

    return (
      <div
        className="min-h-full px-4 py-6 md:px-6 lg:px-8"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(245,166,35,0.18), transparent 26%), radial-gradient(circle at top right, rgba(255,255,255,0.05), transparent 24%), linear-gradient(180deg, #111110 0%, #0F0E0D 100%)',
        }}
      >
        <div className="mx-auto max-w-7xl">
          <MarkdownDocument
            markdown={markdown}
            sourceLabel="support/AGENT_ORCHESTRATION_V2.md"
          />
        </div>
      </div>
    );
  } catch {
    notFound();
  }
}

