import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { invariant } from '@/lib/invariant';
import * as schema from './schema';

const clientHolder: { value: ReturnType<typeof buildDb> | null } = { value: null };

function buildDb() {
  const url = process.env.DATABASE_URL;
  invariant(typeof url === 'string' && url.length > 0, 'DATABASE_URL is not set');
  // max: 1 — serverless functions must not hoard pooled connections.
  return drizzle(postgres(url, { max: 1, prepare: false }), { schema });
}

export function getDb() {
  if (!clientHolder.value) {
    clientHolder.value = buildDb();
  }
  return clientHolder.value;
}
