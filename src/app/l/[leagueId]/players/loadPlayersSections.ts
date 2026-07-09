import 'server-only';
import { fetchMyRoster, searchUnrosteredPlayers } from './playersQueries';
import { fetchPendingClaims, fetchResolvedClaims, resolveClaims } from './claimsQueries';
import type { PositionFilter, ResolvedClaim, RosterOption, UnrosteredPlayer } from './types';

export type PlayersSectionsData = {
  results: UnrosteredPlayer[];
  rosterOptions: RosterOption[];
  pendingClaims: ResolvedClaim[];
  resolvedClaims: ResolvedClaim[];
};

/**
 * Everything the page needs beyond league/season/team rows, gated by whether
 * the viewer owns a team (roster options + claim lists are pointless
 * without one). Split out of the page component purely to keep its own
 * complexity under the lint cap (CODING_STANDARDS.md Rule 1) — mirrors
 * trades/loadTradesSections.ts.
 */
export async function loadPlayersSections(
  leagueId: string,
  q: string | null,
  pos: PositionFilter | null,
  myTeamId: string | null,
): Promise<PlayersSectionsData> {
  const [results, rosterOptions, pendingRows, resolvedRows] = await Promise.all([
    searchUnrosteredPlayers(leagueId, q, pos),
    myTeamId ? fetchMyRoster(myTeamId) : Promise.resolve([]),
    myTeamId ? fetchPendingClaims(leagueId, myTeamId) : Promise.resolve([]),
    myTeamId ? fetchResolvedClaims(leagueId, myTeamId) : Promise.resolve([]),
  ]);

  const [pendingClaims, resolvedClaims] = await Promise.all([
    resolveClaims(pendingRows),
    resolveClaims(resolvedRows),
  ]);

  return { results, rosterOptions, pendingClaims, resolvedClaims };
}
