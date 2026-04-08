import { NextRequest, NextResponse } from 'next/server';
import { validateWorkspace } from '@/lib/helper/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await validateWorkspace(body.path);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to validate workspace' },
      { status: 400 },
    );
  }
}
