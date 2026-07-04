import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueMatchups,
  getAllSeasonTransactions,
  getNFLState,
  getAllPlayers,
  getSeasonWeeklyMatchups,
  pairMatchups,
} from '@/lib/sleeper';
import { calculateLuckIndex, calculateWeeklyAwards } from '@/lib/seasonStats';
import ErrorState from '@/components/ErrorState';
import Standings from '@/components/Standings';
import Matchup from '@/components/Matchup';
import TransactionCard from '@/components/TransactionCard';
import PowerRankings from '@/components/PowerRankings';
import LuckIndex from '@/components/LuckIndex';
import WeeklyAwards from '@/components/WeeklyAwards';

export const revalidate = 60; // Revalidate every 60 seconds

interface LeaguePageProps {
  params: { leagueId: string };
}

export default async function DashboardPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

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

    const regularSeasonWeeks = Math.max(1, (league.settings.playoff_week_start || 15) - 1);
    const [matchups, transactions, weeklyMatchups] = await Promise.all([
      getLeagueMatchups(leagueId, currentWeek),
      getAllSeasonTransactions(leagueId, currentWeek),
      isPreseason
        ? Promise.resolve([] as Awaited<ReturnType<typeof getSeasonWeeklyMatchups>>)
        : getSeasonWeeklyMatchups(leagueId, regularSeasonWeeks),
    ]);

    const matchupPairs = pairMatchups(matchups, rosters, users);
    const luckRows = calculateLuckIndex(weeklyMatchups);
    const weeklyAwards = calculateWeeklyAwards(weeklyMatchups);

    // Get recent transactions (last 10)
    const recentTransactions = transactions
      .sort((a, b) => b.created - a.created)
      .slice(0, 10);

    return (
      <div className="space-y-8">
        {/* Header */}
        <div>
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.2em] text-gold-500 mb-2">
            Dynasty League Hub
          </p>
          <h1 className="text-4xl text-white">{league.name}</h1>
          <p className="text-gray-400 mt-2">
            {league.season} Season &middot; {getStatusText()}
          </p>
          <div className="keyline mt-4" />
        </div>

        {/* Standings - Full Width */}
        <Standings rosters={rosters} users={users} />

        {/* Weekly Awards */}
        {weeklyAwards && (
          <WeeklyAwards awards={weeklyAwards} rosters={rosters} users={users} />
        )}

        {/* Power Rankings */}
        <PowerRankings rosters={rosters} users={users} players={players} />

        {/* Luck Index */}
        {luckRows.length > 0 && (
          <LuckIndex rows={luckRows} rosters={rosters} users={users} />
        )}

        {/* This Week's Matchups */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-4">
            {isPreseason ? 'Week 1 Matchups (Preview)' : `Week ${currentWeek} Matchups`}
          </h2>
          {isPreseason ? (
            <div className="panel p-8 text-center">
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
      <ErrorState
        title="Error Loading League"
        detail={`Could not load league data for league ${leagueId}. Please check your League ID.`}
      />
    );
  }
}
