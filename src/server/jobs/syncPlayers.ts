import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { players } from '@/server/schema';
import { getAllPlayers } from '@/lib/sleeper';
import { mapSleeperPlayers, PlayerRow } from '@/engine/playerSync';
import { invariant } from '@/lib/invariant';

const BATCH_SIZE = 500;
const MAX_BATCHES = 60; // 30k cap / 500 — matches MAX_SLEEPER_PLAYERS

export type SyncResult =
  | { ok: true; upserted: number; skipped: number; deduped: number }
  | { ok: false; error: string };

// Glue-level dedupe, not engine logic: a duplicate sleeperId within one
// INSERT ... ON CONFLICT statement makes Postgres reject the whole batch
// ("ON CONFLICT DO UPDATE command cannot affect row a second time"). Last
// entry for a given id wins. Kept here (not in the engine) because it's
// purely a batching/DB concern, not a business rule about player data.
function dedupeRows(rows: PlayerRow[]): { deduped: PlayerRow[]; dedupedCount: number } {
  const byId = new Map<string, PlayerRow>();
  for (const row of rows) {
    byId.set(row.sleeperId, row);
  }
  const deduped = Array.from(byId.values());
  return { deduped, dedupedCount: rows.length - deduped.length };
}

export async function syncPlayers(): Promise<SyncResult> {
  const raw = await getAllPlayers();
  const mapped = mapSleeperPlayers(raw);
  // All-or-nothing on engine failure is intentional: the tripwire in
  // mapSleeperPlayers only fires on systemic corruption (e.g. a Sleeper
  // schema change), and partially upserting a corrupted payload would be
  // worse than doing nothing — better to fail loudly and retry later.
  if (!mapped.ok) {
    return { ok: false, error: mapped.error };
  }

  const { deduped, dedupedCount } = dedupeRows(mapped.value.rows);

  const db = getDb();
  const batchCount = Math.ceil(deduped.length / BATCH_SIZE);
  invariant(batchCount <= MAX_BATCHES, `player sync exceeds MAX_BATCHES (${batchCount})`);

  let upserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = deduped.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    await db
      .insert(players)
      .values(batch)
      .onConflictDoUpdate({
        target: players.sleeperId,
        set: {
          fullName: sql`excluded.full_name`,
          position: sql`excluded.position`,
          nflTeam: sql`excluded.nfl_team`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          yearsExp: sql`excluded.years_exp`,
          updatedAt: sql`now()`,
        },
      });
    upserted += batch.length;
  }
  invariant(upserted === deduped.length, 'upserted count did not match deduped row count');

  return { ok: true, upserted, skipped: mapped.value.skipped, deduped: dedupedCount };
}
