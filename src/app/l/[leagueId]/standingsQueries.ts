import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { matchups, teams } from '@/server/schema';
import { computeStandings, type MatchupResult, type Standing } from '@/engine/standings';
import { invariant } from '@/lib/invariant';

// A full season's matchup rows: teamCount(32)/2 per week over <=18 weeks = 288
// max; 500 matches the engine's MAX_MATCHUPS and is a hard cap (Rule 3).
const MAX_SEASON_MATCHUPS = 500;
// Team names for one league; teamCount is capped at 32, 40 is headroom.
const MAX_TEAMS = 40;

export type StandingRow = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
};

// Bounded read of a season's matchups as the engine's MatchupResult shape.
async function fetchSeasonMatchups(leagueId: string, season: number): Promise<MatchupResult[]> {
  const rows = await getDb()
    .select({
      homeTeamId: matchups.homeTeamId,
      awayTeamId: matchups.awayTeamId,
      homePoints: matchups.homePoints,
      awayPoints: matchups.awayPoints,
      final: matchups.final,
    })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.season, season)))
    .limit(MAX_SEASON_MATCHUPS);
  invariant(rows.length <= MAX_SEASON_MATCHUPS, 'season matchup count exceeded its bound');
  return rows;
}

async function fetchTeamNames(leagueId: string): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .limit(MAX_TEAMS);
  invariant(rows.length <= MAX_TEAMS, 'team count exceeded its bound');
  return new Map(rows.map((r) => [r.id, r.name]));
}

// Attach names and sort: wins desc -> PF desc -> name asc. The engine returns
// standings unsorted precisely because it doesn't own names — this is where
// that ownership lives.
function toSortedRows(standings: readonly Standing[], names: Map<string, string>): StandingRow[] {
  const rows: StandingRow[] = standings.map((s) => ({
    teamId: s.teamId,
    teamName: names.get(s.teamId) ?? 'Unknown team',
    wins: s.wins,
    losses: s.losses,
    ties: s.ties,
    pointsFor: s.pointsFor,
    pointsAgainst: s.pointsAgainst,
  }));
  rows.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.pointsFor !== b.pointsFor) return b.pointsFor - a.pointsFor;
    return a.teamName.localeCompare(b.teamName);
  });
  return rows;
}

/**
 * Season standings for a league: reads all matchups, computes W/L/T + PF/PA
 * from the FINAL ones via the engine, then names and sorts them. Returns []
 * when no games have gone final (the empty-state signal). Never throws on a
 * malformed points row — surfaces the engine's error instead.
 */
export async function getStandings(
  leagueId: string,
  season: number,
): Promise<{ ok: true; rows: StandingRow[] } | { ok: false; error: string }> {
  const [matchupRows, names] = await Promise.all([
    fetchSeasonMatchups(leagueId, season),
    fetchTeamNames(leagueId),
  ]);
  const computed = computeStandings(matchupRows);
  if (!computed.ok) return { ok: false, error: computed.error };
  return { ok: true, rows: toSortedRows(computed.value, names) };
}
