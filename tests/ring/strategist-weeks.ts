/**
 * VERIFY 6 — the strategist routine does not repeat itself by week three.
 *
 * Runs the standing surveillance routine three times with faked week labels
 * against the Clipper project. Asserts: each week fires and files tasks
 * addressed to the PRD Auditor, and week 3's findings are not a restatement
 * of week 1's (title-level overlap must stay under 50%).
 *
 * Run: npx tsx tests/ring/strategist-weeks.ts
 */
import '../governance/load-env';
import { db, tasks, taskEvents, eq, evidence } from '../governance/util';
import { runStrategistRoutine } from '@/lib/mastra/strategist-routine';
import { projects } from '@/lib/db/schema';

function normalizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let matched = 0;
  for (const titleA of a) {
    const wordsA = normalizeTitle(titleA);
    for (const titleB of b) {
      const wordsB = normalizeTitle(titleB);
      const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
      const denom = Math.min(wordsA.size, wordsB.size) || 1;
      if (shared / denom >= 0.6) {
        matched += 1;
        break;
      }
    }
  }
  return matched / a.length;
}

async function ensureClipperProject(): Promise<string> {
  const existing = await db.query.projects.findFirst({
    where: (p, { eq: eqOp }) => eqOp(p.name, 'Clipper'),
  });
  if (existing) return existing.id;
  const [row] = await db
    .insert(projects)
    .values({
      name: 'Clipper',
      goal:
        'Become the default read-later app for researchers: win on recall (finding the right saved thing at the right moment), not on saving, which is commodity.',
      context:
        'Consumer bookmarking / read-later app. Competitors: Pocket (sunset), Instapaper, Readwise Reader, Raindrop. Solo-dev budget; distribution via researcher communities.',
      sourceType: 'manual',
      connectionStatus: 'connected',
      workspacePath: '/Users/starnescreative/Desktop/vela-clones/clipper',
      status: 'active',
    })
    .returning({ id: projects.id });
  return row.id;
}

async function main() {
  const projectId = await ensureClipperProject();
  const weeks = ['2098-W01', '2098-W02', '2098-W03'];
  const weekFindings: Record<string, { titles: string[]; nothingNew: boolean; filedTaskIds: string[] }> = {};

  const createdSurveillanceTasks: string[] = [];
  try {
    for (const week of weeks) {
      const result = await runStrategistRoutine({ weekLabel: week, projectIds: [projectId] });
      if (!result.ran) throw new Error(`Routine did not run for ${week}: ${result.reason}`);
      const scan = result.scans.find((s) => s.projectId === projectId);
      if (!scan?.surveillanceTaskId) throw new Error(`No scan for Clipper in ${week}`);
      createdSurveillanceTasks.push(scan.surveillanceTaskId);

      const filed = await db.query.tasks.findMany({
        where: eq(tasks.parentTaskId, scan.surveillanceTaskId),
      });
      weekFindings[week] = {
        titles: filed.map((t) => t.title),
        nothingNew: scan.nothingNew,
        filedTaskIds: filed.map((t) => t.id),
      };
      console.log(`${week}: filed=${filed.length} nothingNew=${scan.nothingNew} titles=${JSON.stringify(filed.map((t) => t.title))}`);
    }

    const w1 = weekFindings[weeks[0]];
    const w3 = weekFindings[weeks[2]];
    const ratio = overlapRatio(w3.titles, w1.titles);

    // Filed tasks must be addressed to the PRD Auditor.
    const prdAuditor = await db.query.agents.findFirst({
      where: (a, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(a.name, 'PRD Auditor'), eqOp(a.agentKind, 'runtime')),
    });
    let allAddressedCorrectly = true;
    for (const week of weeks) {
      for (const id of weekFindings[week].filedTaskIds) {
        const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
        if (row?.assignedAgentId !== prdAuditor!.id || row?.status !== 'backlog') {
          allAddressedCorrectly = false;
        }
      }
    }

    evidence('strategist-weeks', {
      weeks: weekFindings,
      week3_vs_week1_overlap: ratio,
      all_findings_addressed_to_prd_auditor_as_backlog: allAddressedCorrectly,
    });

    const week1Fired = w1.titles.length > 0 || w1.nothingNew;
    const week3Distinct = w3.nothingNew || ratio < 0.5;
    const pass = week1Fired && week3Distinct && allAddressedCorrectly;
    console.log(
      pass
        ? `PASS: routine fires, files to PRD Auditor, and week 3 is not a restatement (overlap ${(ratio * 100).toFixed(0)}%)`
        : `FAIL: overlap ${(ratio * 100).toFixed(0)}% or misaddressed filings — rolling context insufficient`,
    );
    process.exitCode = pass ? 0 : 1;
  } finally {
    // Clean up: cancel filed + surveillance tasks from the fake weeks.
    for (const week of Object.keys(weekFindings)) {
      for (const id of weekFindings[week].filedTaskIds) {
        await db.delete(taskEvents).where(eq(taskEvents.taskId, id));
        await db.delete(tasks).where(eq(tasks.id, id));
      }
    }
    for (const id of createdSurveillanceTasks) {
      await db.delete(taskEvents).where(eq(taskEvents.taskId, id));
      await db.delete(tasks).where(eq(tasks.id, id));
    }
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
