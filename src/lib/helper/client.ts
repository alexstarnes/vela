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
  const response = await fetch(`${getHelperBaseUrl()}${pathname}`, {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Vela-Helper-Secret': getHelperSecret(),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

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
}): Promise<{ stdout: string }> {
  return callHelper<{ stdout: string }>('/workspace/git-diff', 'POST', params);
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
