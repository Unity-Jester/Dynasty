import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getAllPlayers,
  getAllHistoricalTrades,
  getAllHistoricalDrafts,
} from '@/lib/sleeper';
import { getLeagueId } from '@/lib/utils';
import { fetchFantasyCalcValues } from '@/lib/rankings';
import { generateAllReportCards } from '@/lib/tradeAnalysis';
import { fetchHistoricalValues, buildPlayerNameMapping } from '@/lib/historicalValues';
import { FantasyCalcSettings, SleeperTransaction } from '@/lib/types';
import TradeAnalyzer from '@/components/TradeAnalyzer';
import TradeHistory from '@/components/TradeHistory';
import TradeReportCards from '@/components/TradeReportCard';

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

export default async function TradesPage() {
  const leagueId = getLeagueId();

  if (!leagueId || leagueId === 'your_league_id_here') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Please configure your League ID first.</p>
      </div>
    );
  }

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

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Trade Center</h1>
          <p className="text-gray-400 mt-1">{league.name} &middot; {league.season} Season</p>
        </div>

        {/* Trade Analyzer */}
        <TradeAnalyzer
          players={players}
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
          players={players}
          currentSeason={league.season}
        />
      </div>
    );
  } catch (error) {
    console.error('Error loading trades:', error);
    return (
      <div className="text-center py-12">
        <p className="text-sleeper-red">Error loading trades</p>
      </div>
    );
  }
}
