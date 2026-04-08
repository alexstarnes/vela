import { NextResponse } from 'next/server';
import { getHelperHealth } from '@/lib/helper/client';

export async function GET() {
  const health = await getHelperHealth();
  return NextResponse.json({
    ok: health.ok,
    data: health,
  });
}
