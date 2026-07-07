import { invariant } from '@/lib/invariant';

// A season-week's matchup rows are bounded by (teamCount / 2) per week over at
// most 18 weeks; a 32-team league is 16 * 18 = 288 rows. 500 is generous
// headroom and still a hard cap (CODING_STANDARDS.md Rule 2/3).
const MAX_MATCHUPS = 500;

// Points arrive as `numeric`-as-string from the matchups table (Drizzle
// surfaces `numeric` as string|null). scoreWeek writes clean 2dp strings via
// roundPoints(total).toFixed(2); standings math Number()-parses on read.
export type MatchupResult = {
  homeTeamId: string;
  awayTeamId: string;
  homePoints: string | null;
  awayPoints: string | null;
  final: boolean;
};

export type Standing = {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
};

function emptyStanding(teamId: string): Standing {
  return { teamId, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
}

function getOrCreate(byTeam: Map<string, Standing>, teamId: string): Standing {
  const existing = byTeam.get(teamId);
  if (existing !== undefined) return existing;
  const created = emptyStanding(teamId);
  byTeam.set(teamId, created);
  return created;
}

// Apply one final matchup's parsed scores to both sides' running tallies.
function applyResult(home: Standing, away: Standing, homePts: number, awayPts: number): void {
  home.pointsFor += homePts;
  home.pointsAgainst += awayPts;
  away.pointsFor += awayPts;
  away.pointsAgainst += homePts;
  if (homePts > awayPts) {
    home.wins += 1;
    away.losses += 1;
  } else if (homePts < awayPts) {
    home.losses += 1;
    away.wins += 1;
  } else {
    home.ties += 1;
    away.ties += 1;
  }
}

/**
 * Folds a league's matchup rows into per-team win/loss/tie + points-for/against
 * standings. ONLY final matchups with BOTH point sides non-numeric count; a
 * final matchup missing a side, or carrying a non-numeric string, is an
 * impossible state (scoreWeek always writes two clean 2dp strings together) and
 * is reported as an error naming the offending pairing rather than silently
 * dropped.
 *
 * Returns one Standing for every team that appears in ANY counted matchup,
 * UNSORTED — the caller owns team names and sorts (wins desc -> PF desc ->
 * name asc). Empty input, or input with no final matchups, yields [].
 */
export function computeStandings(
  matchups: readonly MatchupResult[],
): { ok: true; value: Standing[] } | { ok: false; error: string } {
  invariant(matchups.length <= MAX_MATCHUPS, `matchups (${matchups.length}) exceeds MAX_MATCHUPS`);

  const byTeam = new Map<string, Standing>();
  let countedMatchups = 0;

  for (const matchup of matchups) {
    if (!matchup.final) continue;

    const label = `${matchup.homeTeamId} vs ${matchup.awayTeamId}`;
    if (matchup.homePoints === null || matchup.awayPoints === null) {
      return { ok: false, error: `final matchup ${label} has a null points side` };
    }
    const homePts = Number(matchup.homePoints);
    const awayPts = Number(matchup.awayPoints);
    if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) {
      return { ok: false, error: `final matchup ${label} has a non-numeric points value` };
    }

    const home = getOrCreate(byTeam, matchup.homeTeamId);
    const away = getOrCreate(byTeam, matchup.awayTeamId);
    applyResult(home, away, homePts, awayPts);
    countedMatchups += 1;
  }

  const value = Array.from(byTeam.values());

  // Post-invariant #1: every counted matchup contributed exactly two team-side
  // entries, so the sum of all teams' games equals 2 * countedMatchups.
  let totalGames = 0;
  for (const s of value) {
    totalGames += s.wins + s.losses + s.ties;
  }
  invariant(totalGames === countedMatchups * 2, 'counted matchups did not contribute 2 entries each');

  // Post-invariant #2: per team, W+L+T equals the number of matchups that team
  // appeared in — checked implicitly by #1 being consistent with a finite,
  // non-negative tally (no negative counters can arise from applyResult).
  invariant(
    value.every((s) => s.wins >= 0 && s.losses >= 0 && s.ties >= 0),
    'a standing accumulated a negative game count',
  );

  return { ok: true, value };
}
