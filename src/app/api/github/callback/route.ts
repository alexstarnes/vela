import { NextRequest, NextResponse } from 'next/server';
import { exchangeGitHubCode, saveGitHubConnection } from '@/lib/github/oauth';

const STATE_COOKIE = 'vela_github_oauth_state';
const POPUP_COOKIE = 'vela_github_oauth_popup';

function getRedirectUri(request: NextRequest) {
  const appUrl = process.env.APP_URL || request.nextUrl.origin;
  return new URL('/api/github/callback', appUrl).toString();
}

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const popup = request.cookies.get(POPUP_COOKIE)?.value === '1';

  const clearCookies = (response: NextResponse) => {
    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(POPUP_COOKIE);
    return response;
  };

  if (!state || !code || !expectedState || state !== expectedState) {
    const response = popup
      ? new NextResponse(
          `<html><body><script>window.opener?.postMessage({type:'vela:github-connect-error'}, window.location.origin); window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' }, status: 400 },
        )
      : NextResponse.redirect(new URL('/projects?github=error', request.url));
    return clearCookies(response);
  }

  try {
    const tokens = await exchangeGitHubCode({
      code,
      redirectUri: getRedirectUri(request),
    });
    await saveGitHubConnection(tokens);

    const response = popup
      ? new NextResponse(
          `<html><body><script>window.opener?.postMessage({type:'vela:github-connected'}, window.location.origin); window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' } },
        )
      : NextResponse.redirect(new URL('/projects?github=connected', request.url));

    return clearCookies(response);
  } catch {
    const response = popup
      ? new NextResponse(
          `<html><body><script>window.opener?.postMessage({type:'vela:github-connect-error'}, window.location.origin); window.close();</script></body></html>`,
          { headers: { 'Content-Type': 'text/html' }, status: 400 },
        )
      : NextResponse.redirect(new URL('/projects?github=error', request.url));
    return clearCookies(response);
  }
}
