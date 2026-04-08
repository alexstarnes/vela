type TocEntry = {
  id: string;
  level: 1 | 2 | 3;
  title: string;
};

type Block =
  | { type: 'heading'; level: 1 | 2 | 3; title: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' }
  | { type: 'code'; language: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return slug || 'section';
}

function formatInline(text: string): string {
  const codeTokens: string[] = [];

  const tokenized = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const tokenIndex = codeTokens.length;
    codeTokens.push(`<code class="rounded px-1.5 py-0.5 text-[0.78em] font-mono bg-white/6 text-[#ECEAE4] border border-white/10">${escapeHtml(code)}</code>`);
    return `\u0000${tokenIndex}\u0000`;
  });

  let html = escapeHtml(tokenized);

  html = html.replace(
    /\*\*([\s\S]+?)\*\*/g,
    '<strong class="font-semibold text-[#ECEAE4]">$1</strong>'
  );

  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a class="text-[#F5A623] underline underline-offset-2 decoration-white/20 hover:decoration-[#F5A623]" href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  );

  html = html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => codeTokens[Number(index)] ?? '');

  return html;
}

function isSeparatorLine(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isListItem(line: string): boolean {
  return /^\s*(?:-|\*|\+|\d+\.)\s+/.test(line);
}

function parseTableCellLine(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((part) => part.trim());
}

function parseMarkdown(markdown: string): { blocks: Block[]; toc: TocEntry[] } {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  const toc: TocEntry[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      const title = headingMatch[2].trim();
      const id = slugify(title);
      blocks.push({ type: 'heading', level, title, id });
      toc.push({ id, level, title });
      index += 1;
      continue;
    }

    if (/^(---|\*\*\*)$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    if (index + 1 < lines.length && parseTableCellLine(line).length > 1 && isSeparatorLine(lines[index + 1])) {
      const headers = parseTableCellLine(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        rows.push(parseTableCellLine(lines[index]));
        index += 1;
      }

      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (isListItem(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current) break;

        const currentOrdered = /^\d+\.\s+/.test(current);
        const currentUnordered = /^[-*+]\s+/.test(current);
        if (ordered ? !currentOrdered : !currentUnordered) break;

        items.push(current.replace(/^\s*(?:-|\*|\+|\d+\.)\s+/, ''));
        index += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;

    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      const startsBlock =
        !nextTrimmed ||
        nextTrimmed.startsWith('```') ||
        /^#{1,3}\s+/.test(nextTrimmed) ||
        /^---$/.test(nextTrimmed) ||
        /^\*\*\*$/.test(nextTrimmed) ||
        nextTrimmed.startsWith('>') ||
        isListItem(nextTrimmed) ||
        (index + 1 < lines.length && parseTableCellLine(next).length > 1 && isSeparatorLine(lines[index + 1]));

      if (startsBlock) break;

      paragraphLines.push(nextTrimmed);
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return { blocks, toc };
}

function headingClasses(level: 1 | 2 | 3): string {
  switch (level) {
    case 1:
      return 'text-3xl md:text-4xl font-semibold tracking-tight text-[#ECEAE4]';
    case 2:
      return 'text-xl md:text-2xl font-semibold tracking-tight text-[#ECEAE4]';
    case 3:
      return 'text-lg font-semibold text-[#ECEAE4]';
  }
}

export function MarkdownDocument({
  markdown,
  sourceLabel,
}: {
  markdown: string;
  sourceLabel: string;
}) {
  const { blocks, toc } = parseMarkdown(markdown);
  const title = blocks.find((block): block is Extract<Block, { type: 'heading' }> => block.type === 'heading' && block.level === 1)?.title ?? sourceLabel;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        <div
          className="rounded-3xl border p-6 md:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.25)]"
          style={{
            background: 'linear-gradient(180deg, rgba(26,25,24,0.96) 0%, rgba(15,14,13,0.98) 100%)',
            borderColor: 'var(--dark-border)',
          }}
        >
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-[#F5A623] border-[#F5A62333] bg-[#F5A62312]">
              Protected deep link
            </span>
            <span className="rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.24em] text-[#B8B4A8] border-white/10 bg-white/4">
              Markdown preview
            </span>
          </div>

          <h1 className="max-w-4xl text-balance text-3xl md:text-5xl font-semibold tracking-tight text-[#ECEAE4]">
            {title}
          </h1>

          <p className="mt-4 max-w-3xl text-sm md:text-base leading-7 text-[#B8B4A8]">
            Rendered directly from <span className="font-mono text-[#ECEAE4]">{sourceLabel}</span> for a richer document view without adding it to primary navigation.
          </p>
        </div>

        <article
          className="mt-6 rounded-3xl border p-6 md:p-8"
          style={{
            background: 'rgba(26,25,24,0.74)',
            borderColor: 'var(--dark-border)',
          }}
        >
          <div className="space-y-8">
            {blocks.map((block, blockIndex) => {
              if (blockIndex === 0 && block.type === 'heading' && block.level === 1) {
                return null;
              }

              if (block.type === 'heading') {
                return (
                  <section key={`${block.id}-${blockIndex}`} id={block.id} className="scroll-mt-24 space-y-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#8E897B] border-white/8 bg-white/3"
                      >
                        H{block.level}
                      </span>
                      <div className="h-px flex-1 bg-white/6" />
                    </div>
                    <h2 className={headingClasses(block.level)}>{block.title}</h2>
                  </section>
                );
              }

              if (block.type === 'paragraph') {
                return (
                  <p
                    key={blockIndex}
                    className="text-sm md:text-[0.97rem] leading-7 text-[#B8B4A8]"
                    dangerouslySetInnerHTML={{ __html: formatInline(block.text) }}
                  />
                );
              }

              if (block.type === 'blockquote') {
                return (
                  <blockquote
                    key={blockIndex}
                    className="rounded-2xl border-l-2 border-[#F5A623] bg-[#F5A62310] px-5 py-4 text-sm leading-7 text-[#D8D5CC]"
                  >
                    <div
                      className="space-y-2"
                      dangerouslySetInnerHTML={{
                        __html: block.lines.map((line) => formatInline(line)).join('<br/>'),
                      }}
                    />
                  </blockquote>
                );
              }

              if (block.type === 'hr') {
                return <hr key={blockIndex} className="border-white/8" />;
              }

              if (block.type === 'code') {
                return (
                  <section key={blockIndex} className="space-y-3">
                    {block.language ? (
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.24em] text-[#8E897B]">
                        <span>Code</span>
                        <span>{block.language}</span>
                      </div>
                    ) : null}
                    <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-[#0F0E0D] p-4 text-[12px] leading-6 text-[#ECEAE4]">
                      <code>{block.code}</code>
                    </pre>
                  </section>
                );
              }

              if (block.type === 'list') {
                const ListTag = block.ordered ? 'ol' : 'ul';

                return (
                  <ListTag
                    key={blockIndex}
                    className={`space-y-3 pl-6 text-sm leading-7 text-[#B8B4A8] ${block.ordered ? 'list-decimal' : 'list-disc'}`}
                  >
                    {block.items.map((item, itemIndex) => (
                      <li
                        key={`${blockIndex}-${itemIndex}`}
                        dangerouslySetInnerHTML={{ __html: formatInline(item) }}
                      />
                    ))}
                  </ListTag>
                );
              }

              if (block.type === 'table') {
                return (
                  <div key={blockIndex} className="overflow-x-auto rounded-2xl border border-white/8 bg-white/[0.03]">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="bg-white/[0.04] text-[#ECEAE4]">
                        <tr>
                          {block.headers.map((header, headerIndex) => (
                            <th
                              key={`${blockIndex}-head-${headerIndex}`}
                              className="border-b border-white/8 px-4 py-3 font-semibold"
                              dangerouslySetInnerHTML={{ __html: formatInline(header) }}
                            />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rowIndex) => (
                          <tr key={`${blockIndex}-row-${rowIndex}`} className="odd:bg-white/[0.015]">
                            {row.map((cell, cellIndex) => (
                              <td
                                key={`${blockIndex}-cell-${rowIndex}-${cellIndex}`}
                                className="border-b border-white/6 px-4 py-3 align-top text-[#B8B4A8]"
                                dangerouslySetInnerHTML={{ __html: formatInline(cell) }}
                              />
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              return null;
            })}
          </div>
        </article>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div
          className="rounded-2xl border p-5"
          style={{
            background: 'rgba(26,25,24,0.84)',
            borderColor: 'var(--dark-border)',
          }}
        >
          <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-[#8E897B]">
            Table of contents
          </p>
          <nav className="mt-4 space-y-1.5">
            {toc.map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-white/[0.05]"
                style={{
                  paddingLeft: `${12 + (entry.level - 1) * 10}px`,
                  color: entry.level === 1 ? '#ECEAE4' : entry.level === 2 ? '#D8D5CC' : '#B8B4A8',
                }}
              >
                {entry.title}
              </a>
            ))}
          </nav>
        </div>
      </aside>
    </div>
  );
}
