import { NextResponse } from 'next/server';
import { disconnectGitHubConnection, getActiveGitHubConnection } from '@/lib/github/oauth';

export async function GET() {
  const connection = await getActiveGitHubConnection();

  return NextResponse.json({
    ok: true,
    data: connection
      ? {
          connected: connection.status === 'active',
          id: connection.id,
          login: connection.login,
          name: connection.name,
          avatarUrl: connection.avatarUrl,
          status: connection.status,
          tokenExpiresAt: connection.tokenExpiresAt,
        }
      : {
          connected: false,
          status: 'disconnected',
        },
  });
}

export async function DELETE() {
  await disconnectGitHubConnection();
  return NextResponse.json({ ok: true });
}
