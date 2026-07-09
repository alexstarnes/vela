import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  const expectedPassword = process.env.VELA_PASSWORD;

  if (!expectedPassword) {
    // Fail closed in production: an unset password must never mean open access.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Authentication is not configured. Set VELA_PASSWORD and restart.' },
        { status: 503 },
      );
    }
    console.warn('VELA_PASSWORD not set — allowing any login (development only)');
  } else if (password !== expectedPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = await createSessionToken(password || '');

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  });

  return response;
}
