type HelperMethod = 'GET' | 'POST';

interface HelperResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface HelperDirectorySelection {
  path: string;
  workspaceId: string;
}

export interface HelperWorkspaceInfo extends HelperDirectorySelection {
  exists: boolean;
  isDirectory: boolean;
}

export interface HelperCloneResult {
  workspacePath: string;
  workspaceId: string;
  defaultBranch: string | null;
}

export interface HelperHealth {
  ok: boolean;
  version?: string;
  platform?: string;
}

function getHelperBaseUrl(): string {
  return process.env.VELA_HELPER_URL || 'http://127.0.0.1:4312';
}

function getHelperSecret(): string {
  const secret = process.env.VELA_HELPER_SECRET;
  if (!secret) {
    throw new Error('VELA_HELPER_SECRET is not set');
  }
  return secret;
}

async function callHelper<T>(
  pathname: string,
  method: HelperMethod,
  payload?: unknown,
): Promise<T> {
  const baseUrl = getHelperBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Vela-Helper-Secret': getHelperSecret(),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      `Vela helper is unreachable at ${baseUrl} (${pathname}). Start it with \`npm run dev:helper\` — workspace file operations cannot run without it.`,
    );
  }

  const body = (await response.json().catch(() => null)) as HelperResponse<T> | null;

  if (!response.ok || !body?.ok || !body.data) {
    throw new Error(body?.error || `Helper request failed for ${pathname}`);
  }

  return body.data;
}

export async function getHelperHealth(): Promise<HelperHealth> {
  try {
    return await callHelper<HelperHealth>('/health', 'GET');
  } catch (error) {
    return {
      ok: false,
      version: undefined,
      platform: error instanceof Error ? error.message : 'Helper unavailable',
    };
  }
}

export async function pickDirectory(prompt?: string): Promise<HelperDirectorySelection> {
  return callHelper<HelperDirectorySelection>('/pick-directory', 'POST', { prompt });
}

export async function createDirectory(params: {
  parentPath: string;
  folderName: string;
}): Promise<HelperDirectorySelection> {
  return callHelper<HelperDirectorySelection>('/create-directory', 'POST', params);
}

export async function validateWorkspace(path: string): Promise<HelperWorkspaceInfo> {
  return callHelper<HelperWorkspaceInfo>('/validate-workspace', 'POST', { path });
}

export async function cloneRepository(params: {
  repositoryUrl: string;
  parentPath: string;
  directoryName: string;
  branch?: string;
  authToken?: string;
}): Promise<HelperCloneResult> {
  return callHelper<HelperCloneResult>('/clone-repository', 'POST', params);
}

export async function readWorkspaceFile(params: {
  workspacePath: string;
  relativePath: string;
}): Promise<{ content: string }> {
  return callHelper<{ content: string }>('/workspace/read-file', 'POST', params);
}

export async function writeWorkspaceFile(params: {
  workspacePath: string;
  relativePath: string;
  content: string;
}): Promise<{ saved: boolean }> {
  return callHelper<{ saved: boolean }>('/workspace/write-file', 'POST', params);
}

export async function applyWorkspaceDiff(params: {
  workspacePath: string;
  relativePath: string;
  searchText: string;
  replaceText: string;
}): Promise<{ applied: boolean; message?: string }> {
  return callHelper<{ applied: boolean; message?: string }>('/workspace/apply-diff', 'POST', params);
}

export async function runWorkspaceCommand(params: {
  workspacePath: string;
  command: string;
  args?: string[];
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return callHelper<{ stdout: string; stderr: string; exitCode: number }>(
    '/workspace/run-command',
    'POST',
    params,
  );
}

export async function getWorkspaceGitStatus(params: {
  workspacePath: string;
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-status', 'POST', params);
}

export async function getWorkspaceGitDiff(params: {
  workspacePath: string;
  relativePath?: string;
  /** Review exactly one branch's work: `git diff baseRef...headRef`. */
  baseRef?: string;
  headRef?: string;
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-diff', 'POST', params);
}

// ─── Branch lifecycle ──────────────────────────────────────────────
//
// The branch is the unit of work and the tree is disposable: quarantine
// whatever a previous run left behind, run each task on its own branch,
// commit on review-pass, squash-merge on operator approve.

export async function listWorkspaceGitBranches(params: {
  workspacePath: string;
  /** Ref prefix, e.g. `vela/quarantine/` — omit to list every branch. */
  prefix?: string;
}): Promise<{ branches: string[]; current: string | null }> {
  return callHelper<{ branches: string[]; current: string | null }>(
    '/workspace/git-branch-list',
    'POST',
    params,
  );
}

/** Check out `branch`, creating it from `startPoint` only if it is new. */
export async function ensureWorkspaceGitBranch(params: {
  workspacePath: string;
  branch: string;
  startPoint?: string;
}): Promise<{ branch: string; created: boolean; previousBranch: string | null; switched: boolean }> {
  return callHelper('/workspace/git-branch-ensure', 'POST', params);
}

/** Move the working tree onto `branch` and commit it. Clean tree → committed: false. */
export async function saveWorkspaceGitBranch(params: {
  workspacePath: string;
  branch: string;
  message: string;
}): Promise<{ branch: string; committed: boolean; commitSha: string | null; created: boolean }> {
  return callHelper('/workspace/git-branch-save', 'POST', params);
}

/** Squash-merge a task branch into base. Conflicts return `conflict: true`, never throw. */
export async function squashMergeWorkspaceGitBranch(params: {
  workspacePath: string;
  branch: string;
  baseBranch: string;
  message: string;
  deleteBranch?: boolean;
}): Promise<{
  merged: boolean;
  conflict: boolean;
  commitSha: string | null;
  branchDeleted: boolean;
  baseBranch: string;
  output: string;
}> {
  return callHelper('/workspace/git-merge-squash', 'POST', params);
}

/** Hard-reset the tree. Only ever called after the quarantine save. */
export async function resetWorkspaceGitHard(params: {
  workspacePath: string;
  ref: string;
}): Promise<{ ref: string; cleaned: string }> {
  return callHelper('/workspace/git-reset-hard', 'POST', params);
}

export async function checkoutWorkspaceGitRef(params: {
  workspacePath: string;
  ref: string;
  createNew?: boolean;
  startPoint?: string;
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-checkout', 'POST', params);
}

export async function gitAdd(params: {
  workspacePath: string;
  files?: string[];
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-add', 'POST', params);
}

export async function gitCommit(params: {
  workspacePath: string;
  message: string;
}): Promise<{ stdout: string; commitSha: string | null }> {
  return callHelper<{ stdout: string; commitSha: string | null }>('/workspace/git-commit', 'POST', params);
}

export async function gitPush(params: {
  workspacePath: string;
  remote?: string;
  setUpstream?: boolean;
  authToken?: string;
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-push', 'POST', params);
}

// ─── Dev server control ────────────────────────────────────────────

export interface DevServerStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  exitCode: number | null;
  recentOutput: string[];
}

export async function startWorkspaceDevServer(params: {
  workspacePath: string;
  script?: string;
}): Promise<DevServerStatus> {
  return callHelper<DevServerStatus>('/dev-server/start', 'POST', params);
}

export async function stopWorkspaceDevServer(params: {
  workspacePath: string;
}): Promise<{ stopped: boolean; wasRunning: boolean }> {
  return callHelper<{ stopped: boolean; wasRunning: boolean }>('/dev-server/stop', 'POST', params);
}

export async function getWorkspaceDevServerStatus(params: {
  workspacePath: string;
}): Promise<DevServerStatus> {
  return callHelper<DevServerStatus>('/dev-server/status', 'POST', params);
}

// ─── CLI execution lane ────────────────────────────────────────────

export type CliName = 'claude' | 'codex';

export interface CliHealthResult {
  cli: CliName;
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface CliExecuteResult {
  ok: boolean;
  errorKind: 'usage_limit' | 'auth' | 'timeout' | 'error' | null;
  resultText: string;
  rawOutput: string;
  exitCode: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  reportedCostUsd: number | null;
  numTurns: number | null;
  durationMs: number | null;
}

export const CLI_EXECUTE_DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

export async function checkCliLaneHealth(cli: CliName): Promise<CliHealthResult> {
  try {
    return await callHelper<CliHealthResult>('/cli/health', 'POST', { cli });
  } catch (error) {
    return {
      cli,
      available: false,
      version: null,
      error: error instanceof Error ? error.message : 'Helper unreachable',
    };
  }
}

/**
 * Run a headless coding CLI in a workspace via the helper. Uses node:http
 * directly (not fetch) because CLI executions can outlive undici's default
 * 5-minute header timeout.
 */
export async function executeCliTask(params: {
  /** Omit for completion-shaped invocations — the helper runs the CLI in an
   *  empty sandbox so it has no repo to wander into (critique ring, etc.). */
  workspacePath?: string;
  cli: CliName;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  maxTurns?: number;
  /** Restrict the CLI's toolset; [] disables tools entirely. */
  allowedTools?: string[];
  /** Claude CLI permission mode; defaults to 'acceptEdits' in the helper. */
  permissionMode?: string;
}): Promise<CliExecuteResult> {
  const { request } = await import('node:http');
  const timeoutMs = params.timeoutMs ?? CLI_EXECUTE_DEFAULT_TIMEOUT_MS;
  const baseUrl = new URL(getHelperBaseUrl());
  const payload = JSON.stringify({ ...params, timeoutMs });

  return new Promise<CliExecuteResult>((resolve, reject) => {
    const req = request(
      {
        hostname: baseUrl.hostname,
        port: baseUrl.port || 80,
        path: '/cli/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Vela-Helper-Secret': getHelperSecret(),
        },
        // Helper enforces its own process timeout; give it headroom to respond.
        timeout: timeoutMs + 30_000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as HelperResponse<CliExecuteResult>;
            if (!parsed.ok || !parsed.data) {
              reject(new Error(parsed.error || 'CLI execution failed in helper'));
              return;
            }
            resolve(parsed.data);
          } catch {
            reject(new Error(`Helper returned invalid response for /cli/execute: ${body.slice(0, 200)}`));
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('CLI execution request timed out waiting for the helper'));
    });
    req.on('error', (error) => {
      reject(
        new Error(
          `Vela helper is unreachable at ${baseUrl.origin} (/cli/execute): ${error.message}. Start it with \`npm run dev:helper\`.`,
        ),
      );
    });
    req.write(payload);
    req.end();
  });
}
