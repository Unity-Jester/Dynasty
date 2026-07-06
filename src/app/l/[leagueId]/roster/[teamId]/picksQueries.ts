import { and, eq, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '@/server/db';
import { pickAssets, teams } from '@/server/schema';

// A team's pick base is ≤ 3 years × ≤ 10 rounds = 30 own picks; acquiring
// every pick in a 32-team league is unrealistic, so 60 leaves generous
// headroom without being unbounded (Rule 3).
const MAX_PICKS_DISPLAY = 60;

export type HeldPick = {
  season: number;
  round: number;
  // Origin team's name when the pick was acquired via trade; null for the
  // team's own picks (no "via" suffix).
  viaName: string | null;
};

export type TradedAwayPick = {
  season: number;
  round: number;
  holderName: string;
};

// Picks currently held by this team, with the origin team's name joined so
// traded-in picks can render a "via <origin>" suffix.
export async function fetchHeldPicks(teamId: string): Promise<HeldPick[]> {
  const originTeams = alias(teams, 'origin_teams');
  const rows = await getDb()
    .select({
      season: pickAssets.season,
      round: pickAssets.round,
      originalTeamId: pickAssets.originalTeamId,
      originName: originTeams.name,
    })
    .from(pickAssets)
    .innerJoin(originTeams, eq(pickAssets.originalTeamId, originTeams.id))
    .where(eq(pickAssets.currentTeamId, teamId))
    .orderBy(pickAssets.season, pickAssets.round)
    .limit(MAX_PICKS_DISPLAY);

  return rows.map((row) => ({
    season: row.season,
    round: row.round,
    viaName: row.originalTeamId === teamId ? null : row.originName,
  }));
}

// Picks this team originally owned but traded away, with the current
// holder's name joined ("2027 2nd → Penix Envy").
export async function fetchTradedAwayPicks(teamId: string): Promise<TradedAwayPick[]> {
  const holderTeams = alias(teams, 'holder_teams');
  return getDb()
    .select({
      season: pickAssets.season,
      round: pickAssets.round,
      holderName: holderTeams.name,
    })
    .from(pickAssets)
    .innerJoin(holderTeams, eq(pickAssets.currentTeamId, holderTeams.id))
    .where(and(eq(pickAssets.originalTeamId, teamId), ne(pickAssets.currentTeamId, teamId)))
    .orderBy(pickAssets.season, pickAssets.round)
    .limit(MAX_PICKS_DISPLAY);
}
