'use server';

import { db } from '@/lib/db';

export async function listModelConfigs() {
  return db.query.modelConfigs.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}
