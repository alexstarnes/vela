import { NextRequest, NextResponse } from 'next/server';
import { listGitHubBranches } from '@/lib/github/oauth';

export async function GET(request: NextRequest) {
  try {
    const owner = request.nextUrl.searchParams.get('owner');
    const repo = request.nextUrl.searchParams.get('repo');

    if (!owner || !repo) {
      return NextResponse.json(
        { ok: false, error: 'owner and repo are required' },
        { status: 400 },
      );
    }

    const branches = await listGitHubBranches(owner, repo);
    return NextResponse.json({ ok: true, data: branches });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to load branches' },
      { status: 400 },
    );
  }
}
