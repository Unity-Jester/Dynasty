import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueMatchups,
  getNFLState,
  getAllPlayers,
  pairMatchups,
  getHeadToHeadRecords,
  getH2HForOwners,
} from '@/lib/sleeper';
import { getLeagueId } from '@/lib/utils';
import Matchup from '@/components/Matchup';
import WeekSelector from './WeekSelector';

export const revalidate = 60;

interface MatchupsPageProps {
  searchParams: Promise<{ week?: string; season?: string }>;
}

export default async function MatchupsPage({ searchParams }: MatchupsPageProps) {
  const params = await searchParams;
  const leagueId = getLeagueId();

  if (!leagueId || leagueId === 'your_league_id_here') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Please configure your League ID first.</p>
      </div>
    );
  }

  try {
    const [currentLeague, nflState, players] = await Promise.all([
      getLeague(leagueId),
      getNFLState(),
      getAllPlayers(),
    ]);

    const isPreseason = currentLeague.status === 'pre_draft' || currentLeague.status === 'drafting';

    // Determine which league to show matchups from
    // If preseason and viewing previous season, use previous league ID
    const showPreviousSeason = params.season === 'previous' || (isPreseason && !params.season);

    let activeLeagueId = leagueId;
    let activeLeague = currentLeague;

    if (showPreviousSeason && currentLeague.previous_league_id) {
      activeLeagueId = currentLeague.previous_league_id;
      activeLeague = await getLeague(activeLeagueId);
    }

    const [users, rosters, h2hRecords] = await Promise.all([
      getLeagueUsers(activeLeagueId),
      getLeagueRosters(activeLeagueId),
      getHeadToHeadRecords(leagueId), // Always use current league to get full history
    ]);

    const totalWeeks = activeLeague.settings.playoff_week_start + 2; // Regular season + playoffs

    // Default to championship week if viewing previous season, otherwise current week
    const defaultWeek = showPreviousSeason ? totalWeeks : Math.min(nflState.week || 1, totalWeeks);
    const selectedWeek = params.week ? parseInt(params.week) : defaultWeek;

    const matchups = await getLeagueMatchups(activeLeagueId, selectedWeek);
    const matchupPairs = pairMatchups(matchups, rosters, users);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Matchup Center</h1>
            <p className="text-sm text-gray-400">
              {activeLeague.season} Season
              {showPreviousSeason && isPreseason && (
                <span className="ml-2 text-sleeper-accent">(Previous Season)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Season Toggle - only show if there's a previous season and we're in preseason */}
            {isPreseason && currentLeague.previous_league_id && (
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                <a
                  href={`/matchups?season=previous`}
                  className={`px-3 py-1.5 text-sm ${
                    showPreviousSeason
                      ? 'bg-sleeper-accent text-sleeper-dark'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {parseInt(currentLeague.season) - 1}
                </a>
                <a
                  href={`/matchups?season=current`}
                  className={`px-3 py-1.5 text-sm ${
                    !showPreviousSeason
                      ? 'bg-sleeper-accent text-sleeper-dark'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {currentLeague.season}
                </a>
              </div>
            )}
            <WeekSelector
              currentWeek={selectedWeek}
              totalWeeks={totalWeeks}
              playoffStart={activeLeague.settings.playoff_week_start}
              seasonParam={showPreviousSeason ? 'previous' : undefined}
            />
          </div>
        </div>

        <div className="grid gap-6">
          {matchupPairs.length > 0 ? (
            matchupPairs.map((matchup) => {
              // Get H2H record for this matchup
              const owner1Id = matchup.team1.roster.owner_id;
              const owner2Id = matchup.team2.roster.owner_id;
              const h2h = owner1Id && owner2Id
                ? getH2HForOwners(h2hRecords, owner1Id, owner2Id)
                : null;

              return (
                <Matchup
                  key={matchup.matchupId}
                  matchup={matchup}
                  players={players}
                  showStarters={true}
                  h2hRecord={h2h}
                />
              );
            })
          ) : (
            <div className="text-center py-12 bg-sleeper-darker rounded-lg">
              <p className="text-gray-400">No matchups found for Week {selectedWeek}</p>
              {!showPreviousSeason && isPreseason && (
                <p className="text-sm text-gray-500 mt-2">
                  The {currentLeague.season} season hasn&apos;t started yet.
                  {currentLeague.previous_league_id && (
                    <a href="/matchups?season=previous" className="text-sleeper-accent ml-1 hover:underline">
                      View last season&apos;s matchups
                    </a>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  } catch (error) {
    console.error('Error loading matchups:', error);
    return (
      <div className="text-center py-12">
        <p className="text-sleeper-red">Error loading matchups</p>
      </div>
    );
  }
}
