import { db } from '@/lib/db';
import { agents } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { RuntimeAgentName } from './index';

export async function getRuntimeAgentRow(name: RuntimeAgentName) {
  return db.query.agents.findFirst({
    where: and(
      eq(agents.name, name),
      eq(agents.agentKind, 'runtime'),
      isNull(agents.projectId),
    ),
  });
}
