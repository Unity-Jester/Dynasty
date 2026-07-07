import 'server-only';
import { and, eq, lte } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { nflGames } from '@/server/schema';
import { invariant } from '@/lib/invariant';

// One NFL team plays at most once per week, so a season/week slice of
// nfl_games has exactly (# teams) rows — 32 in a modern season. 40 is a
// named upper bound (Rule 2/3) with headroom for e.g. an International Series
// week's oddities, never a real limit; exceeding it is an assertion failure,
// not a silent truncation.
const MAX_GAMES_PER_WEEK = 40;

// The seasons we host and the NFL's regular-season + playoff week range. These
// bound the (season, week) inputs so a stale or hostile caller can't provoke a
// full-table scan (Rule 3) and so the returned slice is meaningfully small.
const MIN_SEASON = 2020;
const MAX_SEASON = 2050;
const MIN_WEEK = 1;
const MAX_WEEK = 18;

function assertSeasonWeek(season: number, week: number): void {
  invariant(
    Number.isInteger(season) && season >= MIN_SEASON && season <= MAX_SEASON,
    `season ${season} is outside the hosted range [${MIN_SEASON}, ${MAX_SEASON}]`,
  );
  invariant(
    Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK,
    `week ${week} is outside the NFL range [${MIN_WEEK}, ${MAX_WEEK}]`,
  );
}

/**
 * The set of NFL team codes whose game for (season, week) has already kicked
 * off as of `now`. A player on one of these teams is locked: the lineup
 * validator forbids moving that player into or out of a starter slot.
 *
 * Bounded: at most MAX_GAMES_PER_WEEK rows are read (a full week's slate);
 * the DB filters to kickoff <= now so the set only grows across a game day.
 */
export async function getLockedNflTeams(
  season: number,
  week: number,
  now: Date,
): Promise<ReadonlySet<string>> {
  assertSeasonWeek(season, week);
  invariant(!Number.isNaN(now.getTime()), 'now is an invalid Date');

  const rows = await getDb()
    .select({ nflTeam: nflGames.nflTeam })
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week), lte(nflGames.kickoff, now)))
    .limit(MAX_GAMES_PER_WEEK);
  invariant(rows.length <= MAX_GAMES_PER_WEEK, 'locked-team query exceeded its bound');

  const locked = new Set<string>();
  for (const row of rows) {
    locked.add(row.nflTeam);
  }
  return locked;
}

/**
 * Kickoff time (ISO string) for every NFL team playing in (season, week),
 * keyed by team code. The lineup UI reads this to render per-player lock
 * countdowns; the action reads getLockedNflTeams instead (it only needs the
 * already-locked set at save time). Same single query shape as above.
 */
export async function getKickoffs(season: number, week: number): Promise<ReadonlyMap<string, string>> {
  assertSeasonWeek(season, week);

  const rows = await getDb()
    .select({ nflTeam: nflGames.nflTeam, kickoff: nflGames.kickoff })
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week)))
    .limit(MAX_GAMES_PER_WEEK);
  invariant(rows.length <= MAX_GAMES_PER_WEEK, 'kickoffs query exceeded its bound');

  const kickoffs = new Map<string, string>();
  for (const row of rows) {
    kickoffs.set(row.nflTeam, row.kickoff.toISOString());
  }
  return kickoffs;
}
