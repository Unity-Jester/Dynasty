import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/server/db';
import { matchups, teams } from '@/server/schema';

// A single week's pairings are bounded by teamCount's hard cap / 2 (16 rows
// max at 32 teams); 20 leaves headroom without being unbounded (Rule 3).
const MAX_MATCHUPS_PER_WEEK = 20;

export type MatchupRow = {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homePoints: string | null;
  awayPoints: string | null;
};

export async function fetchWeekMatchups(
  leagueId: string,
  season: number,
  week: number,
): Promise<MatchupRow[]> {
  const homeTeams = alias(teams, 'home_teams');
  const awayTeams = alias(teams, 'away_teams');

  const rows = await getDb()
    .select({
      id: matchups.id,
      homeTeamName: homeTeams.name,
      awayTeamName: awayTeams.name,
      homePoints: matchups.homePoints,
      awayPoints: matchups.awayPoints,
    })
    .from(matchups)
    .innerJoin(homeTeams, eq(matchups.homeTeamId, homeTeams.id))
    .innerJoin(awayTeams, eq(matchups.awayTeamId, awayTeams.id))
    .where(
      and(
        eq(matchups.leagueId, leagueId),
        eq(matchups.season, season),
        eq(matchups.week, week),
      ),
    )
    .orderBy(homeTeams.name)
    .limit(MAX_MATCHUPS_PER_WEEK);

  return rows;
}
