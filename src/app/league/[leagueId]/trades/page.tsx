import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getAllPlayers,
  getAllHistoricalTrades,
  getAllHistoricalDrafts,
  buildClientPlayersMap,
} from '@/lib/sleeper';
import { fetchFantasyCalcValues } from '@/lib/rankings';
import { generateAllReportCards } from '@/lib/tradeAnalysis';
import { fetchHistoricalValues, buildPlayerNameMapping } from '@/lib/historicalValues';
import { FantasyCalcSettings, SleeperTransaction } from '@/lib/types';
import TradeAnalyzer from '@/components/TradeAnalyzer';
import ErrorState from '@/components/ErrorState';
import TradeHistory from '@/components/TradeHistory';
import TradeReportCards from '@/components/TradeReportCard';

// Rendered on demand: build-time prerendering of this page broke Vercel
// deploys. Underlying Sleeper/FantasyCalc fetches are cached via
// next.revalidate, so per-request cost is recomputation, not network.
export const dynamic = 'force-dynamic';

// Derive fantasy calc settings from Sleeper league data
function deriveLeagueSettings(
  rosterPositions: string[],
  scoringSettings: Record<string, number>,
  totalRosters: number
): FantasyCalcSettings {
  // Count QB positions (QB + SUPER_FLEX)
  const qbCount = rosterPositions.filter(
    pos => pos === 'QB' || pos === 'SUPER_FLEX'
  ).length;
  const numQbs: 1 | 2 = qbCount >= 2 ? 2 : 1;

  // Get PPR setting (0, 0.5, or 1)
  const recValue = scoringSettings?.rec ?? 1;
  const ppr: 0 | 0.5 | 1 = recValue === 0 ? 0 : recValue === 0.5 ? 0.5 : 1;

  return {
    numQbs,
    ppr,
    numTeams: totalRosters || 12,
  };
}

interface LeaguePageProps {
  params: { leagueId: string };
}

export default async function TradesPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

  try {
    // Fetch all data in parallel
    const [league, users, rosters, players, allSeasonTrades, draftMap, historicalData] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
      getLeagueRosters(leagueId),
      getAllPlayers(),
      getAllHistoricalTrades(leagueId),
      getAllHistoricalDrafts(leagueId),
      fetchHistoricalValues(),
    ]);

    // Derive league settings for FantasyCalc API
    const settings = deriveLeagueSettings(
      league.roster_positions || [],
      league.scoring_settings || {},
      league.total_rosters
    );

    // Fetch player and pick values (for fallback)
    const { playerValues, pickValues } = await fetchFantasyCalcValues(settings);

    // Convert Maps to serializable objects for client component
    const playerValuesObj = Object.fromEntries(playerValues);
    const pickValuesObj = Object.fromEntries(pickValues);

    // Build player name mapping (Sleeper ID -> historical column name)
    const playerMapping = buildPlayerNameMapping(players, historicalData.playerColumns);

    // Collect all trades across all seasons for report cards
    const allTrades: SleeperTransaction[] = allSeasonTrades.flatMap(s => s.trades);

    // Generate report cards for all teams (with historical data for accurate values)
    const reportCards = generateAllReportCards(
      allTrades,
      rosters,
      users,
      players,
      playerValuesObj,
      pickValuesObj,
      draftMap,
      historicalData,
      playerMapping
    );

    // Client components below receive a slimmed players map: full player
    // data is ~5MB and would be serialized into the page payload.
    const tradedPlayerIds = allTrades.flatMap(t => [
      ...Object.keys(t.adds || {}),
      ...Object.keys(t.drops || {}),
    ]);
    const rosteredPlayerIds = rosters.flatMap(r => r.players || []);
    const clientPlayers = buildClientPlayersMap(players, [
      ...tradedPlayerIds,
      ...rosteredPlayerIds,
    ]);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl text-white">Trade Center</h1>
          <p className="text-gray-400 mt-1">{league.name} &middot; {league.season} Season</p>
          {historicalData.dates.length > 0 ? (
            <p className="text-xs text-gray-500 mt-1">
              Historical values updated {historicalData.dates[0]}
            </p>
          ) : (
            <p className="text-xs text-yellow-500/80 mt-1">
              Historical value data unavailable &mdash; grades fall back to estimates
            </p>
          )}
        </div>

        {/* Trade Analyzer */}
        <TradeAnalyzer
          players={clientPlayers}
          rosters={rosters}
          users={users}
          playerValues={playerValuesObj}
          pickValues={pickValuesObj}
        />

        {/* Trade Report Cards */}
        <TradeReportCards reportCards={reportCards} />

        {/* Trade History - All Seasons */}
        <TradeHistory
          seasonTrades={allSeasonTrades}
          players={clientPlayers}
          currentSeason={league.season}
        />
      </div>
    );
  } catch (error) {
    console.error('Error loading trades:', error);
    return <ErrorState title="Error Loading Trades" />;
  }
}
