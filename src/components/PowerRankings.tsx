import { SleeperRoster, SleeperUser, SleeperPlayersMap } from '@/lib/types';
import { getUserAvatarUrl, getUserByOwnerId } from '@/lib/sleeper';
import {
  fetchFantasyCalcValues,
  fetchDynastyProcessValues,
  calculatePowerRankings,
  TeamPowerRanking,
} from '@/lib/rankings';
import Image from 'next/image';

interface PowerRankingsProps {
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: SleeperPlayersMap;
}

export default async function PowerRankings({ rosters, users, players }: PowerRankingsProps) {
  // Fetch values from both sources in parallel
  const [fcResult, dpValues] = await Promise.all([
    fetchFantasyCalcValues(),
    fetchDynastyProcessValues(),
  ]);

  // Extract player values from FantasyCalc result
  const fcValues = fcResult.playerValues;

  // Build player name map
  const playerNames = new Map<string, string>();
  Object.entries(players).forEach(([id, player]) => {
    playerNames.set(id, player.full_name);
  });

  // Prepare roster and user data
  const rosterData = rosters.map(r => ({
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    players: r.players,
  }));

  const userData = users.map(u => ({
    user_id: u.user_id,
    display_name: u.display_name,
    username: u.username,
  }));

  // Calculate rankings - FantasyCalc uses Sleeper IDs, DynastyProcess uses player names
  const fcRankings = calculatePowerRankings(rosterData, userData, fcValues, playerNames, false);
  const dpRankings = calculatePowerRankings(rosterData, userData, dpValues, playerNames, true);

  const hasFCData = fcValues.size > 0;
  const hasDPData = dpValues.size > 0;

  if (!hasFCData && !hasDPData) {
    return (
      <div className="bg-sleeper-darker rounded-lg p-6 text-center">
        <h2 className="text-lg font-semibold text-white mb-2">Power Rankings</h2>
        <p className="text-gray-400">Unable to load power rankings data</p>
      </div>
    );
  }

  const RankingColumn = ({
    title,
    rankings,
    hasData,
    subtitle,
    linkUrl,
    linkText,
  }: {
    title: string;
    rankings: TeamPowerRanking[];
    hasData: boolean;
    subtitle: string;
    linkUrl: string;
    linkText: string;
  }) => (
    <div className="bg-sleeper-darker rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sleeper-accent hover:underline"
          >
            {linkText}
          </a>
        </div>
      </div>

      {hasData ? (
        <div className="divide-y divide-gray-800">
          {rankings.map((team) => {
            const roster = rosters.find(r => r.roster_id === team.rosterId);
            const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;

            return (
              <div key={team.rosterId} className="px-4 py-3 flex items-center gap-3">
                <span
                  className={`text-lg font-bold w-8 ${
                    team.rank === 1
                      ? 'text-yellow-400'
                      : team.rank === 2
                      ? 'text-gray-300'
                      : team.rank === 3
                      ? 'text-amber-600'
                      : 'text-gray-500'
                  }`}
                >
                  {team.rank}
                </span>
                <Image
                  src={getUserAvatarUrl(user?.avatar || null)}
                  alt={team.teamName}
                  width={32}
                  height={32}
                  className="rounded-full"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{team.teamName}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {team.topPlayers
                      .slice(0, 2)
                      .map(p => p.name)
                      .join(', ')}
                  </p>
                </div>
                <span className="text-sm font-medium text-sleeper-accent tabular-nums">
                  {team.totalValue.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4 text-center text-gray-400 text-sm">Unable to load data</div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Power Rankings</h2>

      <div className="grid md:grid-cols-2 gap-4">
        <RankingColumn
          title="FantasyCalc"
          rankings={fcRankings}
          hasData={hasFCData}
          subtitle="Dynasty trade values"
          linkUrl="https://fantasycalc.com/dynasty-rankings"
          linkText="View Rankings"
        />
        <RankingColumn
          title="DynastyProcess"
          rankings={dpRankings}
          hasData={hasDPData}
          subtitle="Aggregated dynasty values"
          linkUrl="https://dynastyprocess.com/values"
          linkText="View Rankings"
        />
      </div>
    </div>
  );
}
