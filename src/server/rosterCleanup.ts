import 'server-only';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { lineupSlots } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import {
  fetchLockedNflTeams,
  fetchPlayerNflTeams,
  type DbConn,
} from '@/server/trades/tradeQueries';

// The last NFL week the cleanup window can extend to; a finished season yields
// an empty window rather than clobbering the whole season's lineup history.
const NFL_FINAL_WEEK = 18;
// Player-list bound: the trade payload caps each side at 15 players (30 total
// moves); a waiver award drops at most one. fetchPlayerNflTeams enforces the
// same 30 cap, so this must not exceed it (Rule 2).
const MAX_CLEANUP_PLAYERS = 30;
// Starter-slot rows per team-week (~30 max in a large league); the cleanup
// UPDATE touches at most teamCount * 18 weeks * this (Rule 3).
const MAX_SLOTS_PER_TEAM_WEEK = 30;
// Sanity cap on the team list; trades pass 2, a waiver run passes 1.
const MAX_CLEANUP_TEAMS = 40;

export type ClearDroppedSlotsArgs = {
  /** Teams whose lineups may reference a dropped player. */
  readonly teamIds: readonly string[];
  /** Players leaving these teams (traded away / waiver-dropped). */
  readonly droppedPlayerIds: readonly string[];
  readonly currentSeason: number;
  readonly currentWeek: number;
  /** Clock for the current-week lock check — pass the transaction's `now`. */
  readonly now: Date;
};

// Nulls (never deletes) every lineup slot on `teamIds` referencing a dropped
// player, for the CURRENT season's current-or-future weeks — no ghost
// starters. "No ghost starters" applies only to slots that can still be
// CHANGED: a current-week slot whose player's NFL game has already kicked off
// is history-in-progress, exactly like a past week — the points were earned in
// the old lineup and must survive a scoreWeek re-run (Sleeper parity; matches
// the lineup editor's lock semantics in locks.ts). So:
//   - weeks > currentWeek: always nulled;
//   - week == currentWeek: nulled only for players whose game has NOT locked,
//     with the locked set derived through the SAME `conn` as every other write.
// Past weeks stay untouched. The week window is explicit and bounded; a
// finished season (currentWeek = lastRegularWeek + 1 via currentTradeWeek)
// yields an empty window instead of nulling the whole season.
//
// Extracted verbatim from executeTrade.cleanLineupSlots (Phase 7 Task 6) so the
// trade path and the waiver path share ONE lock-aware cleanup. Trades pass both
// trading teams + the moved players; a waiver run passes the claiming team + the
// single dropped player.
export async function clearDroppedLineupSlots(
  conn: DbConn,
  args: ClearDroppedSlotsArgs,
): Promise<void> {
  const { teamIds, droppedPlayerIds, currentSeason, currentWeek, now } = args;
  if (droppedPlayerIds.length === 0 || currentWeek > NFL_FINAL_WEEK) {
    return;
  }
  invariant(teamIds.length <= MAX_CLEANUP_TEAMS, 'cleanup team list exceeded its bound');
  invariant(droppedPlayerIds.length <= MAX_CLEANUP_PLAYERS, 'cleanup player list exceeded its bound');

  if (currentWeek < NFL_FINAL_WEEK) {
    await clearSlots(conn, teamIds, currentSeason, {
      weekFrom: currentWeek + 1,
      weekTo: NFL_FINAL_WEEK,
      playerIds: droppedPlayerIds,
    });
  }

  const unlockedIds = await unlockedDroppedPlayers(conn, currentSeason, currentWeek, droppedPlayerIds, now);
  if (unlockedIds.length === 0) {
    return;
  }
  await clearSlots(conn, teamIds, currentSeason, {
    weekFrom: currentWeek,
    weekTo: currentWeek,
    playerIds: unlockedIds,
  });
}

// Dropped players whose current-week slots are still editable: their NFL team
// has no kicked-off game this week (free agents — nflTeam null — never lock).
async function unlockedDroppedPlayers(
  conn: DbConn,
  currentSeason: number,
  currentWeek: number,
  droppedPlayerIds: readonly string[],
  now: Date,
): Promise<string[]> {
  const locked = await fetchLockedNflTeams(conn, currentSeason, currentWeek, now);
  const nflTeamById = await fetchPlayerNflTeams(conn, droppedPlayerIds);
  return droppedPlayerIds.filter((playerId) => {
    const nflTeam = nflTeamById.get(playerId) ?? null;
    return nflTeam === null || !locked.has(nflTeam);
  });
}

async function clearSlots(
  conn: DbConn,
  teamIds: readonly string[],
  season: number,
  window: { weekFrom: number; weekTo: number; playerIds: readonly string[] },
): Promise<void> {
  invariant(window.weekFrom <= window.weekTo, 'cleanup week window is inverted');
  invariant(window.playerIds.length > 0, 'cleanup called with no players');
  const cap = teamIds.length * NFL_FINAL_WEEK * MAX_SLOTS_PER_TEAM_WEEK;
  const cleared = await conn
    .update(lineupSlots)
    .set({ playerId: null })
    .where(
      and(
        inArray(lineupSlots.teamId, [...teamIds]),
        eq(lineupSlots.season, season),
        gte(lineupSlots.week, window.weekFrom),
        lte(lineupSlots.week, window.weekTo),
        inArray(lineupSlots.playerId, [...window.playerIds]),
      ),
    )
    .returning({ id: lineupSlots.id });
  invariant(cleared.length <= cap, 'lineup cleanup exceeded its bound');
}
