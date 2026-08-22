/**
 * Side-effect env loader for standalone bot processes. Must be the FIRST
 * import so app modules (e.g. @/lib/db) see the env at their module-load
 * time — ES module bodies execute depth-first before the importer's body.
 */
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
