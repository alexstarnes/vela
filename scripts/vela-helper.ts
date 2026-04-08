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
