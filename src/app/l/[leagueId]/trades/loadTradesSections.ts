import 'server-only';
import type { LeagueSettings } from '@/engine/settings';
import { fetchAllTeamAssets } from './tradeQueries';
import { fetchHistoryTrades, fetchPendingTrades, fetchReviewTrades, resolveTrades } from './transactionQueries';
import type { ResolvedTrade, TeamAssets } from './types';

export type TradesSectionsData = {
  pendingResolved: ResolvedTrade[];
  reviewResolved: ResolvedTrade[];
  historyResolved: ResolvedTrade[];
  teamAssetsById: Record<string, TeamAssets>;
};

/**
 * Everything the page needs beyond league/season/team rows, gated by whether
 * the viewer owns a team (pending list + tradeable-asset lookups are pointless
 * without one) and whether they're the creator (review queue is creator-only).
 * Split out of the page component purely to keep its own complexity under the
 * lint cap (CODING_STANDARDS.md Rule 1).
 */
export async function loadTradesSections(
  leagueId: string,
  seasonYear: number,
  settings: LeagueSettings,
  teamNames: ReadonlyMap<string, string>,
  myTeamId: string | null,
  isCreator: boolean,
): Promise<TradesSectionsData> {
  const [pendingRows, reviewRows, historyRows, teamAssetsMap] = await Promise.all([
    myTeamId ? fetchPendingTrades(leagueId) : Promise.resolve([]),
    isCreator ? fetchReviewTrades(leagueId) : Promise.resolve([]),
    fetchHistoryTrades(leagueId),
    myTeamId
      ? fetchAllTeamAssets(leagueId, seasonYear, settings.trades.futurePickYears)
      : Promise.resolve(new Map<string, TeamAssets>()),
  ]);

  const [pendingResolved, reviewResolved, historyResolved] = await Promise.all([
    resolveTrades(pendingRows, teamNames),
    resolveTrades(reviewRows, teamNames),
    resolveTrades(historyRows, teamNames),
  ]);

  return {
    pendingResolved,
    reviewResolved,
    historyResolved,
    teamAssetsById: Object.fromEntries(teamAssetsMap),
  };
}
