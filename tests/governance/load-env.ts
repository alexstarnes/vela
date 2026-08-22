/**
 * Load .env and .env.local before any app module reads process.env.
 * Import this FIRST in every governance script.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const file of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // File absent — fine.
  }
}
