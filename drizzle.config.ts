import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    // DIRECT_URL bypasses the pooler for migrations (required for Supabase)
    ...(process.env.DIRECT_URL ? { directUrl: process.env.DIRECT_URL } : {}),
  },
});
