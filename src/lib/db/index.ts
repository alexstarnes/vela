import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Reuse one connection pool across Next.js dev-server recompiles. Without the
// globalThis cache every HMR rebuild re-runs this module and leaks a fresh
// pool (10 connections each) until the Supabase pooler hits its client limit.
const globalForDb = globalThis as unknown as {
  velaDbClient?: ReturnType<typeof postgres>;
};

// prepare: false is required for Supabase Supavisor (transaction-mode pooler)
const client =
  globalForDb.velaDbClient ??
  postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 10,
    idle_timeout: 30,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.velaDbClient = client;
}

export const db = drizzle(client, { schema });

export type Database = typeof db;
