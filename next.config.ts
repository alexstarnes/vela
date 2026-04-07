import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Exclude mastra directory from Next.js compilation
  // Mastra runs separately via `pnpm dev:mastra`
  serverExternalPackages: [
    '@mastra/core',
    '@mastra/libsql',
    '@mastra/duckdb',
    '@mastra/loggers',
    '@mastra/evals',
    '@mastra/memory',
    '@mastra/observability',
    'mastra',
  ],
};

export default nextConfig;
