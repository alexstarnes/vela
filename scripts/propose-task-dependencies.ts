/**
 * Retro-fit dependency ordering onto a backlog that was created flat.
 *
 * Backlogs approved before ordering existed have no edges, so every story is
 * eligible immediately and a dependent one can run first against a skeleton.
 * This is a one-shot pass: a single premium CLI call reads the open children
 * and proposes edges, which are written and then reviewed by the operator in
 * the project flight view (each chip has a delete control). Nothing here runs
 * a task or changes a status — proposing ordering is not executing work.
 *
 *   npx tsx scripts/propose-task-dependencies.ts --project <project-id>
 *   npx tsx scripts/propose-task-dependencies.ts --parent  <prd-task-id>
 *   ...add --dry-run to print the proposal without writing edges.
 *
 * Review the resulting graph in the flight view before enabling any cron.
 */
import '../tests/governance/load-env';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { executeCliTask } from '@/lib/helper/client';
import {
  createTaskDependencies,
  getProjectDependencyLinks,
  normalizeBacklogDependencies,
} from '@/lib/tasks/dependencies';
import { logTaskEvent } from '@/lib/events/logger';

/** Statuses worth ordering — finished work imposes no constraint. */
const ORDERABLE_STATUSES = ['open', 'backlog', 'blocked'];
const CLI_MODEL = process.env.VELA_DEPENDENCY_CLI_MODEL ?? 'opus';
const CLI_TIMEOUT_MS = 6 * 60 * 1000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function buildPrompt(stories: Array<{ title: string; description: string | null }>): string {
  const list = stories
    .map(
      (story, index) =>
        `${index}. ${story.title}\n   ${(story.description ?? '').replace(/\s+/g, ' ').slice(0, 500)}`,
    )
    .join('\n');

  return [
    'You are ordering a backlog for a single builder who works one story at a time.',
    '',
    'Below are the queued stories, each with its index. Decide which stories must land',
    'before which others. A story depends on another only when it would be impossible or',
    'pointless to build first — it needs code, data, or a surface the other story creates.',
    'Shared subject matter is NOT a dependency. Most stories should have 0-2 prerequisites,',
    'and many should have none.',
    '',
    '## Stories',
    list,
    '',
    '## Output format (mandatory)',
    '',
    'Return ONE fenced json code block and nothing else after it:',
    '',
    '```json',
    '{',
    '  "dependencies": [',
    '    { "index": <story index>, "depends_on": [<indices that must land first>], "reason": "<one sentence>" }',
    '  ]',
    '}',
    '```',
    '',
    'Omit stories with no prerequisites rather than listing them with an empty array.',
    'Indices must be valid positions in the list above. Never propose a cycle.',
  ].join('\n');
}

function parseProposal(text: string): Array<{ index: number; depends_on: number[]; reason?: string }> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object found in the CLI response:\n${text.slice(0, 800)}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    dependencies?: Array<{ index?: number; depends_on?: number[]; reason?: string }>;
  };
  return (parsed.dependencies ?? [])
    .filter((entry) => Number.isInteger(entry.index))
    .map((entry) => ({
      index: Number(entry.index),
      depends_on: Array.isArray(entry.depends_on) ? entry.depends_on.map(Number) : [],
      reason: entry.reason,
    }));
}

async function main() {
  const projectId = arg('project');
  const parentTaskId = arg('parent');
  const dryRun = process.argv.includes('--dry-run');

  if (!projectId && !parentTaskId) {
    console.error('Pass --project <project-id> or --parent <prd-task-id>.');
    process.exit(1);
  }

  const where = projectId
    ? and(eq(tasks.projectId, projectId), inArray(tasks.status, ORDERABLE_STATUSES))
    : and(eq(tasks.parentTaskId, parentTaskId!), inArray(tasks.status, ORDERABLE_STATUSES));

  const stories = await db.query.tasks.findMany({
    where,
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    columns: { id: true, title: true, description: true, projectId: true },
  });

  if (stories.length < 2) {
    console.log(`Only ${stories.length} orderable task(s) found — nothing to order.`);
    process.exit(0);
  }

  const resolvedProjectId = projectId ?? stories[0].projectId;
  const existing = await getProjectDependencyLinks(resolvedProjectId);
  const alreadyOrdered = new Set(existing.map((link) => `${link.taskId}->${link.dependsOnTaskId}`));

  console.log(`Proposing dependencies for ${stories.length} task(s)...`);
  stories.forEach((story, index) => console.log(`  ${index}. ${story.title}`));

  const result = await executeCliTask({
    // No workspacePath: this is a completion-shaped call, the CLI has no repo
    // to wander into.
    cli: 'claude',
    prompt: buildPrompt(stories),
    model: CLI_MODEL,
    maxTurns: 4,
    timeoutMs: CLI_TIMEOUT_MS,
    allowedTools: [],
    permissionMode: 'default',
  });

  if (!result.ok || !result.resultText.trim()) {
    console.error(`CLI call failed (${result.errorKind ?? 'no output'}):`);
    console.error(result.rawOutput.slice(-2000));
    process.exit(1);
  }

  const proposal = parseProposal(result.resultText);

  // Reuse the same validation the approval path uses: out-of-range indices,
  // self-references and cycles are pruned, never fatal.
  const asBacklog = stories.map((story, index) => ({
    title: story.title,
    depends_on: proposal.find((entry) => entry.index === index)?.depends_on ?? [],
  }));
  const { edges, warnings } = normalizeBacklogDependencies(asBacklog);

  const reasonByIndex = new Map(proposal.map((entry) => [entry.index, entry.reason]));
  console.log(`\nProposed ${edges.length} edge(s):`);
  for (const edge of edges) {
    const suffix = alreadyOrdered.has(`${stories[edge.index].id}->${stories[edge.dependsOnIndex].id}`)
      ? ' [already recorded]'
      : '';
    console.log(
      `  "${stories[edge.index].title}" after "${stories[edge.dependsOnIndex].title}"${suffix}` +
        (reasonByIndex.get(edge.index) ? `\n      ${reasonByIndex.get(edge.index)}` : ''),
    );
  }
  for (const warning of warnings) console.log(`  WARNING ${warning}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written.');
    process.exit(0);
  }

  const written = await createTaskDependencies(
    edges.map((edge) => ({
      taskId: stories[edge.index].id,
      dependsOnTaskId: stories[edge.dependsOnIndex].id,
    })),
  );

  if (parentTaskId) {
    await logTaskEvent({
      taskId: parentTaskId,
      eventType: 'dependency_graph',
      payload: {
        action: 'retrofit',
        source: `cli:${CLI_MODEL}`,
        edges_proposed: edges.length,
        edges_written: written,
        warnings,
      },
    });
  }

  console.log(
    `\nWrote ${written} new edge(s). Review the graph in the project flight view and delete any ` +
      'edge that looks wrong before enabling a cron.',
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
