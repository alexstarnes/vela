/**
 * GET /api/models — List available models from model_configs + live Ollama check.
 */

import { NextResponse } from 'next/server';
import { listAvailableModels } from '@/lib/mastra/router';

export async function GET() {
  try {
    const models = await listAvailableModels();
    return NextResponse.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/models] Error:', message);
    return NextResponse.json(
      { error: 'Failed to list models', message },
      { status: 500 },
    );
  }
}
