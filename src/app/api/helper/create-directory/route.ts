import { NextRequest, NextResponse } from 'next/server';
import { createDirectory } from '@/lib/helper/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const selection = await createDirectory({
      parentPath: body.parentPath,
      folderName: body.folderName,
    });
    return NextResponse.json({ ok: true, data: selection });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unable to create directory' },
      { status: 400 },
    );
  }
}
