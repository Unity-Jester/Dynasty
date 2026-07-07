import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { lineupSlots, matchups, seasons, statLines } from '@/server/schema';
import { LeagueSettingsSchema } from '@/engine/settings';
import { roundPoints, scoreLineup, type ScoringBonus } from '@/engine/scoring/score';
import { invariant } from '@/lib/invariant';

// --- windows (mirrors pollStats/reconcileStats) ---
const MIN_SEASON = 2020;
const MAX_SEASON = 2050;
const MIN_WEEK = 1;
const MAX_WEEK = 18;

// --- bounded reads (Rule 2/3) ---
// Distinct leagues with a matchup in one (season, week). Even at platform
// scale this is small; 50 is a hard cap with generous headroom.
const MAX_LEAGUES = 50;
// One league-week's pairings: teamCount(32)/2 = 16 rows max; 20 is headroom.
const MAX_MATCHUPS = 20;
// Lineup rows across all teams in a league-week: teamCount(32) * starter slots
// (~30 max) = 960; the involved-teams set is bounded by MAX_MATCHUPS * 2, so
// this cap = teams * 30.
const MAX_LINEUP_ROWS_PER_TEAM = 30;
// One (season, week) stat slate: matches reconcileStats' MAX_EXISTING_LINES.
const MAX_STAT_LINES = 6000;

// Sleeper's empty-slot sentinel — scoreLineup treats it (and any id with no
// stat line) as a 0-point slot, never an error. Used for null lineup entries.
const EMPTY_SLOT_SENTINEL = '0';

export type ScoreWeekSample = { matchupId: string; home: string; away: string };

export type ScoreWeekResult =
  | {
      ok: true;
      dryRun: boolean;
      leaguesScored: number;
      matchupsScored: number;
      skippedFinal: number;
      skippedInvalidSettings: number;
      teamsWithoutLineups: number;
      sample: ScoreWeekSample[];
    }
  | { ok: false; error: string };

function assertSeasonWeekWindow(season: number, week: number): void {
  invariant(
    Number.isInteger(season) && season >= MIN_SEASON && season <= MAX_SEASON,
    'scoreWeek season is outside the sane window',
  );
  invariant(
    Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK,
    'scoreWeek week is outside the sane window',
  );
}

type MatchupRow = {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  final: boolean;
};

type LineupRow = { teamId: string; slot: string; slotIndex: number; playerId: string | null };

type StatsByPlayer = ReadonlyMap<string, Readonly<Record<string, number>>>;

// Bounded DISTINCT read of leagues with a matchup in this (season, week).
async function fetchLeagueIds(season: number, week: number): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ leagueId: matchups.leagueId })
    .from(matchups)
    .where(and(eq(matchups.season, season), eq(matchups.week, week)))
    .limit(MAX_LEAGUES);
  invariant(rows.length <= MAX_LEAGUES, 'league count exceeded MAX_LEAGUES');
  return rows.map((r) => r.leagueId);
}

// Latest season row for a league (highest year), or null. settings is parsed
// by the caller so one bad league can be skipped, not thrown.
async function fetchLatestSettings(leagueId: string): Promise<unknown | null> {
  const [row] = await getDb()
    .select({ settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    // "Latest" = highest year; mirrors lineup.ts fetchLatestSeason.
    .orderBy(desc(seasons.year))
    .limit(1);
  return row?.settings ?? null;
}

async function fetchMatchups(leagueId: string, season: number, week: number): Promise<MatchupRow[]> {
  const rows = await getDb()
    .select({
      id: matchups.id,
      leagueId: matchups.leagueId,
      homeTeamId: matchups.homeTeamId,
      awayTeamId: matchups.awayTeamId,
      final: matchups.final,
    })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.season, season), eq(matchups.week, week)))
    .limit(MAX_MATCHUPS);
  invariant(rows.length <= MAX_MATCHUPS, 'matchup count exceeded MAX_MATCHUPS');
  return rows;
}

// All lineup rows for the involved teams in this (season, week), grouped by
// team and ordered (slot, slotIndex) so the starters array is deterministic.
async function fetchLineupsByTeam(
  teamIds: readonly string[],
  season: number,
  week: number,
): Promise<Map<string, LineupRow[]>> {
  const byTeam = new Map<string, LineupRow[]>();
  if (teamIds.length === 0) return byTeam;
  const cap = teamIds.length * MAX_LINEUP_ROWS_PER_TEAM;
  const rows = await getDb()
    .select({
      teamId: lineupSlots.teamId,
      slot: lineupSlots.slot,
      slotIndex: lineupSlots.slotIndex,
      playerId: lineupSlots.playerId,
    })
    .from(lineupSlots)
    .where(
      and(
        inArray(lineupSlots.teamId, teamIds as string[]),
        eq(lineupSlots.season, season),
        eq(lineupSlots.week, week),
      ),
    )
    .orderBy(asc(lineupSlots.slot), asc(lineupSlots.slotIndex))
    .limit(cap);
  invariant(rows.length <= cap, 'lineup row count exceeded its bound');
  for (const row of rows) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push(row);
    byTeam.set(row.teamId, list);
  }
  return byTeam;
}

async function fetchStatsByPlayer(season: number, week: number): Promise<Map<string, Record<string, number>>> {
  const rows = await getDb()
    .select({ playerId: statLines.playerId, stats: statLines.stats })
    .from(statLines)
    .where(and(eq(statLines.season, season), eq(statLines.week, week)))
    .limit(MAX_STAT_LINES);
  invariant(rows.length <= MAX_STAT_LINES, 'stat line count exceeded MAX_STAT_LINES');
  const byPlayer = new Map<string, Record<string, number>>();
  for (const row of rows) {
    // stats is jsonb (our own write); narrow defensively — absent keys score 0.
    byPlayer.set(row.playerId, (row.stats ?? {}) as Record<string, number>);
  }
  return byPlayer;
}

// Score one team side: its ordered lineup rows -> starters array (null slot ->
// sentinel) -> scoreLineup -> clean 2dp string. A team with ZERO lineup rows
// scores "0.00" and is flagged so the caller can count it once per team.
function scoreSide(
  lineups: Map<string, LineupRow[]>,
  teamId: string,
  rules: Readonly<Record<string, number>>,
  bonuses: readonly ScoringBonus[],
  statsByPlayer: StatsByPlayer,
): { points: string; hadLineup: boolean } {
  const rows = lineups.get(teamId);
  if (rows === undefined || rows.length === 0) {
    return { points: '0.00', hadLineup: false };
  }
  const starters = rows.map((r) => r.playerId ?? EMPTY_SLOT_SENTINEL);
  const { total } = scoreLineup(rules, bonuses, starters, statsByPlayer);
  return { points: roundPoints(total).toFixed(2), hadLineup: true };
}

// Guarded UPDATE of one matchup: writes both points + final ONLY while the row
// is not already final. The AND final = false guard makes a re-run idempotent;
// .returning row count tells us whether we won the guard. Individual guarded
// UPDATEs (not batched) are acceptable here — <=10 per league-week — mirroring
// reconcileStats' applyUpdates precedent (per-row UPDATEs under a bounded loop).
async function writeMatchup(
  matchupId: string,
  homePoints: string,
  awayPoints: string,
  finalize: boolean,
): Promise<boolean> {
  const updated = await getDb()
    .update(matchups)
    .set({ homePoints, awayPoints, final: finalize })
    .where(and(eq(matchups.id, matchupId), eq(matchups.final, false)))
    .returning({ id: matchups.id });
  return updated.length === 1;
}

type LeagueTally = {
  matchupsScored: number;
  skippedFinal: number;
  teamsWithoutLineups: number;
  sample: ScoreWeekSample[];
};

// Score + (optionally) write every matchup for one league. teamsWithoutLineups
// counts each distinct team with no lineup rows once, across the league-week.
async function scoreLeague(
  leagueId: string,
  season: number,
  week: number,
  settings: ReturnType<typeof LeagueSettingsSchema.safeParse>,
  opts: { finalize: boolean; dryRun: boolean },
): Promise<{ ok: true; tally: LeagueTally } | { ok: false }> {
  if (!settings.success) return { ok: false };
  const { rules } = settings.data.scoring;
  const bonuses = settings.data.scoring.bonuses;

  const matchupRows = await fetchMatchups(leagueId, season, week);
  const teamIds = Array.from(
    new Set(matchupRows.flatMap((mp) => [mp.homeTeamId, mp.awayTeamId])),
  );
  const lineups = await fetchLineupsByTeam(teamIds, season, week);
  const statsByPlayer = await fetchStatsByPlayer(season, week);

  const teamsWithoutLineups = new Set<string>();
  const tally: LeagueTally = { matchupsScored: 0, skippedFinal: 0, teamsWithoutLineups: 0, sample: [] };

  for (const mp of matchupRows) {
    if (mp.final) {
      tally.skippedFinal += 1;
      continue;
    }
    const home = scoreSide(lineups, mp.homeTeamId, rules, bonuses, statsByPlayer);
    const away = scoreSide(lineups, mp.awayTeamId, rules, bonuses, statsByPlayer);
    if (!home.hadLineup) teamsWithoutLineups.add(mp.homeTeamId);
    if (!away.hadLineup) teamsWithoutLineups.add(mp.awayTeamId);

    if (!opts.dryRun) {
      const won = await writeMatchup(mp.id, home.points, away.points, opts.finalize);
      // Lost the guard = a concurrent scorer finalized this row between our
      // read and write; count it as skippedFinal (not scored), not an error.
      if (!won) {
        tally.skippedFinal += 1;
        continue;
      }
    }
    tally.matchupsScored += 1;
    if (tally.sample.length < 3) {
      tally.sample.push({ matchupId: mp.id, home: home.points, away: away.points });
    }
  }

  tally.teamsWithoutLineups = teamsWithoutLineups.size;
  return { ok: true, tally };
}

type Accumulator = {
  leaguesScored: number;
  matchupsScored: number;
  skippedFinal: number;
  skippedInvalidSettings: number;
  teamsWithoutLineups: number;
  sample: ScoreWeekSample[];
};

// Score one league and fold its tally into the running accumulator. Kept flat
// (guard-clause early returns, no nested try) so the main loop stays under the
// Rule 1 nesting ceiling. A parse or scoreLeague failure counts the league as
// skippedInvalidSettings — one bad league must not block the others.
async function accumulateLeague(
  acc: Accumulator,
  leagueId: string,
  season: number,
  week: number,
  opts: { finalize: boolean; dryRun: boolean },
): Promise<void> {
  const rawSettings = await fetchLatestSettings(leagueId);
  const parsed = LeagueSettingsSchema.safeParse(rawSettings);
  if (!parsed.success) {
    acc.skippedInvalidSettings += 1;
    return;
  }
  const result = await scoreLeague(leagueId, season, week, parsed, opts);
  if (!result.ok) {
    acc.skippedInvalidSettings += 1;
    return;
  }
  acc.leaguesScored += 1;
  acc.matchupsScored += result.tally.matchupsScored;
  acc.skippedFinal += result.tally.skippedFinal;
  acc.teamsWithoutLineups += result.tally.teamsWithoutLineups;
  for (const s of result.tally.sample) {
    if (acc.sample.length < 3) acc.sample.push(s);
  }
}

/**
 * Scores every matchup in (season, week) across all leagues, writing clean 2dp
 * point strings (roundPoints(total).toFixed(2)) via guarded UPDATEs unless
 * dryRun. finalize freezes the result (final=true). One league with invalid
 * settings is counted in skippedInvalidSettings and skipped — it must never
 * block the rest.
 */
export async function scoreWeek(
  season: number,
  week: number,
  opts: { finalize: boolean; dryRun: boolean },
): Promise<ScoreWeekResult> {
  assertSeasonWeekWindow(season, week);

  const acc: Accumulator = {
    leaguesScored: 0,
    matchupsScored: 0,
    skippedFinal: 0,
    skippedInvalidSettings: 0,
    teamsWithoutLineups: 0,
    sample: [],
  };

  try {
    const leagueIds = await fetchLeagueIds(season, week);
    for (const leagueId of leagueIds) {
      await accumulateLeague(acc, leagueId, season, week, opts);
    }
    // Post-invariant: leaguesScored bounded by the input league count.
    invariant(acc.leaguesScored <= leagueIds.length, 'leaguesScored exceeded the league count');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }

  return {
    ok: true,
    dryRun: opts.dryRun,
    leaguesScored: acc.leaguesScored,
    matchupsScored: acc.matchupsScored,
    skippedFinal: acc.skippedFinal,
    skippedInvalidSettings: acc.skippedInvalidSettings,
    teamsWithoutLineups: acc.teamsWithoutLineups,
    sample: acc.sample,
  };
}
