import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { players, statLines } from '@/server/schema';
import { getNFLState, getWeekStats } from '@/lib/sleeper';
import { parseSleeperStats, type StatLineInput } from '@/engine/stats/parseSleeperStats';
import { invariant } from '@/lib/invariant';

// Bounded read of the player universe: same pattern/cap as sleeperImport's
// fetchKnownPlayerIds (MAX_KNOWN_PLAYERS) — only sleeperId is needed to build
// the known-id set the stats parser filters against.
const MAX_KNOWN_PLAYERS = 30000;
// Batched upserts: 500 rows/statement, 20 batches = 10k line cap (matches
// parseSleeperStats' MAX_STAT_ENTRIES).
const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

const MIN_SEASON = 2020;
const MAX_SEASON = 2050;
const MIN_WEEK = 1;
const MAX_WEEK = 18;

export type PollResult =
  | { ok: true; season: number; week: number; upserted: number; skippedUnknown: number; skippedInvalid: number }
  | { ok: true; skipped: 'offseason' }
  | { ok: false; error: string };

// Tags a fetch failure with which endpoint threw, mirroring sleeperImport's
// `labeled` helper — the shared fetcher reports only status text, identical
// across endpoints, so labeling lives at the call site.
async function labeled<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`${label}: ${message}`);
  }
}

// Bounded read of players.sleeperId, same cap/pattern as sleeperImport.
async function fetchKnownPlayerIds(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ sleeperId: players.sleeperId })
    .from(players)
    .limit(MAX_KNOWN_PLAYERS);
  invariant(rows.length <= MAX_KNOWN_PLAYERS, 'player universe exceeds the bounded read');
  return new Set(rows.map((r) => r.sleeperId));
}

// Resolves which season/week to poll when the caller didn't pin one down:
// asks Sleeper's live NFL state and only proceeds during the regular season.
// Polling outside the season is a no-op, not an error — there's simply
// nothing to backfill, and callers (the cron workflow) should not treat an
// offseason poll as a failure.
async function resolveSeasonWeek(
  season: number | undefined,
  week: number | undefined,
): Promise<{ season: number; week: number } | { skipped: 'offseason' }> {
  if (season !== undefined && week !== undefined) {
    return { season, week };
  }
  const state = await labeled('nfl state', getNFLState());
  if (state.season_type !== 'regular') {
    return { skipped: 'offseason' };
  }
  return { season: Number(state.season), week: state.week };
}

// Batched upsert of parsed stat lines. `setWhere` scopes the ON CONFLICT
// UPDATE so it only fires when the existing row's source is NOT 'nflverse' —
// decision #3: nflverse rows (the authoritative post-hoc source) are never
// overwritten by a later Sleeper poll. Returns the count actually upserted.
async function upsertLines(
  lines: readonly StatLineInput[],
  season: number,
  week: number,
): Promise<number> {
  const batchCount = Math.ceil(lines.length / BATCH_SIZE);
  invariant(batchCount <= MAX_BATCHES, `stat line upsert exceeds MAX_BATCHES (${batchCount})`);

  const db = getDb();
  let upserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = lines.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    const rows = batch.map((line) => ({
      playerId: line.playerId,
      season,
      week,
      stats: line.stats,
      source: 'sleeper' as const,
    }));
    await db
      .insert(statLines)
      .values(rows)
      .onConflictDoUpdate({
        target: [statLines.playerId, statLines.season, statLines.week],
        set: {
          stats: sql`excluded.stats`,
          updatedAt: sql`now()`,
          source: sql`'sleeper'`,
        },
        setWhere: sql`${statLines.source} <> 'nflverse'`,
      });
    upserted += batch.length;
  }
  invariant(upserted === lines.length, 'upserted count did not match lines emitted');
  return upserted;
}

function assertSeasonWeekWindow(season: number, week: number, label: string): void {
  invariant(Number.isInteger(season) && season >= MIN_SEASON && season <= MAX_SEASON, `${label} season is outside the sane window`);
  invariant(Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK, `${label} week is outside the sane window`);
}

// Fetch phase: player universe + raw stats payload for the resolved
// season/week. Split out of pollStats purely to keep complexity under the
// Rule 1 ceiling; errors from either fetch are reported the same way.
async function fetchStatsInputs(
  season: number,
  week: number,
): Promise<{ ok: true; knownPlayerIds: Set<string>; rawStats: unknown } | { ok: false; error: string }> {
  try {
    const knownPlayerIds = await labeled('player universe', fetchKnownPlayerIds());
    const rawStats = await labeled('week stats', getWeekStats(season, week));
    return { ok: true, knownPlayerIds, rawStats };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

export async function pollStats(season?: number, week?: number): Promise<PollResult> {
  if (season !== undefined && week !== undefined) {
    assertSeasonWeekWindow(season, week, 'requested');
  }

  let resolved: { season: number; week: number } | { skipped: 'offseason' };
  try {
    resolved = await resolveSeasonWeek(season, week);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
  if ('skipped' in resolved) {
    return { ok: true, skipped: 'offseason' };
  }
  const { season: resolvedSeason, week: resolvedWeek } = resolved;
  assertSeasonWeekWindow(resolvedSeason, resolvedWeek, 'resolved');

  const inputs = await fetchStatsInputs(resolvedSeason, resolvedWeek);
  if (!inputs.ok) {
    return { ok: false, error: inputs.error };
  }

  const parsed = parseSleeperStats(inputs.rawStats, { knownPlayerIds: inputs.knownPlayerIds });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const upserted = await upsertLines(parsed.value.lines, resolvedSeason, resolvedWeek);

  return {
    ok: true,
    season: resolvedSeason,
    week: resolvedWeek,
    upserted,
    skippedUnknown: parsed.value.skippedUnknown,
    skippedInvalid: parsed.value.skippedInvalid,
  };
}
