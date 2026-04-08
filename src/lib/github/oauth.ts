import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { githubConnections, projects } from '@/lib/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/security/secrets';

interface TokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

function getGitHubClientId(): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error('GITHUB_CLIENT_ID is not set');
  return clientId;
}

function getGitHubClientSecret(): string {
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientSecret) throw new Error('GITHUB_CLIENT_SECRET is not set');
  return clientSecret;
}

export function buildGitHubAuthorizeUrl(params: {
  state: string;
  redirectUri: string;
}) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', getGitHubClientId());
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', 'repo read:user');
  url.searchParams.set('state', params.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function exchangeToken(params: Record<string, string>) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: getGitHubClientId(),
      client_secret: getGitHubClientSecret(),
      ...params,
    }),
  });

  const data = (await response.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || 'GitHub token exchange failed');
  }

  return data;
}

export async function exchangeGitHubCode(params: {
  code: string;
  redirectUri: string;
}) {
  return exchangeToken({
    code: params.code,
    redirect_uri: params.redirectUri,
  });
}

export async function refreshGitHubToken(params: {
  refreshToken: string;
}) {
  return exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'vela-app',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to load GitHub user profile');
  }

  return (await response.json()) as GitHubUser;
}

function tokenExpiryFromDuration(duration?: number) {
  return duration ? new Date(Date.now() + duration * 1000) : null;
}

export async function saveGitHubConnection(tokens: TokenResponse) {
  const user = await fetchGitHubUser(tokens.access_token);

  const payload = {
    provider: 'github' as const,
    githubUserId: String(user.id),
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    accessTokenEncrypted: encryptSecret(tokens.access_token),
    refreshTokenEncrypted: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    tokenType: tokens.token_type ?? null,
    scope: tokens.scope ?? null,
    tokenExpiresAt: tokenExpiryFromDuration(tokens.expires_in),
    refreshTokenExpiresAt: tokenExpiryFromDuration(tokens.refresh_token_expires_in),
    status: 'active',
    updatedAt: new Date(),
  };

  const existing = await db.query.githubConnections.findFirst({
    where: eq(githubConnections.githubUserId, String(user.id)),
  });

  if (existing) {
    const [connection] = await db
      .update(githubConnections)
      .set(payload)
      .where(eq(githubConnections.id, existing.id))
      .returning();

    await db
      .update(projects)
      .set({ connectionStatus: 'connected', updatedAt: new Date(), lastValidatedAt: new Date() })
      .where(eq(projects.githubConnectionId, existing.id));

    return connection;
  }

  const [connection] = await db
    .insert(githubConnections)
    .values(payload)
    .returning();
  return connection;
}

export async function getActiveGitHubConnection() {
  return db.query.githubConnections.findFirst({
    where: eq(githubConnections.status, 'active'),
    orderBy: (table) => [desc(table.updatedAt)],
  });
}

async function markConnectionAttention(id: string) {
  await db
    .update(githubConnections)
    .set({ status: 'attention_required', updatedAt: new Date() })
    .where(eq(githubConnections.id, id));

  await db
    .update(projects)
    .set({ connectionStatus: 'attention_required', updatedAt: new Date() })
    .where(eq(projects.githubConnectionId, id));
}

export async function ensureFreshGitHubAccessToken() {
  const connection = await getActiveGitHubConnection();
  if (!connection) return null;

  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return {
      connection,
      accessToken: decryptSecret(connection.accessTokenEncrypted),
    };
  }

  if (!connection.refreshTokenEncrypted) {
    await markConnectionAttention(connection.id);
    throw new Error('GitHub connection expired and needs to be reconnected');
  }

  const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
  const refreshed = await refreshGitHubToken({ refreshToken });
  const saved = await saveGitHubConnection(refreshed);

  return {
    connection: saved,
    accessToken: decryptSecret(saved.accessTokenEncrypted),
  };
}

export async function githubApi<T>(pathname: string) {
  const fresh = await ensureFreshGitHubAccessToken();
  if (!fresh) {
    throw new Error('GitHub is not connected');
  }

  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${fresh.accessToken}`,
      'User-Agent': 'vela-app',
    },
    cache: 'no-store',
  });

  if (response.status === 401) {
    await markConnectionAttention(fresh.connection.id);
    throw new Error('GitHub connection is no longer authorized');
  }

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${pathname}`);
  }

  return (await response.json()) as T;
}

export async function listGitHubRepositories(query?: string) {
  const repos = await githubApi<Array<{
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    clone_url: string;
    default_branch: string;
    private: boolean;
  }>>('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');

  const filtered = query
    ? repos.filter((repo) => repo.full_name.toLowerCase().includes(query.toLowerCase()))
    : repos;

  return filtered.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    private: repo.private,
  }));
}

export async function listGitHubBranches(owner: string, repo: string) {
  const branches = await githubApi<Array<{ name: string }>>(
    `/repos/${owner}/${repo}/branches?per_page=100`,
  );
  return branches.map((branch) => branch.name);
}

export async function disconnectGitHubConnection(id?: string) {
  const connection = id
    ? await db.query.githubConnections.findFirst({ where: eq(githubConnections.id, id) })
    : await getActiveGitHubConnection();

  if (!connection) {
    return;
  }

  await db
    .update(githubConnections)
    .set({ status: 'disconnected', updatedAt: new Date() })
    .where(eq(githubConnections.id, connection.id));

  await db
    .update(projects)
    .set({ connectionStatus: 'attention_required', updatedAt: new Date() })
    .where(eq(projects.githubConnectionId, connection.id));
}
