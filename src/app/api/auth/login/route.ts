import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  const expectedPassword = process.env.VELA_PASSWORD;

  if (!expectedPassword) {
    // If no password is set, allow any login (dev mode)
    console.warn('VELA_PASSWORD not set — allowing any login');
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
