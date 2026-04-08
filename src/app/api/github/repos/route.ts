import { NextRequest, NextResponse } from 'next/server';
import { listGitHubRepositories } from '@/lib/github/oauth';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q') || undefined;
    const repos = await listGitHubRepositories(query);
    return NextResponse.json({ ok: true, data: repos });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load repositories' },
      { status: 400 },
    );
  }
}
