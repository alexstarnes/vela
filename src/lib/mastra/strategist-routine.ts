/**
 * Differentiation Strategist standing routine (completion plan §9).
 *
 * On its weekly cron the strategist scans each active project (with a goal)
 * for competitor moves, pricing shifts, adjacent monetization patterns, and
 * unexploited owned assets, and files findings as backlog tasks addressed to
 * the PRD Auditor.
 *
 * The known weakness — a stateless agent re-filing the same three ideas every
 * Monday — is countered with a rolling context: the routine injects its own
 * prior filings and an explicit instruction not to re-file them (§9 fix #1).
 */
import { z } from 'zod';
import { db } from '@/lib/db';
import { agents, projects, tasks, taskEvents } from '@/lib/db/schema';
import { and, desc, eq, like } from 'drizzle-orm';
import { logTaskEvent } from '@/lib/events/logger';
import { checkBudgetPrecondition, recordBudgetRun } from '@/lib/governance/budget';
import {
  extractJsonBlock,
  getRingAgentRow,
  invokeRingSeat,
  loadRingSkill,
  RING_ROLE_SKILL_BY_AGENT,
} from './workflows/steps/ring-shared';

export const STRATEGIST_AGENT_NAME = 'Differentiation Strategist';
const SURVEILLANCE_TITLE_PREFIX = 'Surveillance scan';

const surveillanceOutputSchema = z.object({
  nothing_new: z.boolean(),
  nothing_new_reason: z.string().optional(),
  findings: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      moat_relevance: z.string().min(1),
      suggested_action: z.string().min(1),
    }),
  ),
});

function isoWeekLabel(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Prior filings for the rolling do-not-refile context. */
async function loadPriorFilings(projectId: string, limit = 3) {
  const priorTasks = await db.query.tasks.findMany({
    where: and(
      eq(tasks.projectId, projectId),
      like(tasks.title, `${SURVEILLANCE_TITLE_PREFIX}%`),
    ),
    orderBy: [desc(tasks.createdAt)],
    limit,
  });

  const filings: Array<{ week: string; findings: unknown }> = [];
  for (const priorTask of priorTasks) {
    const events = await db.query.taskEvents.findMany({
      where: and(eq(taskEvents.taskId, priorTask.id), eq(taskEvents.eventType, 'ring_findings')),
      orderBy: [desc(taskEvents.createdAt)],
      limit: 1,
    });
    if (events[0]?.payload) {
      filings.push({ week: priorTask.title, findings: events[0].payload });
    }
  }
  return filings;
}

export interface StrategistRoutineResult {
  ran: boolean;
  reason?: string;
  scans: Array<{
    projectId: string;
    projectName: string;
    surveillanceTaskId?: string;
    skipped?: string;
    findingsFiled: number;
    nothingNew: boolean;
  }>;
}

/**
 * Run one surveillance pass. `weekLabel` is injectable so the three-week
 * verification can fake the clock instead of waiting three Mondays.
 */
export async function runStrategistRoutine(options?: {
  weekLabel?: string;
  /** Restrict the scan to specific projects (tests, targeted runs). */
  projectIds?: string[];
}): Promise<StrategistRoutineResult> {
  const week = options?.weekLabel ?? isoWeekLabel();
  const strategist = await getRingAgentRow(STRATEGIST_AGENT_NAME);

  const budget = await checkBudgetPrecondition(strategist.id);
  if (!budget.canProceed) {
    return { ran: false, reason: budget.reason, scans: [] };
  }

  const [prdAuditor, activeProjects, roleSkillMd] = await Promise.all([
    getRingAgentRow('PRD Auditor'),
    db.query.projects.findMany({ where: eq(projects.status, 'active') }),
    loadRingSkill(RING_ROLE_SKILL_BY_AGENT[STRATEGIST_AGENT_NAME], 'role'),
  ]);

  const result: StrategistRoutineResult = { ran: true, scans: [] };

  for (const project of activeProjects) {
    if (!project.goal) {
      continue; // No goal, nothing to strategize against.
    }
    if (options?.projectIds && !options.projectIds.includes(project.id)) {
      continue;
    }

    const title = `${SURVEILLANCE_TITLE_PREFIX} ${week} — ${project.name}`;
    const existing = await db.query.tasks.findFirst({
      where: and(eq(tasks.projectId, project.id), eq(tasks.title, title)),
    });
    if (existing) {
      result.scans.push({
        projectId: project.id,
        projectName: project.name,
        skipped: 'already scanned this week',
        findingsFiled: 0,
        nothingNew: false,
      });
      continue;
    }

    const priorFilings = await loadPriorFilings(project.id);

    const [surveillanceTask] = await db
      .insert(tasks)
      .values({
        title,
        description: `Standing weekly surveillance scan for "${project.name}". Findings are filed as backlog tasks addressed to the PRD Auditor.`,
        projectId: project.id,
        assignedAgentId: strategist.id,
        createdByAgentId: strategist.id,
        priority: 'low',
        status: 'in_progress',
      })
      .returning();

    await recordBudgetRun(strategist.id, surveillanceTask.id);

    const priorSection =
      priorFilings.length > 0
        ? [
            '## Your prior filings (rolling memory — DO NOT re-file these)',
            'You have already filed the findings below in previous weeks. Re-filing a prior',
            'finding, or a cosmetic rewording of one, is a failed scan. Either surface',
            'something genuinely new or say plainly that nothing new happened this week —',
            '"nothing_new": true is a respected answer and better than noise.',
            JSON.stringify(priorFilings, null, 2),
          ].join('\n')
        : '## Your prior filings\nNone — this is your first scan for this project.';

    const prompt = [
      `You are the ${STRATEGIST_AGENT_NAME} running your standing weekly surveillance routine (week ${week}).`,
      '',
      '## Your role and mandate',
      roleSkillMd,
      '',
      '## The product under surveillance',
      `Project: ${project.name}`,
      `Goal: ${project.goal}`,
      project.context ? `Context: ${project.context}` : '',
      '',
      priorSection,
      '',
      '## This scan',
      'Per your standing mandate (responsibility 7): scan for competitor moves that erode a moat,',
      'pricing shifts in the market, emerging monetization patterns in adjacent products, and',
      'unexploited assets this product already owns. You have no browsing tools — reason from',
      'your knowledge of the market and the product goal, label uncertainty honestly, and never',
      'fabricate market data.',
      '',
      '## Output format (mandatory)',
      'Return ONE fenced json code block:',
      '```json',
      '{',
      '  "nothing_new": false,',
      '  "nothing_new_reason": "<only when nothing_new is true>",',
      '  "findings": [',
      '    {',
      '      "title": "<short, specific — becomes a task title>",',
      '      "summary": "<what you observed or infer, with uncertainty labeled>",',
      '      "moat_relevance": "<which moat this erodes or builds, or \\"none identified\\">",',
      '      "suggested_action": "<the specific thing the PRD Auditor should pressure-test>"',
      '    }',
      '  ]',
      '}',
      '```',
      'File at most 3 findings. Fewer, sharper findings beat a list.',
    ]
      .filter((part) => part !== '')
      .join('\n');

    let findingsFiled = 0;
    let nothingNew = false;

    try {
      const seat = await invokeRingSeat({
        agentRow: strategist,
        prompt,
        taskId: surveillanceTask.id,
        stepId: 'strategist-surveillance',
      });

      const parsed = surveillanceOutputSchema.parse(extractJsonBlock(seat.text));
      nothingNew = parsed.nothing_new;

      await logTaskEvent({
        taskId: surveillanceTask.id,
        agentId: strategist.id,
        eventType: 'ring_findings',
        payload: {
          routine: 'strategist-surveillance',
          week,
          lane: seat.lane,
          model: seat.resolvedModelId,
          nothing_new: parsed.nothing_new,
          nothing_new_reason: parsed.nothing_new_reason ?? null,
          findings: parsed.findings,
        },
      });

      for (const finding of parsed.findings) {
        const [filed] = await db
          .insert(tasks)
          .values({
            title: finding.title.slice(0, 480),
            description: [
              finding.summary,
              '',
              `Moat relevance: ${finding.moat_relevance}`,
              `Suggested action: ${finding.suggested_action}`,
              '',
              `Filed by the ${STRATEGIST_AGENT_NAME} standing routine (week ${week}); addressed to the PRD Auditor.`,
            ].join('\n'),
            projectId: project.id,
            parentTaskId: surveillanceTask.id,
            assignedAgentId: prdAuditor.id,
            createdByAgentId: strategist.id,
            priority: 'low',
            status: 'backlog',
          })
          .returning({ id: tasks.id });
        findingsFiled += 1;

        await logTaskEvent({
          taskId: filed.id,
          agentId: strategist.id,
          eventType: 'status_change',
          payload: {
            from: null,
            to: 'backlog',
            reason: `Filed by strategist surveillance ${week}`,
          },
        });
      }

      await db
        .update(tasks)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(tasks.id, surveillanceTask.id));
      await logTaskEvent({
        taskId: surveillanceTask.id,
        agentId: strategist.id,
        eventType: 'status_change',
        payload: {
          from: 'in_progress',
          to: 'done',
          reason: `Surveillance complete: ${findingsFiled} finding(s) filed${nothingNew ? ' (nothing new)' : ''}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logTaskEvent({
        taskId: surveillanceTask.id,
        agentId: strategist.id,
        eventType: 'error',
        payload: { message: `Surveillance scan failed: ${message}` },
      });
      await db
        .update(tasks)
        .set({ status: 'blocked', updatedAt: new Date() })
        .where(eq(tasks.id, surveillanceTask.id));
    }

    result.scans.push({
      projectId: project.id,
      projectName: project.name,
      surveillanceTaskId: surveillanceTask.id,
      findingsFiled,
      nothingNew,
    });
  }

  return result;
}
