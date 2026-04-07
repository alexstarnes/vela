export const dynamic = 'force-dynamic';

import { listModelConfigs } from '@/lib/actions/model-configs';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const models = await listModelConfigs();

  const ollamaTunnelUrl = process.env.OLLAMA_TUNNEL_URL ?? '';

  return (
    <SettingsClient
      models={models}
      ollamaTunnelUrl={ollamaTunnelUrl}
    />
  );
}
