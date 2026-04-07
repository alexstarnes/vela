/**
 * Agent-orchestration skill reference markdown on disk (`.agents/skills/.../references/*.md`).
 * Used by seed (fenced system prompt → DB) and agent-factory (full playbook at runtime).
 */

import fs from 'node:fs';
import path from 'node:path';

/** Seeded / template agent display name → reference filename. */
export const AGENT_ORCHESTRATION_REF_FILE_BY_NAME: Record<string, string> = {
  Orchestrator: 'orchestrator.md',
  'Product Strategist': 'product-strategist.md',
  'UX Designer': 'ux-designer.md',
  Architect: 'architect.md',
  'Database Engineer': 'database-engineer.md',
  'Frontend Engineer': 'frontend-engineer.md',
  'Backend Engineer': 'backend-engineer.md',
  'Fullstack Implementer': 'fullstack-implementer.md',
  'AI/Agent Engineer': 'ai-engineer.md',
  'Code Reviewer': 'code-reviewer.md',
  'QA Engineer': 'qa-engineer.md',
  'Security Auditor': 'security-auditor.md',
  'Performance Engineer': 'performance-engineer.md',
  'DevOps Engineer': 'devops-engineer.md',
  'Technical Writer': 'technical-writer.md',
  'Data Analyst': 'data-analyst.md',
};

export function orchestrationReferencesDir(): string {
  return path.join(process.cwd(), '.agents/skills/agent-orchestration/references');
}

/** Full reference markdown, or null if unmapped / file missing (e.g. deploy without `.agents`). */
export function loadOrchestrationReferenceFull(agentName: string): string | null {
  const fileName = AGENT_ORCHESTRATION_REF_FILE_BY_NAME[agentName];
  if (!fileName) return null;
  const filePath = path.join(orchestrationReferencesDir(), fileName);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

/** Content inside the first `## System Prompt` fenced block. */
export function extractFencedSystemPrompt(markdown: string): string | null {
  const match = markdown.match(/## System Prompt\s*```\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/** Reference doc with the fenced system-prompt section removed (avoids duplicating DB `system_prompt`). */
export function stripFencedSystemPromptSection(markdown: string): string {
  return markdown.replace(/\r?\n## System Prompt\s*```[\s\S]*?```/, '').trim();
}

/**
 * Extra playbook text (capabilities, phases, anti-patterns, collaboration) for runtime prompts.
 * Returns null when this agent has no on-disk reference.
 */
export function playbookMarkdownWithoutCorePrompt(agentName: string): string | null {
  const full = loadOrchestrationReferenceFull(agentName);
  if (!full) return null;
  const rest = stripFencedSystemPromptSection(full);
  return rest.length > 0 ? rest : null;
}

/** Strict loader for `db:seed` — fails if reference or fenced block is missing. */
export function requireFencedSystemPromptForSeed(agentName: string): string {
  const full = loadOrchestrationReferenceFull(agentName);
  if (!full) {
    throw new Error(
      `Missing orchestration reference for "${agentName}" under ${orchestrationReferencesDir()}`
    );
  }
  const sp = extractFencedSystemPrompt(full);
  if (!sp) {
    throw new Error(`No "## System Prompt" fenced block in reference for "${agentName}"`);
  }
  return sp;
}
