import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildGitHubAuthorizeUrl } from '@/lib/github/oauth';

const STATE_COOKIE = 'vela_github_oauth_state';
const POPUP_COOKIE = 'vela_github_oauth_popup';

function getRedirectUri(request: NextRequest) {
  const appUrl = process.env.APP_URL || request.nextUrl.origin;
  return new URL('/api/github/callback', appUrl).toString();
}

export async function GET(request: NextRequest) {
  const popup = request.nextUrl.searchParams.get('popup') === '1';
  const state = randomUUID();
  const redirect = buildGitHubAuthorizeUrl({
    state,
    redirectUri: getRedirectUri(request),
  });

  const response = NextResponse.redirect(redirect);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  response.cookies.set(POPUP_COOKIE, popup ? '1' : '0', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });

  return response;
}
