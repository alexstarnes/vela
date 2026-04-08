import { NextRequest, NextResponse } from 'next/server';
import { pickDirectory } from '@/lib/helper/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;
    const selection = await pickDirectory(prompt);
    return NextResponse.json({ ok: true, data: selection });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to pick directory' },
      { status: 400 },
    );
  }
}
