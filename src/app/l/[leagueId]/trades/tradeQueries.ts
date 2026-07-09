import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, pickAssets, players, rosterMembers, seasons, teams } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { currentTradeWeek } from '@/server/currentWeek';
import { getKickoffs } from '@/server/lineup/locks';
import type { PickAsset, PlayerAsset, TeamAssets, TeamOption } from './types';

// A hosted league seats at most 32 teams (settings.ts teamCount max) — 40
// leaves headroom without being unbounded (Rule 3), mirroring the league
// home page's own MAX_TEAMS.
const MAX_TEAMS = 40;
// Per-team roster cap mirrors lineupQueries.ts's MAX_ROSTER; a whole-league
// roster query is bounded by teams × that per-team cap.
const MAX_ROSTER_PER_TEAM = 100;
const MAX_LEAGUE_ROSTER_ROWS = MAX_TEAMS * MAX_ROSTER_PER_TEAM;
// A team's pick base is <=3 future years x <=10 rounds = 30 in the common
// case; 200/team (mirroring src/server/trades/tradeQueries.ts) covers a
// hoarder, so the whole-league query bounds to teams x that per-team cap.
const MAX_PICKS_PER_TEAM = 200;
const MAX_LEAGUE_PICK_ROWS = MAX_TEAMS * MAX_PICKS_PER_TEAM;

export type LeagueRow = { id: string; name: string; createdBy: string };
export type SeasonRow = { id: string; year: number; settings: unknown };

export async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({ id: leagues.id, name: leagues.name, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

export async function fetchLatestSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({ id: seasons.id, year: seasons.year, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

export type ParsedSettingsResult =
  | { ok: true; settings: LeagueSettings }
  | { ok: false; detail: string };

export function parseSeasonSettings(settings: unknown): ParsedSettingsResult {
  const parsed = LeagueSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return { ok: false, detail: firstZodIssueMessage(parsed.error) };
  }
  return { ok: true, settings: parsed.data };
}

export async function fetchLeagueTeams(leagueId: string): Promise<(TeamOption & { ownerId: string | null })[]> {
  const rows = await getDb()
    .select({ id: teams.id, name: teams.name, ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .orderBy(teams.name)
    .limit(MAX_TEAMS);
  invariant(rows.length <= MAX_TEAMS, 'league teams query exceeded its bound');
  return rows;
}

/** The current NFL week as trade logic sees it (never wraps to week 1). */
export async function resolveCurrentTradeWeek(settings: LeagueSettings, season: number): Promise<number> {
  const lastRegularWeek = Math.max(1, settings.playoffs.startWeek - 1);
  return currentTradeWeek(lastRegularWeek, new Date(), (w) => getKickoffs(season, w));
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'];

function positionRank(position: string): number {
  const idx = POSITION_ORDER.indexOf(position);
  return idx === -1 ? POSITION_ORDER.length : idx;
}

/** Every roster member in the league, joined to player detail, one bounded query. */
async function fetchLeagueRosterAssets(leagueId: string): Promise<Map<string, PlayerAsset[]>> {
  const rows = await getDb()
    .select({
      teamId: rosterMembers.teamId,
      playerId: rosterMembers.playerId,
      status: rosterMembers.status,
      fullName: players.fullName,
      position: players.position,
    })
    .from(rosterMembers)
    .innerJoin(players, eq(rosterMembers.playerId, players.sleeperId))
    .where(eq(rosterMembers.leagueId, leagueId))
    .limit(MAX_LEAGUE_ROSTER_ROWS);
  invariant(rows.length <= MAX_LEAGUE_ROSTER_ROWS, 'league roster query exceeded its bound');

  const byTeam = new Map<string, PlayerAsset[]>();
  for (const row of rows) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push({ playerId: row.playerId, fullName: row.fullName, position: row.position, status: row.status });
    byTeam.set(row.teamId, list);
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.fullName.localeCompare(b.fullName));
  }
  return byTeam;
}

/** Every pick asset in the league, joined to the original team's name, capped to the trade window. */
async function fetchLeaguePickAssets(
  leagueId: string,
  maxSeason: number,
): Promise<Map<string, PickAsset[]>> {
  const originalTeam = teams;
  const rows = await getDb()
    .select({
      id: pickAssets.id,
      season: pickAssets.season,
      round: pickAssets.round,
      currentTeamId: pickAssets.currentTeamId,
      originalTeamName: originalTeam.name,
    })
    .from(pickAssets)
    .innerJoin(originalTeam, eq(pickAssets.originalTeamId, originalTeam.id))
    .where(and(eq(pickAssets.leagueId, leagueId)))
    .limit(MAX_LEAGUE_PICK_ROWS);
  invariant(rows.length <= MAX_LEAGUE_PICK_ROWS, 'league pick asset query exceeded its bound');

  const byTeam = new Map<string, PickAsset[]>();
  for (const row of rows) {
    if (row.season > maxSeason) continue; // outside this league's trade window
    const list = byTeam.get(row.currentTeamId) ?? [];
    list.push({ id: row.id, season: row.season, round: row.round, originalTeamName: row.originalTeamName });
    byTeam.set(row.currentTeamId, list);
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => a.season - b.season || a.round - b.round);
  }
  return byTeam;
}

/**
 * Every league team's tradeable assets, pre-grouped and pre-bounded, keyed by
 * teamId. Loaded once for the whole page so the propose form can switch
 * counterparty selection client-side without a refetch.
 */
export async function fetchAllTeamAssets(
  leagueId: string,
  currentSeason: number,
  futurePickYears: number,
): Promise<Map<string, TeamAssets>> {
  const maxSeason = currentSeason + futurePickYears;
  const [rosterByTeam, picksByTeam] = await Promise.all([
    fetchLeagueRosterAssets(leagueId),
    fetchLeaguePickAssets(leagueId, maxSeason),
  ]);
  const teamIds = new Set([...rosterByTeam.keys(), ...picksByTeam.keys()]);
  const result = new Map<string, TeamAssets>();
  for (const teamId of teamIds) {
    result.set(teamId, {
      teamId,
      players: rosterByTeam.get(teamId) ?? [],
      picks: picksByTeam.get(teamId) ?? [],
    });
  }
  return result;
}

export function emptyTeamAssets(teamId: string): TeamAssets {
  return { teamId, players: [], picks: [] };
}
