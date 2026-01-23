import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueMatchups,
  getAllSeasonTransactions,
  getNFLState,
  getAllPlayers,
  pairMatchups,
} from '@/lib/sleeper';
import { getLeagueId } from '@/lib/utils';
import Standings from '@/components/Standings';
import Matchup from '@/components/Matchup';
import TransactionCard from '@/components/TransactionCard';
import PowerRankings from '@/components/PowerRankings';

export const revalidate = 60; // Revalidate every 60 seconds

export default async function DashboardPage() {
  const leagueId = getLeagueId();

  if (!leagueId || leagueId === 'your_league_id_here') {
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-white mb-4">Welcome to Sleeper League Hub</h1>
        <p className="text-gray-400 mb-4">
          To get started, add your Sleeper League ID to the environment variables.
        </p>
        <div className="bg-sleeper-darker rounded-lg p-4 max-w-md mx-auto">
          <p className="text-sm text-gray-400 mb-2">Edit <code className="text-sleeper-accent">.env.local</code>:</p>
          <code className="text-sleeper-green">NEXT_PUBLIC_LEAGUE_ID=your_league_id</code>
        </div>
        <p className="text-sm text-gray-500 mt-4">
          Find your League ID in the Sleeper app under League Settings
        </p>
      </div>
    );
  }

  try {
    const [league, users, rosters, nflState, players] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
      getLeagueRosters(leagueId),
      getNFLState(),
      getAllPlayers(),
    ]);

    // Determine the display week based on league status
    const isPreseason = league.status === 'pre_draft' || league.status === 'drafting';
    const currentWeek = isPreseason ? 1 : (nflState.week || 1);

    // Get status display text
    const getStatusText = () => {
      if (league.status === 'pre_draft') return 'Pre-Draft';
      if (league.status === 'drafting') return 'Drafting';
      if (league.status === 'complete') return 'Season Complete';
      return `Week ${currentWeek}`;
    };

    const [matchups, transactions] = await Promise.all([
      getLeagueMatchups(leagueId, currentWeek),
      getAllSeasonTransactions(leagueId, currentWeek),
    ]);

    const matchupPairs = pairMatchups(matchups, rosters, users);

    // Get recent transactions (last 10)
    const recentTransactions = transactions
      .sort((a, b) => b.created - a.created)
      .slice(0, 10);

    return (
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white">{league.name}</h1>
          <p className="text-gray-400 mt-1">
            {league.season} Season &middot; {getStatusText()}
          </p>
        </div>

        {/* Standings - Full Width */}
        <Standings rosters={rosters} users={users} />

        {/* Power Rankings */}
        <PowerRankings rosters={rosters} users={users} players={players} />

        {/* This Week's Matchups */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">
            {isPreseason ? 'Week 1 Matchups (Preview)' : `Week ${currentWeek} Matchups`}
          </h2>
          {isPreseason ? (
            <div className="bg-sleeper-darker rounded-lg p-8 text-center">
              <p className="text-gray-400">Matchups will be available once the season starts</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {matchupPairs.length > 0 ? (
                matchupPairs.map((matchup) => (
                  <Matchup key={matchup.matchupId} matchup={matchup} players={players} />
                ))
              ) : (
                <p className="text-gray-400 col-span-2">No matchups scheduled</p>
              )}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
          {recentTransactions.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {recentTransactions.map((transaction) => (
                <TransactionCard
                  key={transaction.transaction_id}
                  transaction={transaction}
                  rosters={rosters}
                  users={users}
                  players={players}
                />
              ))}
            </div>
          ) : (
            <p className="text-gray-400">No recent transactions</p>
          )}
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading dashboard:', error);
    return (
      <div className="text-center py-12">
        <h1 className="text-2xl font-bold text-sleeper-red mb-4">Error Loading League</h1>
        <p className="text-gray-400">
          Could not load league data. Please check your League ID and try again.
        </p>
        <p className="text-sm text-gray-500 mt-2">League ID: {leagueId}</p>
      </div>
    );
  }
}
