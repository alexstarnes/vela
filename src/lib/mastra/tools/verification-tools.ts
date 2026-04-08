import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { readWorkspaceFile, runWorkspaceCommand } from '@/lib/helper/client';
import type { ToolContext } from '../agent-factory';

export const verificationGateSchema = z.enum([
  'lint',
  'typecheck',
  'tests',
  'build',
  'security_audit',
]);

export const verificationGateResultSchema = z.object({
  gate: verificationGateSchema,
  status: z.enum(['passed', 'failed', 'skipped']),
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});

export type VerificationGate = z.infer<typeof verificationGateSchema>;
export type VerificationGateResult = z.infer<typeof verificationGateResultSchema>;

export interface VerificationSequenceOptions {
  includeTests?: boolean;
  includeBuild?: boolean;
  includeSecurityAudit?: boolean;
  stopOnFailure?: boolean;
}

async function getWorkspacePath(projectId: string): Promise<string> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project?.workspacePath) {
    throw new Error('This project does not have a connected workspace');
  }

  return project.workspacePath;
}

async function readPackageScripts(projectId: string): Promise<Record<string, string>> {
  const workspacePath = await getWorkspacePath(projectId);

  try {
    const { content } = await readWorkspaceFile({
      workspacePath,
      relativePath: 'package.json',
    });
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

async function runCommand(
  projectId: string,
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const workspacePath = await getWorkspacePath(projectId);
  return runWorkspaceCommand({ workspacePath, command, args });
}

function placeholderTestScript(script: string | undefined): boolean {
  return !script || script.includes('no test specified');
}

function skippedGate(
  gate: VerificationGate,
  command: string,
  stderr: string,
): VerificationGateResult {
  return {
    gate,
    status: 'skipped',
    command,
    exitCode: 0,
    stdout: '',
    stderr,
  };
}

async function runLint(projectId: string): Promise<VerificationGateResult> {
  const scripts = await readPackageScripts(projectId);
  if (!scripts.lint) {
    return skippedGate('lint', 'npm run lint', 'No lint script defined in package.json');
  }

  const result = await runCommand(projectId, 'npm', ['run', 'lint']);
  return {
    gate: 'lint',
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: 'npm run lint',
    ...result,
  };
}

async function runTypecheck(projectId: string): Promise<VerificationGateResult> {
  const scripts = await readPackageScripts(projectId);
  const command = scripts.typecheck ? ['run', 'typecheck'] : ['exec', 'tsc', '--noEmit'];
  const result = await runCommand(projectId, 'npm', command);

  return {
    gate: 'typecheck',
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: `npm ${command.join(' ')}`,
    ...result,
  };
}

async function runTests(
  projectId: string,
  scope: 'narrow' | 'broad' = 'narrow',
): Promise<VerificationGateResult> {
  const scripts = await readPackageScripts(projectId);
  const commandCandidates =
    scope === 'broad'
      ? [
          { script: 'test:integration', args: ['run', 'test:integration'] },
          { script: 'test:e2e', args: ['run', 'test:e2e'] },
          { script: 'test', args: ['run', 'test'] },
        ]
      : [
          { script: 'test:unit', args: ['run', 'test:unit'] },
          { script: 'test:orchestration', args: ['run', 'test:orchestration'] },
          { script: 'test', args: ['run', 'test'] },
        ];

  const candidate = commandCandidates.find(({ script }) => scripts[script]);
  if (!candidate || placeholderTestScript(scripts[candidate.script])) {
    return skippedGate(
      'tests',
      candidate ? `npm ${candidate.args.join(' ')}` : 'npm run test',
      'No non-placeholder test script defined in package.json',
    );
  }

  const result = await runCommand(projectId, 'npm', candidate.args);
  return {
    gate: 'tests',
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: `npm ${candidate.args.join(' ')}`,
    ...result,
  };
}

async function runBuild(projectId: string): Promise<VerificationGateResult> {
  const scripts = await readPackageScripts(projectId);
  if (!scripts.build) {
    return {
      gate: 'build',
      status: 'failed',
      command: 'npm run build',
      exitCode: 1,
      stdout: '',
      stderr: 'No build script defined in package.json',
    };
  }

  const result = await runCommand(projectId, 'npm', ['run', 'build']);
  return {
    gate: 'build',
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: 'npm run build',
    ...result,
  };
}

async function runSecurityAudit(projectId: string): Promise<VerificationGateResult> {
  const scripts = await readPackageScripts(projectId);
  if (scripts['security:audit']) {
    const result = await runCommand(projectId, 'npm', ['run', 'security:audit']);
    return {
      gate: 'security_audit',
      status: result.exitCode === 0 ? 'passed' : 'failed',
      command: 'npm run security:audit',
      ...result,
    };
  }

  const result = await runCommand(projectId, 'npm', ['audit', '--audit-level=high']);
  return {
    gate: 'security_audit',
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: 'npm audit --audit-level=high',
    ...result,
  };
}

export function createRunLintTool(ctx: ToolContext) {
  return createTool({
    id: 'run_lint',
    description: 'Run the repository lint command if available and return a structured gate result.',
    inputSchema: z.object({}),
    outputSchema: verificationGateResultSchema,
    execute: async () => runLint(ctx.projectId),
  });
}

export function createRunTypecheckTool(ctx: ToolContext) {
  return createTool({
    id: 'run_typecheck',
    description: 'Run the repository typecheck command and return a structured gate result.',
    inputSchema: z.object({}),
    outputSchema: verificationGateResultSchema,
    execute: async () => runTypecheck(ctx.projectId),
  });
}

export function createRunTestsTool(ctx: ToolContext) {
  return createTool({
    id: 'run_tests',
    description: 'Run the most relevant repository tests and return a structured gate result.',
    inputSchema: z.object({
      scope: z.enum(['narrow', 'broad']).optional().default('narrow'),
    }),
    outputSchema: verificationGateResultSchema,
    execute: async ({ scope }) => runTests(ctx.projectId, scope ?? 'narrow'),
  });
}

export function createRunBuildTool(ctx: ToolContext) {
  return createTool({
    id: 'run_build',
    description: 'Run the repository build command and return a structured gate result.',
    inputSchema: z.object({}),
    outputSchema: verificationGateResultSchema,
    execute: async () => runBuild(ctx.projectId),
  });
}

export function createRunSecurityAuditTool(ctx: ToolContext) {
  return createTool({
    id: 'run_security_audit',
    description: 'Run a repository security audit and return a structured gate result.',
    inputSchema: z.object({}),
    outputSchema: verificationGateResultSchema,
    execute: async () => runSecurityAudit(ctx.projectId),
  });
}

export async function runVerificationSequence(
  ctx: ToolContext,
  options: VerificationSequenceOptions = {},
): Promise<VerificationGateResult[]> {
  const gateResults: VerificationGateResult[] = [];
  const stopOnFailure = options.stopOnFailure ?? true;

  const lintResult = await runLint(ctx.projectId);
  gateResults.push(lintResult);
  if (stopOnFailure && lintResult.status === 'failed') {
    return gateResults;
  }

  const typecheckResult = await runTypecheck(ctx.projectId);
  gateResults.push(typecheckResult);
  if (stopOnFailure && typecheckResult.status === 'failed') {
    return gateResults;
  }

  if (options.includeTests) {
    const testsResult = await runTests(ctx.projectId, options.includeSecurityAudit ? 'broad' : 'narrow');
    gateResults.push(testsResult);
    if (stopOnFailure && testsResult.status === 'failed') {
      return gateResults;
    }
  }

  if (options.includeBuild ?? true) {
    const buildResult = await runBuild(ctx.projectId);
    gateResults.push(buildResult);
    if (stopOnFailure && buildResult.status === 'failed') {
      return gateResults;
    }
  }

  if (options.includeSecurityAudit) {
    const securityAuditResult = await runSecurityAudit(ctx.projectId);
    gateResults.push(securityAuditResult);
    if (stopOnFailure && securityAuditResult.status === 'failed') {
      return gateResults;
    }
  }

  return gateResults;
}

export async function runDefaultVerificationSequence(
  ctx: ToolContext,
): Promise<VerificationGateResult[]> {
  return runVerificationSequence(ctx, {
    includeTests: true,
    includeBuild: true,
    stopOnFailure: true,
  });
}

export async function runHighRiskVerificationSequence(
  ctx: ToolContext,
): Promise<VerificationGateResult[]> {
  return runVerificationSequence(ctx, {
    includeTests: true,
    includeBuild: true,
    includeSecurityAudit: true,
    stopOnFailure: true,
  });
}

export async function runBroadVerificationSequence(
  ctx: ToolContext,
): Promise<VerificationGateResult[]> {
  return runVerificationSequence(ctx, {
    includeTests: true,
    includeBuild: true,
    stopOnFailure: true,
  });
}
