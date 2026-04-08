'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  FolderGit2,
  HardDrive,
  Link2,
  Plus,
  RefreshCcw,
  X,
} from 'lucide-react';
import { createProject } from '@/lib/actions/projects';
import { useRouter } from 'next/navigation';

type Provider = 'local' | 'github';

interface HelperSession {
  ok: boolean;
  version?: string;
  platform?: string;
}

interface DirectorySelection {
  path: string;
  workspaceId: string;
}

interface GitHubConnection {
  connected: boolean;
  id?: string;
  login?: string;
  name?: string | null;
  avatarUrl?: string | null;
  status?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
}

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('github');
  const [helperSession, setHelperSession] = useState<HelperSession | null>(null);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [repoQuery, setRepoQuery] = useState('');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [githubParentFolder, setGithubParentFolder] = useState<DirectorySelection | null>(null);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingHelper, setLoadingHelper] = useState(false);
  const [loadingGitHub, setLoadingGitHub] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  );

  async function loadHelperSession() {
    setLoadingHelper(true);
    try {
      const response = await fetch('/api/helper/session', { cache: 'no-store' });
      const payload = (await response.json()) as { ok: boolean; data: HelperSession };
      setHelperSession(payload.data);
    } catch {
      setHelperSession({ ok: false, platform: 'Helper unavailable' });
    } finally {
      setLoadingHelper(false);
    }
  }

  async function loadGitHubConnection() {
    setLoadingGitHub(true);
    try {
      const response = await fetch('/api/github/connection', { cache: 'no-store' });
      const payload = (await response.json()) as { ok: boolean; data: GitHubConnection };
      setGithubConnection(payload.data);
    } catch {
      setGithubConnection({ connected: false, status: 'disconnected' });
    } finally {
      setLoadingGitHub(false);
    }
  }

  async function loadRepos(query?: string) {
    setLoadingRepos(true);
    try {
      const searchParams = new URLSearchParams();
      if (query) searchParams.set('q', query);
      const response = await fetch(`/api/github/repos?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as { ok: boolean; data?: GitHubRepo[]; error?: string };
      if (!payload.ok || !payload.data) {
        throw new Error(payload.error || 'Unable to load repositories');
      }
      setRepos(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load repositories');
    } finally {
      setLoadingRepos(false);
    }
  }

  async function loadBranches(owner: string, repo: string) {
    setLoadingBranches(true);
    try {
      const response = await fetch(
        `/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`,
        { cache: 'no-store' },
      );
      const payload = (await response.json()) as { ok: boolean; data?: string[]; error?: string };
      if (!payload.ok || !payload.data) {
        throw new Error(payload.error || 'Unable to load branches');
      }
      setBranches(payload.data);
      setSelectedBranch(payload.data[0] ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load branches');
      setBranches([]);
      setSelectedBranch('');
    } finally {
      setLoadingBranches(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadHelperSession().catch(() => undefined);
    loadGitHubConnection().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || provider !== 'github' || !githubConnection?.connected) return;
    loadRepos(repoQuery).catch(() => undefined);
  }, [open, provider, githubConnection?.connected, repoQuery]);

  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch('');
      return;
    }
    loadBranches(selectedRepo.owner, selectedRepo.name).catch(() => undefined);
  }, [selectedRepo]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'vela:github-connected') {
        loadGitHubConnection().catch(() => undefined);
        loadRepos(repoQuery).catch(() => undefined);
      }
      if (event.data.type === 'vela:github-connect-error') {
        setError('GitHub authentication did not complete successfully');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [repoQuery]);

  function resetState() {
    setProvider('github');
    setGithubParentFolder(null);
    setRepoQuery('');
    setRepos([]);
    setBranches([]);
    setSelectedRepoId(null);
    setSelectedBranch('');
    setError(null);
  }

  async function chooseFolder(
    prompt: string,
    setter: (selection: DirectorySelection) => void,
  ) {
    setError(null);
    try {
      const response = await fetch('/api/helper/pick-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: DirectorySelection;
        error?: string;
      };

      if (!payload.ok || !payload.data) {
        throw new Error(payload.error || 'Folder selection failed');
      }

      setter(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder selection failed');
    }
  }

  function connectGitHub() {
    setError(null);
    const popup = window.open(
      '/api/github/connect?popup=1',
      'vela-github-connect',
      'width=600,height=700,menubar=no,toolbar=no,location=no,status=no',
    );

    if (!popup) {
      setError('Popup blocked. Allow popups to connect GitHub.');
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    setError(null);
    startTransition(async () => {
      const shared = {
        name: (data.get('name') as string) || undefined,
        goal: (data.get('goal') as string) || undefined,
        context: (data.get('context') as string) || undefined,
      };

      const payload =
        selectedRepo && githubParentFolder
            ? {
                mode: 'github' as const,
                ...shared,
                repositoryUrl: selectedRepo.cloneUrl,
                repositoryOwner: selectedRepo.owner,
                repositoryName: selectedRepo.name,
                branch: selectedBranch || selectedRepo.defaultBranch,
                defaultBranch: selectedRepo.defaultBranch,
                parentPath: githubParentFolder.path,
              }
            : null;

      if (!payload) {
        setError('Complete the connection steps before creating the project');
        return;
      }

      const result = await createProject(payload);
      if (!result.success) {
        setError(result.error);
        return;
      }

      setOpen(false);
      form.reset();
      resetState();
      router.push(`/projects/${result.data.id}`);
    });
  }

  const helperReady = helperSession?.ok === true;
  const githubReady = githubConnection?.connected === true;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium"
        style={{ background: '#F5A623', color: '#fff' }}
      >
        <Plus size={14} strokeWidth={2} />
        Add Project
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onClick={() => {
              setOpen(false);
              resetState();
            }}
          />

          <div
            className="relative rounded-xl w-full max-w-4xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--dark-surface)', border: '1px solid var(--dark-border)' }}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-base font-bold tracking-tight" style={{ color: '#ECEAE4' }}>
                  Add Project
                </h2>
                <p className="text-xs mt-1" style={{ color: 'var(--stone-500)' }}>
                  Connect a local workspace or GitHub repo with real machine access.
                </p>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: 'var(--stone-500)' }}>
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <ProviderCard
                active={false}
                disabled
                icon={<HardDrive size={16} strokeWidth={1.5} />}
                label="Local Workspace"
                description="Coming soon. Local workspace connections are temporarily disabled."
                onClick={() => undefined}
              />
              <ProviderCard
                active={provider === 'github'}
                icon={<FolderGit2 size={16} strokeWidth={1.5} />}
                label="GitHub"
                description="Connect your account, pick a repo, and clone it locally."
                onClick={() => setProvider('github')}
              />
            </div>

            <div
              className="rounded-lg border p-3 mb-5 flex items-center justify-between"
              style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)' }}
            >
              <div className="text-xs">
                <div style={{ color: '#ECEAE4' }}>Local helper</div>
                <div style={{ color: 'var(--stone-500)' }}>
                  {loadingHelper
                    ? 'Checking helper...'
                    : helperReady
                      ? `Connected${helperSession?.platform ? ` on ${helperSession.platform}` : ''}`
                      : 'Not connected'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadHelperSession().catch(() => undefined)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
                style={{ background: 'var(--dark-surface)', color: 'var(--stone-300)' }}
              >
                <RefreshCcw size={12} strokeWidth={1.5} className={loadingHelper ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Project Name">
                  <input name="name" placeholder="Optional display name" className="w-full px-3 py-2 rounded-md text-sm outline-none" style={inputStyle} />
                </Field>
                <Field label="Goal">
                  <input name="goal" placeholder="What is this project trying to achieve?" className="w-full px-3 py-2 rounded-md text-sm outline-none" style={inputStyle} />
                </Field>
              </div>

              <div className="space-y-4">
                <div
                  className="rounded-lg border p-4"
                  style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm" style={{ color: '#ECEAE4' }}>
                        GitHub account
                      </p>
                      <p className="text-xs" style={{ color: 'var(--stone-500)' }}>
                        {loadingGitHub
                          ? 'Checking GitHub connection...'
                          : githubReady
                            ? `Connected as ${githubConnection?.login}`
                            : 'Connect GitHub to browse and import repositories'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {githubReady ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await fetch('/api/github/connection', { method: 'DELETE' });
                            setGithubConnection({ connected: false, status: 'disconnected' });
                            setRepos([]);
                            setBranches([]);
                            setSelectedRepoId(null);
                          }}
                          className="px-3 py-1.5 rounded-md text-xs font-mono"
                          style={{ background: 'var(--dark-surface)', color: 'var(--stone-300)' }}
                        >
                          Disconnect
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={connectGitHub}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono"
                        style={{ background: '#F5A623', color: '#fff' }}
                      >
                        <Link2 size={12} strokeWidth={1.5} />
                        {githubReady ? 'Reconnect' : 'Connect GitHub'}
                      </button>
                    </div>
                  </div>
                </div>

                <Field label="Repository Search">
                  <input
                    value={repoQuery}
                    onChange={(event) => setRepoQuery(event.target.value)}
                    placeholder="Search repositories..."
                    className="w-full px-3 py-2 rounded-md text-sm outline-none"
                    style={inputStyle}
                    disabled={!githubReady}
                  />
                </Field>

                <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
                  <div
                    className="rounded-lg border overflow-hidden"
                    style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)' }}
                  >
                    <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--stone-500)' }}>
                      Repositories
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: 'var(--dark-border)' }}>
                      {loadingRepos ? (
                        <RepoPlaceholder label="Loading repositories..." />
                      ) : repos.length === 0 ? (
                        <RepoPlaceholder label={githubReady ? 'No repositories found' : 'Connect GitHub first'} />
                      ) : (
                        repos.map((repo) => (
                          <button
                            key={repo.id}
                            type="button"
                            onClick={() => setSelectedRepoId(repo.id)}
                            className="w-full text-left px-3 py-2 transition-colors"
                            style={{
                              background: selectedRepoId === repo.id ? '#F5A62312' : 'transparent',
                            }}
                          >
                            <div className="text-sm" style={{ color: '#ECEAE4' }}>{repo.fullName}</div>
                            <div className="text-[11px] font-mono" style={{ color: 'var(--stone-500)' }}>
                              {repo.private ? 'private' : 'public'} · default {repo.defaultBranch}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Field label="Branch">
                      <select
                        value={selectedBranch}
                        onChange={(event) => setSelectedBranch(event.target.value)}
                        className="w-full px-3 py-2 rounded-md text-sm outline-none"
                        style={inputStyle}
                        disabled={!selectedRepo || loadingBranches}
                      >
                        {!selectedRepo ? <option value="">Select a repo first</option> : null}
                        {loadingBranches ? <option value="">Loading branches...</option> : null}
                        {branches.map((branch) => (
                          <option key={branch} value={branch}>
                            {branch}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <ChooserRow
                      label="Clone Destination"
                      value={githubParentFolder?.path ?? 'No destination selected'}
                      actionLabel="Choose Folder"
                      onAction={() => chooseFolder('Choose where Vela should clone this repository', setGithubParentFolder)}
                      disabled={!helperReady || !githubReady}
                      icon={<FolderGit2 size={14} strokeWidth={1.5} />}
                      compact
                    />
                  </div>
                </div>
              </div>

              <Field label="Context">
                <textarea
                  name="context"
                  rows={3}
                  placeholder="Additional context injected into agent prompts..."
                  className="w-full px-3 py-2 rounded-md text-sm outline-none resize-none"
                  style={inputStyle}
                />
              </Field>

              {error && (
                <p className="text-xs" style={{ color: '#C4413A' }}>
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    resetState();
                  }}
                  className="px-4 py-2 rounded-md text-sm font-mono"
                  style={{ background: 'var(--dark-surface2)', color: 'var(--stone-400)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-md text-sm font-mono font-medium"
                  style={{ background: '#F5A623', color: '#fff', opacity: isPending ? 0.7 : 1 }}
                >
                  {isPending ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function ProviderCard({
  active,
  disabled = false,
  icon,
  label,
  description,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-4 text-left transition-colors"
      style={{
        background: disabled ? '#1F1D1A' : active ? '#F5A62312' : 'var(--dark-surface2)',
        border: `1px solid ${active ? '#F5A62355' : 'var(--dark-border)'}`,
        opacity: disabled ? 0.7 : 1,
      }}
      disabled={disabled}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color: active ? '#F5A623' : '#ECEAE4' }}>
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--stone-500)' }}>
        {description}
      </p>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ChooserRow({
  label,
  value,
  actionLabel,
  onAction,
  disabled,
  icon,
  compact = false,
}: {
  label: string;
  value: string;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-mono mb-1" style={{ color: 'var(--stone-400)' }}>
        {label}
      </label>
      <div
        className={`rounded-lg border ${compact ? 'p-3' : 'p-4'} flex items-center justify-between gap-3`}
        style={{ borderColor: 'var(--dark-border)', background: 'var(--dark-surface2)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2" style={{ color: '#ECEAE4' }}>
            {icon}
            <span className="text-sm truncate">{value}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="px-3 py-1.5 rounded-md text-xs font-mono shrink-0"
          style={{
            background: disabled ? '#2A2824' : 'var(--dark-surface)',
            color: disabled ? 'var(--stone-600)' : 'var(--stone-300)',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function RepoPlaceholder({ label }: { label: string }) {
  return (
    <div className="px-3 py-8 text-center text-[11px] font-mono" style={{ color: 'var(--stone-500)' }}>
      {label}
    </div>
  );
}

const inputStyle = {
  background: 'var(--dark-surface2)',
  border: '1px solid var(--dark-border)',
  color: '#ECEAE4',
} as const;
