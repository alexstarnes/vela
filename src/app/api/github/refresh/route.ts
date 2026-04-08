import { NextResponse } from 'next/server';
import { ensureFreshGitHubAccessToken, getActiveGitHubConnection } from '@/lib/github/oauth';

export async function POST() {
  try {
    const fresh = await ensureFreshGitHubAccessToken();
    const connection = fresh?.connection ?? (await getActiveGitHubConnection());
    return NextResponse.json({
      ok: true,
      data: connection
        ? {
            connected: connection.status === 'active',
            id: connection.id,
            login: connection.login,
            status: connection.status,
            tokenExpiresAt: connection.tokenExpiresAt,
          }
        : { connected: false, status: 'disconnected' },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to refresh GitHub connection' },
      { status: 400 },
    );
  }
}
