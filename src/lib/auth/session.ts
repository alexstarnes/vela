const SESSION_COOKIE = 'vela_session';
const SALT = 'vela-auth-salt-v1';

// Edge-compatible hash using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(SALT + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken(password: string): Promise<string> {
  return hashPassword(password);
}

export async function verifySessionToken(token: string, password: string): Promise<boolean> {
  const expected = await hashPassword(password);
  return token === expected;
}

export { SESSION_COOKIE };
