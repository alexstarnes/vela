import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getWorkspaceDevServerStatus,
  startWorkspaceDevServer,
  stopWorkspaceDevServer,
} from '@/lib/helper/client';

async function resolveWorkspacePath(projectId: string): Promise<string | NextResponse> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (!project.workspacePath) {
    return NextResponse.json(
      { error: 'Project has no connected workspace' },
      { status: 400 },
    );
  }
  return project.workspacePath;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspacePath = await resolveWorkspacePath(id);
  if (workspacePath instanceof NextResponse) return workspacePath;

  try {
    const status = await getWorkspaceDevServerStatus({ workspacePath });
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Helper unreachable' },
      { status: 502 },
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspacePath = await resolveWorkspacePath(id);
  if (workspacePath instanceof NextResponse) return workspacePath;

  try {
    const status = await startWorkspaceDevServer({ workspacePath });
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start dev server' },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspacePath = await resolveWorkspacePath(id);
  if (workspacePath instanceof NextResponse) return workspacePath;

  try {
    const result = await stopWorkspaceDevServer({ workspacePath });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to stop dev server' },
      { status: 502 },
    );
  }
}
