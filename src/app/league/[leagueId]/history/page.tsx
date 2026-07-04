import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueHistory,
  getPlayoffBracket,
  getUserByOwnerId,
  getUserAvatarUrl,
  formatPoints,
  getHeadToHeadRecords,
} from '@/lib/sleeper';
import H2HGrid from '@/components/H2HGrid';
import ErrorState from '@/components/ErrorState';
import { ordinalSuffix, getTeamName } from '@/lib/utils';
import Image from 'next/image';
import { SleeperLeague, SleeperUser, SleeperRoster } from '@/lib/types';

export const revalidate = 3600; // Revalidate every hour (historical data doesn't change often)

interface SeasonData {
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  champion: { user: SleeperUser | null; roster: SleeperRoster } | null;
}

async function getSeasonData(leagueId: string): Promise<SeasonData | null> {
  try {
    const [league, users, rosters] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
      getLeagueRosters(leagueId),
    ]);

    // Try to find the champion from playoff bracket
    let champion: { user: SleeperUser | null; roster: SleeperRoster } | null = null;

    // Check if season is complete (Sleeper uses 'complete' or check if it's a past season)
    const currentYear = new Date().getFullYear();
    const seasonYear = parseInt(league.season);
    const isCompletedSeason = league.status === 'complete' || seasonYear < currentYear;

    if (isCompletedSeason) {
      try {
        const bracket = await getPlayoffBracket(leagueId, 'winners');

        if (bracket && bracket.length > 0) {
          // Find the championship match - look for p=1 (1st place) or highest round
          const championshipMatch = bracket.find(m => m.p === 1)
            || bracket.reduce((max, m) => {
              const round = m.r ?? m.round ?? 0;
              const maxRound = max?.r ?? max?.round ?? 0;
              return round > maxRound ? m : max;
            }, bracket[0]);

          const winnerId = championshipMatch?.w ?? championshipMatch?.winner_roster_id;

          if (winnerId) {
            const winnerRoster = rosters.find(r => r.roster_id === winnerId);
            if (winnerRoster) {
              champion = {
                user: getUserByOwnerId(users, winnerRoster.owner_id),
                roster: winnerRoster,
              };
            }
          }
        }
      } catch (error) {
        console.error(`Error fetching playoff bracket for ${league.season}:`, error);
      }
    }

    return { league, users, rosters, champion };
  } catch {
    return null;
  }
}

interface LeaguePageProps {
  params: { leagueId: string };
}

export default async function HistoryPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

  try {
    // Get league history chain
    const leagueChain = await getLeagueHistory(leagueId);

    // Fetch every season's data and the all-time H2H map concurrently
    const [seasonsResults, h2hRecords] = await Promise.all([
      Promise.all(leagueChain.map(league => getSeasonData(league.league_id))),
      getHeadToHeadRecords(leagueId),
    ]);
    const seasonsData = seasonsResults.filter((d): d is SeasonData => d !== null);

    // Calculate all-time records
    const allTimeRecords = calculateAllTimeRecords(seasonsData);

    // Unique owners across all seasons, named by their most recent season
    const ownerMap = new Map<string, string>();
    for (const season of seasonsData) {
      for (const roster of season.rosters) {
        if (roster.owner_id && !ownerMap.has(roster.owner_id)) {
          const user = getUserByOwnerId(season.users, roster.owner_id);
          ownerMap.set(roster.owner_id, getTeamName(user, roster.roster_id));
        }
      }
    }
    const owners = Array.from(ownerMap, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl text-white">League History</h1>
          <p className="text-gray-400 mt-1">
            {seasonsData.length} Season{seasonsData.length !== 1 ? 's' : ''} of Glory
          </p>
        </div>

        {/* Championship History */}
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold text-white">Champions</h2>
          </div>
          <div className="p-4">
            {seasonsData.filter(s => s.champion).length > 0 ? (
              <div className="space-y-4">
                {seasonsData
                  .filter(s => s.champion)
                  .map((season) => (
                    <div
                      key={season.league.league_id}
                      className="flex items-center gap-4 p-3 bg-gray-800/30 rounded-lg"
                    >
                      <div className="text-2xl">🏆</div>
                      <Image
                        src={getUserAvatarUrl(season.champion!.user?.avatar || null)}
                        alt={season.champion!.user?.display_name || 'Champion'}
                        width={48}
                        height={48}
                        className="rounded-full"
                      />
                      <div className="flex-1">
                        <p className="text-lg font-semibold text-sleeper-accent">
                          {season.champion!.user?.display_name ||
                           season.champion!.user?.username ||
                           `Team ${season.champion!.roster.roster_id}`}
                        </p>
                        <p className="text-sm text-gray-400">
                          {season.league.season} Season Champion
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-400">Record</p>
                        <p className="text-white font-medium">
                          {season.champion!.roster.settings.wins}-
                          {season.champion!.roster.settings.losses}
                          {season.champion!.roster.settings.ties > 0 &&
                            `-${season.champion!.roster.settings.ties}`}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-4">No completed seasons yet</p>
            )}
          </div>
        </div>

        {/* All-Time Records */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Most Points (Season) */}
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white">Most Points (Season)</h2>
            </div>
            <div className="p-4 space-y-2">
              {allTimeRecords.mostPointsSeason.slice(0, 5).map((record, idx) => (
                <div
                  key={`${record.season}-${record.rosterId}`}
                  className="flex items-center gap-3 p-2 bg-gray-800/30 rounded"
                >
                  <span className="text-sm text-gray-500 w-6">{ordinalSuffix(idx + 1)}</span>
                  <span className="flex-1 text-white">{record.teamName}</span>
                  <span className="text-sleeper-green font-medium">{record.points.toFixed(2)}</span>
                  <span className="text-xs text-gray-500">{record.season}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Most Wins (Season) */}
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white">Most Wins (Season)</h2>
            </div>
            <div className="p-4 space-y-2">
              {allTimeRecords.mostWinsSeason.slice(0, 5).map((record, idx) => (
                <div
                  key={`${record.season}-${record.rosterId}`}
                  className="flex items-center gap-3 p-2 bg-gray-800/30 rounded"
                >
                  <span className="text-sm text-gray-500 w-6">{ordinalSuffix(idx + 1)}</span>
                  <span className="flex-1 text-white">{record.teamName}</span>
                  <span className="text-sleeper-green font-medium">{record.wins}-{record.losses}</span>
                  <span className="text-xs text-gray-500">{record.season}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Head-to-Head Rivalry Grid */}
        <H2HGrid owners={owners} h2hRecords={h2hRecords} />

        {/* Season-by-Season Archive */}
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold text-white">Season Archive</h2>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {seasonsData.map((season) => {
              const sortedRosters = [...season.rosters].sort((a, b) => {
                const winsDiff = (b.settings.wins || 0) - (a.settings.wins || 0);
                if (winsDiff !== 0) return winsDiff;
                const aPoints = (a.settings.fpts || 0) + (a.settings.fpts_decimal || 0) / 100;
                const bPoints = (b.settings.fpts || 0) + (b.settings.fpts_decimal || 0) / 100;
                return bPoints - aPoints;
              });

              return (
                <div key={season.league.league_id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-medium text-white">
                      {season.league.season} Season
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded ${
                      season.league.status === 'complete'
                        ? 'bg-sleeper-green/20 text-sleeper-green'
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {season.league.status === 'complete' ? 'Completed' : 'In Progress'}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 text-left">
                          <th className="pb-2 pr-4">#</th>
                          <th className="pb-2 pr-4">Team</th>
                          <th className="pb-2 pr-4 text-center">W</th>
                          <th className="pb-2 pr-4 text-center">L</th>
                          <th className="pb-2 text-right">PF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRosters.map((roster, idx) => {
                          const user = getUserByOwnerId(season.users, roster.owner_id);
                          return (
                            <tr key={roster.roster_id} className="text-gray-300">
                              <td className="py-1 pr-4 text-gray-500">{idx + 1}</td>
                              <td className="py-1 pr-4">
                                {getTeamName(user, roster.roster_id)}
                              </td>
                              <td className="py-1 pr-4 text-center text-sleeper-green">
                                {roster.settings.wins || 0}
                              </td>
                              <td className="py-1 pr-4 text-center text-sleeper-red">
                                {roster.settings.losses || 0}
                              </td>
                              <td className="py-1 text-right">
                                {formatPoints(roster.settings.fpts || 0, roster.settings.fpts_decimal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading history:', error);
    return <ErrorState title="Error Loading League History" />;
  }
}

interface SeasonRecord {
  season: string;
  rosterId: number;
  teamName: string;
  points: number;
  wins: number;
  losses: number;
}

function calculateAllTimeRecords(seasonsData: SeasonData[]) {
  const allRecords: SeasonRecord[] = [];

  for (const season of seasonsData) {
    for (const roster of season.rosters) {
      const user = getUserByOwnerId(season.users, roster.owner_id);
      const points = (roster.settings.fpts || 0) + (roster.settings.fpts_decimal || 0) / 100;

      allRecords.push({
        season: season.league.season,
        rosterId: roster.roster_id,
        teamName: getTeamName(user, roster.roster_id),
        points,
        wins: roster.settings.wins || 0,
        losses: roster.settings.losses || 0,
      });
    }
  }

  return {
    mostPointsSeason: [...allRecords].sort((a, b) => b.points - a.points),
    mostWinsSeason: [...allRecords].sort((a, b) => {
      const winsDiff = b.wins - a.wins;
      if (winsDiff !== 0) return winsDiff;
      return a.losses - b.losses;
    }),
  };
}
