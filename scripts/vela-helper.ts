import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const PORT = Number(process.env.VELA_HELPER_PORT || '4312');
const SECRET = process.env.VELA_HELPER_SECRET;

if (!SECRET) {
  throw new Error('VELA_HELPER_SECRET is required to run the local helper');
}

function workspaceIdForPath(targetPath: string) {
  return createHash('sha256').update(path.resolve(targetPath)).digest('hex').slice(0, 16);
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function escapeAppleScript(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function parseJsonBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

async function chooseDirectory(prompt?: string) {
  const script = `POSIX path of (choose folder with prompt "${escapeAppleScript(prompt || 'Choose a folder for Vela')}")`;
  const result = await runProcess('osascript', ['-e', script]);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(result.stderr || 'Folder selection was cancelled');
  }

  const targetPath = result.stdout.trim();
  return {
    path: targetPath,
    workspaceId: workspaceIdForPath(targetPath),
  };
}

type ApplyDiffResult =
  | { applied: true; updated: string; matchKind: 'exact' | 'whitespace' }
  | { applied: false; message: string };

function leadingWhitespace(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? '';
}

/**
 * Find windows of file lines whose trimmed content matches the trimmed search
 * lines. Used as a fallback when an exact substring match fails (models often
 * get indentation slightly wrong).
 */
function findWhitespaceTolerantMatches(fileLines: string[], searchLines: string[]): number[] {
  const trimmedSearch = searchLines.map((line) => line.trim());
  const matches: number[] = [];

  for (let start = 0; start <= fileLines.length - trimmedSearch.length; start++) {
    let isMatch = true;
    for (let i = 0; i < trimmedSearch.length; i++) {
      if (fileLines[start + i].trim() !== trimmedSearch[i]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      matches.push(start);
    }
  }

  return matches;
}

/** Snippet of file content around the closest line to help the caller correct its search text. */
function buildClosestMatchHint(fileLines: string[], searchLines: string[]): string {
  const anchor = searchLines.map((line) => line.trim()).find((line) => line.length > 8)
    ?? searchLines.map((line) => line.trim()).find(Boolean);
  if (!anchor) {
    return '';
  }

  const fragment = anchor.slice(0, 40);
  const index = fileLines.findIndex(
    (line) => line.includes(anchor) || (fragment.length >= 12 && line.includes(fragment)),
  );
  if (index === -1) {
    return '';
  }

  const from = Math.max(0, index - 3);
  const to = Math.min(fileLines.length, index + searchLines.length + 3);
  const snippet = fileLines
    .slice(from, to)
    .map((line, i) => `${from + i + 1}: ${line}`)
    .join('\n');
  return `\nClosest matching region in the file:\n${snippet}`;
}

function applyDiffToContent(
  original: string,
  searchText: string,
  replaceText: string,
): ApplyDiffResult {
  const exactOccurrences = original.split(searchText).length - 1;
  if (exactOccurrences === 1) {
    return { applied: true, updated: original.replace(searchText, replaceText), matchKind: 'exact' };
  }
  if (exactOccurrences > 1) {
    return {
      applied: false,
      message: `Search text is ambiguous (found ${exactOccurrences} occurrences). Provide more surrounding context to match uniquely.`,
    };
  }

  // No exact match — retry tolerating leading/trailing whitespace differences per line.
  const fileLines = original.split('\n');
  const searchLines = searchText.split('\n');
  const matches = findWhitespaceTolerantMatches(fileLines, searchLines);

  if (matches.length === 1) {
    const start = matches[0];
    // Re-indent the replacement to the file's actual indentation when the
    // caller's indentation was off by a constant prefix.
    const fileIndent = leadingWhitespace(fileLines[start]);
    const searchIndent = leadingWhitespace(searchLines[0]);
    const replaceLines = replaceText.split('\n').map((line) => {
      if (searchIndent === fileIndent) {
        return line;
      }
      return line.startsWith(searchIndent)
        ? fileIndent + line.slice(searchIndent.length)
        : line;
    });
    const updatedLines = [
      ...fileLines.slice(0, start),
      ...replaceLines,
      ...fileLines.slice(start + searchLines.length),
    ];
    return { applied: true, updated: updatedLines.join('\n'), matchKind: 'whitespace' };
  }

  if (matches.length > 1) {
    return {
      applied: false,
      message: `Search text matches ${matches.length} regions when ignoring indentation. Provide more surrounding context to match uniquely.`,
    };
  }

  return {
    applied: false,
    message:
      'Search text not found in file (even ignoring indentation). Re-read the file with read_workspace_file and copy the target text exactly, or rewrite the whole file with write_workspace_file.'
      + buildClosestMatchHint(fileLines, searchLines),
  };
}

async function ensureDirectory(dirPath: string) {
  const resolvedPath = path.resolve(dirPath);
  const info = await stat(resolvedPath);
  if (!info.isDirectory()) {
    throw new Error('Path is not a directory');
  }
  return resolvedPath;
}

async function createWorkspaceDirectory(parentPath: string, folderName: string) {
  const resolvedParent = await ensureDirectory(parentPath);
  const trimmedName = folderName.trim();
  if (!trimmedName || trimmedName.includes('/') || trimmedName.includes(path.sep)) {
    throw new Error('Folder name is invalid');
  }

  const targetPath = path.join(resolvedParent, trimmedName);
  await mkdir(targetPath, { recursive: false });

  return {
    path: targetPath,
    workspaceId: workspaceIdForPath(targetPath),
  };
}

function resolveWorkspacePath(workspacePath: string, relativePath: string) {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    throw new Error('Path escapes the workspace root');
  }
  return target;
}

async function cloneRepository(params: {
  repositoryUrl: string;
  parentPath: string;
  directoryName: string;
  branch?: string;
  authToken?: string;
}) {
  const parentDirectory = await ensureDirectory(params.parentPath);
  const targetPath = path.join(parentDirectory, params.directoryName);

  const args = ['clone'];
  if (params.authToken) {
    const basicAuth = Buffer.from(`x-access-token:${params.authToken}`).toString('base64');
    args.push('-c', `http.extraHeader=AUTHORIZATION: Basic ${basicAuth}`);
  }
  if (params.branch) {
    args.push('--branch', params.branch, '--single-branch');
  }
  args.push(params.repositoryUrl, targetPath);

  const clone = await runProcess('git', args);
  if (clone.exitCode !== 0) {
    throw new Error(clone.stderr || 'Git clone failed');
  }

  const branchResult = await runProcess('git', ['branch', '--show-current'], { cwd: targetPath });

  return {
    workspacePath: targetPath,
    workspaceId: workspaceIdForPath(targetPath),
    defaultBranch: branchResult.stdout || params.branch || null,
  };
}

// ─── CLI execution lane (subscription-backed coding CLIs) ─────────
//
// Runs a headless coding CLI (claude -p / codex exec) inside a workspace so
// implementation work can execute under subscription auth instead of metered
// API billing. The CLI must already be logged in on this machine.

const CLI_BINARIES = {
  claude: 'claude',
  codex: 'codex',
} as const;

type CliName = keyof typeof CLI_BINARIES;

const CLI_EXECUTE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const CLI_HEALTH_TIMEOUT_MS = 10 * 1000;

/** Tools Claude Code may use without prompting during a headless run. */
const CLI_DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'LS',
  'Edit',
  'Write',
  'MultiEdit',
  'Bash(git diff*)',
  'Bash(git status*)',
  'Bash(npm run lint*)',
  'Bash(npm run build*)',
  'Bash(npm run typecheck*)',
  'Bash(npm test*)',
];

function isCliName(value: unknown): value is CliName {
  return value === 'claude' || value === 'codex';
}

/**
 * Environment for spawned CLIs: strip provider API keys so the CLI uses its
 * own subscription login instead of silently billing a metered key (or dying
 * on a stale one). That is the whole point of the CLI lane.
 */
function cliEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  return env;
}

function runProcessWithTimeout(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }, options.timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(killTimer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(killTimer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
          timedOut,
        });
      });
    },
  );
}

interface ClaudeResultJson {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Extract the result JSON from `claude -p --output-format json` stdout.
 * The result is a single JSON line, but the CLI can print warning lines
 * before or after it (e.g. MCP "Client.listTools()" notices), so a bare
 * JSON.parse of the whole stream is not reliable.
 */
function parseClaudeResultJson(stdout: string): ClaudeResultJson | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ClaudeResultJson;
  } catch {
    // Fall through to line-by-line scan.
  }
  for (const line of trimmed.split('\n').reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate) as ClaudeResultJson & { type?: string };
      if (parsed.type === 'result' || 'result' in parsed || 'is_error' in parsed) {
        return parsed;
      }
    } catch {
      // Not the result line — keep scanning.
    }
  }
  return null;
}

/** Classify CLI failures so the router can distinguish caps from real errors. */
function classifyCliFailure(output: string): 'usage_limit' | 'auth' | null {
  const lower = output.toLowerCase();
  if (
    /usage limit|rate.?limit|quota exceeded|limit reached|too many requests|overloaded|out of credits|credit balance/.test(
      lower,
    )
  ) {
    return 'usage_limit';
  }
  if (
    /not logged in|please run \/login|please log ?in|authentication|unauthorized|invalid api key|token expired|login required/.test(
      lower,
    )
  ) {
    return 'auth';
  }
  return null;
}

async function checkCliHealth(cli: CliName) {
  try {
    const result = await runProcessWithTimeout(CLI_BINARIES[cli], ['--version'], {
      timeoutMs: CLI_HEALTH_TIMEOUT_MS,
    });
    return {
      cli,
      available: result.exitCode === 0,
      version: result.exitCode === 0 ? result.stdout.split('\n')[0] : null,
      error: result.exitCode === 0 ? null : result.stderr || result.stdout || 'CLI not available',
    };
  } catch (error) {
    return {
      cli,
      available: false,
      version: null,
      error: error instanceof Error ? error.message : 'CLI not available',
    };
  }
}

interface CliExecuteResult {
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

async function executeCli(params: {
  cli: CliName;
  workspacePath: string;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  maxTurns?: number;
  allowedTools?: string[];
}): Promise<CliExecuteResult> {
  const cwd = path.resolve(params.workspacePath);
  await stat(cwd);
  const timeoutMs = params.timeoutMs ?? CLI_EXECUTE_DEFAULT_TIMEOUT_MS;

  let command: string;
  let args: string[];

  if (params.cli === 'claude') {
    command = CLI_BINARIES.claude;
    args = [
      '-p',
      params.prompt,
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      (params.allowedTools ?? CLI_DEFAULT_ALLOWED_TOOLS).join(','),
      '--max-turns',
      String(params.maxTurns ?? 30),
    ];
    if (params.model) {
      args.push('--model', params.model);
    }
  } else {
    // codex exec runs non-interactively; JSON event stream on stdout.
    command = CLI_BINARIES.codex;
    args = ['exec', '--json', '--skip-git-repo-check', params.prompt];
    if (params.model) {
      args.push('--model', params.model);
    }
  }

  const result = await runProcessWithTimeout(command, args, {
    cwd,
    timeoutMs,
    env: cliEnvironment(),
  });
  const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();

  if (result.timedOut) {
    return {
      ok: false,
      errorKind: 'timeout',
      resultText: `CLI execution timed out after ${timeoutMs}ms`,
      rawOutput: combinedOutput.slice(-4000),
      exitCode: result.exitCode,
      usage: null,
      reportedCostUsd: null,
      numTurns: null,
      durationMs: timeoutMs,
    };
  }

  if (params.cli === 'claude') {
    const parsedResult = parseClaudeResultJson(result.stdout);
    if (parsedResult) {
      const parsed = parsedResult;
      const failure =
        result.exitCode !== 0 || parsed.is_error
          ? classifyCliFailure(`${parsed.result ?? ''}\n${combinedOutput}`) ?? 'error'
          : null;
      const inputTokens = parsed.usage?.input_tokens ?? 0;
      const outputTokens = parsed.usage?.output_tokens ?? 0;
      return {
        ok: failure === null,
        errorKind: failure,
        resultText: parsed.result ?? '',
        rawOutput: combinedOutput.slice(-4000),
        exitCode: result.exitCode,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        reportedCostUsd: parsed.total_cost_usd ?? null,
        numTurns: parsed.num_turns ?? null,
        durationMs: parsed.duration_ms ?? null,
      };
    }
    // No parseable result JSON — fall through to the generic handling below.
  }

  // codex exec --json emits a JSONL event stream; extract the final agent
  // message and token usage from it.
  let resultText = result.stdout;
  let usage: CliExecuteResult['usage'] = null;
  if (params.cli === 'codex') {
    for (const line of result.stdout.split('\n')) {
      try {
        const event = JSON.parse(line) as {
          type?: string;
          item?: { type?: string; text?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
          resultText = event.item.text;
        }
        if (event.usage) {
          const inputTokens = event.usage.input_tokens ?? 0;
          const outputTokens = event.usage.output_tokens ?? 0;
          usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
        }
      } catch {
        // Non-JSON line — ignore.
      }
    }
  }

  const failure =
    result.exitCode !== 0 ? classifyCliFailure(combinedOutput) ?? 'error' : null;
  return {
    ok: failure === null,
    errorKind: failure,
    resultText,
    rawOutput: combinedOutput.slice(-4000),
    exitCode: result.exitCode,
    usage,
    reportedCostUsd: null,
    numTurns: null,
    durationMs: null,
  };
}

// ─── Dev server control ────────────────────────────────────────────
//
// Managed `npm run dev` processes per workspace. The helper owns the child
// processes, tracks the port each server binds to (parsed from its output),
// and reports status. Servers die with the helper — this is a convenience
// control surface, not a process supervisor.

interface DevServerEntry {
  child: ReturnType<typeof spawn>;
  pid: number;
  startedAt: string;
  port: number | null;
  recentOutput: string[];
  exited: boolean;
  exitCode: number | null;
}

const devServers = new Map<string, DevServerEntry>();
const DEV_SERVER_OUTPUT_LINES = 40;
const DEV_SERVER_PORT_WAIT_MS = 15_000;

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function detectPort(output: string): number | null {
  const match = stripAnsi(output).match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})/);
  return match ? Number(match[1]) : null;
}

function devServerStatus(workspacePath: string) {
  const key = workspaceIdForPath(workspacePath);
  const entry = devServers.get(key);
  if (!entry || entry.exited) {
    return {
      running: false,
      pid: null,
      port: null,
      startedAt: null,
      exitCode: entry?.exitCode ?? null,
      recentOutput: entry?.recentOutput.slice(-10) ?? [],
    };
  }
  return {
    running: true,
    pid: entry.pid,
    port: entry.port,
    startedAt: entry.startedAt,
    exitCode: null,
    recentOutput: entry.recentOutput.slice(-10),
  };
}

async function startDevServer(workspacePath: string, script: string) {
  const cwd = path.resolve(workspacePath);
  await stat(cwd);
  const key = workspaceIdForPath(cwd);

  const existing = devServers.get(key);
  if (existing && !existing.exited) {
    return devServerStatus(cwd);
  }

  // Only allow package.json scripts — never arbitrary commands.
  if (!/^[\w:-]+$/.test(script)) {
    throw new Error(`Invalid dev script name: ${script}`);
  }

  const child = spawn('npm', ['run', script], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const entry: DevServerEntry = {
    child,
    pid: child.pid ?? -1,
    startedAt: new Date().toISOString(),
    port: null,
    recentOutput: [],
    exited: false,
    exitCode: null,
  };
  devServers.set(key, entry);

  const onOutput = (chunk: Buffer | string) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      const clean = stripAnsi(line).trimEnd();
      if (!clean) continue;
      entry.recentOutput.push(clean);
      if (entry.recentOutput.length > DEV_SERVER_OUTPUT_LINES) {
        entry.recentOutput.shift();
      }
    }
    if (entry.port === null) {
      entry.port = detectPort(text);
    }
  };
  child.stdout?.on('data', onOutput);
  child.stderr?.on('data', onOutput);
  child.on('close', (exitCode) => {
    entry.exited = true;
    entry.exitCode = exitCode ?? 1;
  });
  child.on('error', () => {
    entry.exited = true;
    entry.exitCode = entry.exitCode ?? 1;
  });

  // Give the server a moment to bind so the response can include the port.
  const deadline = Date.now() + DEV_SERVER_PORT_WAIT_MS;
  while (entry.port === null && !entry.exited && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return devServerStatus(cwd);
}

async function stopDevServer(workspacePath: string) {
  const key = workspaceIdForPath(path.resolve(workspacePath));
  const entry = devServers.get(key);
  if (!entry || entry.exited) {
    devServers.delete(key);
    return { stopped: true, wasRunning: false };
  }

  entry.child.kill('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (!entry.exited && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!entry.exited) {
    entry.child.kill('SIGKILL');
  }
  devServers.delete(key);
  return { stopped: true, wasRunning: true };
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  if (request.headers['x-vela-helper-secret'] !== SECRET) {
    sendJson(response, 401, { ok: false, error: 'Unauthorized helper request' });
    return;
  }

  try {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        data: {
          ok: true,
          version: '1.0.0',
          platform: process.platform,
        },
      });
      return;
    }

    const body = request.method === 'POST' ? await parseJsonBody(request) : {};

    if (request.method === 'POST' && url.pathname === '/pick-directory') {
      const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;
      sendJson(response, 200, { ok: true, data: await chooseDirectory(prompt) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/create-directory') {
      if (typeof body.parentPath !== 'string' || typeof body.folderName !== 'string') {
        throw new Error('parentPath and folderName are required');
      }
      sendJson(response, 200, {
        ok: true,
        data: await createWorkspaceDirectory(body.parentPath, body.folderName),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/validate-workspace') {
      if (typeof body.path !== 'string') {
        throw new Error('path is required');
      }
      const targetPath = path.resolve(body.path);
      const info = await stat(targetPath);
      sendJson(response, 200, {
        ok: true,
        data: {
          path: targetPath,
          workspaceId: workspaceIdForPath(targetPath),
          exists: true,
          isDirectory: info.isDirectory(),
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/clone-repository') {
      if (
        typeof body.repositoryUrl !== 'string' ||
        typeof body.parentPath !== 'string' ||
        typeof body.directoryName !== 'string'
      ) {
        throw new Error('repositoryUrl, parentPath, and directoryName are required');
      }
      sendJson(response, 200, {
        ok: true,
        data: await cloneRepository({
          repositoryUrl: body.repositoryUrl,
          parentPath: body.parentPath,
          directoryName: body.directoryName,
          branch: typeof body.branch === 'string' ? body.branch : undefined,
          authToken: typeof body.authToken === 'string' ? body.authToken : undefined,
        }),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/read-file') {
      if (typeof body.workspacePath !== 'string' || typeof body.relativePath !== 'string') {
        throw new Error('workspacePath and relativePath are required');
      }
      const content = await readFile(
        resolveWorkspacePath(body.workspacePath, body.relativePath),
        'utf8',
      );
      sendJson(response, 200, { ok: true, data: { content } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/write-file') {
      if (
        typeof body.workspacePath !== 'string' ||
        typeof body.relativePath !== 'string' ||
        typeof body.content !== 'string'
      ) {
        throw new Error('workspacePath, relativePath, and content are required');
      }
      const targetPath = resolveWorkspacePath(body.workspacePath, body.relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, body.content, 'utf8');
      sendJson(response, 200, { ok: true, data: { saved: true } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/apply-diff') {
      if (
        typeof body.workspacePath !== 'string' ||
        typeof body.relativePath !== 'string' ||
        typeof body.searchText !== 'string' ||
        typeof body.replaceText !== 'string'
      ) {
        throw new Error('workspacePath, relativePath, searchText, and replaceText are required');
      }
      const targetPath = resolveWorkspacePath(body.workspacePath, body.relativePath);
      const original = await readFile(targetPath, 'utf8');
      const result = applyDiffToContent(original, body.searchText, body.replaceText);
      if (result.applied) {
        await writeFile(targetPath, result.updated, 'utf8');
        sendJson(response, 200, {
          ok: true,
          data: { applied: true, matchKind: result.matchKind },
        });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        data: { applied: false, message: result.message },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/run-command') {
      if (typeof body.workspacePath !== 'string' || typeof body.command !== 'string') {
        throw new Error('workspacePath and command are required');
      }
      const result = await runProcess(
        body.command,
        Array.isArray(body.args) ? body.args.filter((value): value is string => typeof value === 'string') : [],
        { cwd: path.resolve(body.workspacePath) },
      );
      sendJson(response, 200, { ok: true, data: result });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-status') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      const result = await runProcess('git', ['status', '--short', '--branch'], {
        cwd: path.resolve(body.workspacePath),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git status failed');
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-diff') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      const args = ['diff'];
      if (typeof body.relativePath === 'string' && body.relativePath) {
        args.push('--', body.relativePath);
      }
      const result = await runProcess('git', args, {
        cwd: path.resolve(body.workspacePath),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git diff failed');
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-add') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : ['.'];
      const result = await runProcess('git', ['add', ...files], {
        cwd: path.resolve(body.workspacePath),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git add failed');
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout || 'staged' } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-commit') {
      if (typeof body.workspacePath !== 'string' || typeof body.message !== 'string') {
        throw new Error('workspacePath and message are required');
      }
      const result = await runProcess('git', ['commit', '-m', body.message], {
        cwd: path.resolve(body.workspacePath),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git commit failed');
      // Extract commit SHA from output
      const shaMatch = result.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
      const commitSha = shaMatch ? shaMatch[1] : null;
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout, commitSha } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-push') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      const remote = typeof body.remote === 'string' ? body.remote : 'origin';
      const cwd = path.resolve(body.workspacePath);

      // Build git args: optionally with auth header
      const args: string[] = [];
      if (typeof body.authToken === 'string') {
        const basicAuth = Buffer.from(`x-access-token:${body.authToken}`).toString('base64');
        args.push('-c', `http.extraHeader=AUTHORIZATION: Basic ${basicAuth}`);
      }
      args.push('push');

      if (body.setUpstream === true) {
        const branchResult = await runProcess('git', ['branch', '--show-current'], { cwd });
        const currentBranch = branchResult.stdout.trim();
        args.push('-u', remote, currentBranch);
      }

      const result = await runProcess('git', args, { cwd });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git push failed');
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout || result.stderr || 'pushed' } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/workspace/git-checkout') {
      if (typeof body.workspacePath !== 'string' || typeof body.ref !== 'string') {
        throw new Error('workspacePath and ref are required');
      }
      const args =
        body.createNew === true
          ? ['checkout', '-b', body.ref, typeof body.startPoint === 'string' ? body.startPoint : 'HEAD']
          : ['checkout', body.ref];
      const result = await runProcess('git', args, {
        cwd: path.resolve(body.workspacePath),
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'git checkout failed');
      sendJson(response, 200, { ok: true, data: { stdout: result.stdout || result.stderr } });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/dev-server/start') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      const script = typeof body.script === 'string' ? body.script : 'dev';
      sendJson(response, 200, {
        ok: true,
        data: await startDevServer(body.workspacePath, script),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/dev-server/stop') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      sendJson(response, 200, { ok: true, data: await stopDevServer(body.workspacePath) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/dev-server/status') {
      if (typeof body.workspacePath !== 'string') {
        throw new Error('workspacePath is required');
      }
      sendJson(response, 200, { ok: true, data: devServerStatus(path.resolve(body.workspacePath)) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/cli/health') {
      if (!isCliName(body.cli)) {
        throw new Error('cli must be "claude" or "codex"');
      }
      sendJson(response, 200, { ok: true, data: await checkCliHealth(body.cli) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/cli/execute') {
      if (
        !isCliName(body.cli) ||
        typeof body.workspacePath !== 'string' ||
        typeof body.prompt !== 'string'
      ) {
        throw new Error('cli, workspacePath, and prompt are required');
      }
      sendJson(response, 200, {
        ok: true,
        data: await executeCli({
          cli: body.cli,
          workspacePath: body.workspacePath,
          prompt: body.prompt,
          model: typeof body.model === 'string' ? body.model : undefined,
          timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
          maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
          allowedTools: Array.isArray(body.allowedTools)
            ? body.allowedTools.filter((t): t is string => typeof t === 'string')
            : undefined,
        }),
      });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected helper error',
    });
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected helper failure',
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vela helper listening on http://127.0.0.1:${PORT}`);
});
