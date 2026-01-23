import { SleeperRoster, SleeperUser } from '@/lib/types';
import { getUserByOwnerId, formatPoints, getUserAvatarUrl } from '@/lib/sleeper';
import Image from 'next/image';

interface StandingsProps {
  rosters: SleeperRoster[];
  users: SleeperUser[];
}

export default function Standings({ rosters, users }: StandingsProps) {
  const sortedRosters = [...rosters].sort((a, b) => {
    const winsDiff = (b.settings.wins || 0) - (a.settings.wins || 0);
    if (winsDiff !== 0) return winsDiff;

    const aPoints = (a.settings.fpts || 0) + (a.settings.fpts_decimal || 0) / 100;
    const bPoints = (b.settings.fpts || 0) + (b.settings.fpts_decimal || 0) / 100;
    return bPoints - aPoints;
  });

  // Calculate league averages for comparison
  const totalTeams = sortedRosters.length;
  const avgPoints = sortedRosters.reduce((sum, r) => {
    return sum + (r.settings.fpts || 0) + (r.settings.fpts_decimal || 0) / 100;
  }, 0) / totalTeams;

  const avgMaxPF = sortedRosters.reduce((sum, r) => {
    return sum + (r.settings.ppts || 0) + (r.settings.ppts_decimal || 0) / 100;
  }, 0) / totalTeams;

  return (
    <div className="bg-sleeper-darker rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Standings</h2>
        <div className="text-xs text-gray-500">
          Avg PF: {avgPoints.toFixed(1)} | Avg MaxPF: {avgMaxPF.toFixed(1)}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Rank
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Team
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Record
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Win %
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                PF
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                PA
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" title="Maximum Potential Points - Best possible score if optimal lineup was set">
                MaxPF
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" title="Lineup Efficiency - Actual Points / Max Potential Points">
                Eff %
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider" title="Points differential (PF - PA)">
                +/-
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sortedRosters.map((roster, index) => {
              const user = getUserByOwnerId(users, roster.owner_id);
              const teamName = user?.display_name || user?.username || `Team ${roster.roster_id}`;

              const wins = roster.settings.wins || 0;
              const losses = roster.settings.losses || 0;
              const ties = roster.settings.ties || 0;
              const totalGames = wins + losses + ties;

              const pf = (roster.settings.fpts || 0) + (roster.settings.fpts_decimal || 0) / 100;
              const pa = (roster.settings.fpts_against || 0) + (roster.settings.fpts_against_decimal || 0) / 100;
              const maxPF = (roster.settings.ppts || 0) + (roster.settings.ppts_decimal || 0) / 100;

              const winPct = totalGames > 0 ? ((wins + ties * 0.5) / totalGames * 100) : 0;
              const efficiency = maxPF > 0 ? (pf / maxPF * 100) : 0;
              const differential = pf - pa;

              // Determine playoff position styling (top 6 typically make playoffs)
              const isPlayoffSpot = index < 6;
              const isOnBubble = index >= 4 && index < 8;

              return (
                <tr
                  key={roster.roster_id}
                  className={`hover:bg-gray-800/30 transition-colors ${
                    isPlayoffSpot ? 'border-l-2 border-l-sleeper-green' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-sm">
                    <span className={`font-medium ${
                      index === 0 ? 'text-yellow-400' :
                      index === 1 ? 'text-gray-300' :
                      index === 2 ? 'text-amber-600' :
                      isPlayoffSpot ? 'text-sleeper-green' :
                      'text-gray-400'
                    }`}>
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Image
                        src={getUserAvatarUrl(user?.avatar || null)}
                        alt={teamName}
                        width={36}
                        height={36}
                        className="rounded-full"
                      />
                      <div>
                        <span className="text-sm font-medium text-white block">
                          {teamName}
                        </span>
                        {user?.username && user.username !== teamName && (
                          <span className="text-xs text-gray-500">@{user.username}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm text-white font-medium">
                      <span className="text-sleeper-green">{wins}</span>
                      <span className="text-gray-500">-</span>
                      <span className="text-sleeper-red">{losses}</span>
                      {ties > 0 && (
                        <>
                          <span className="text-gray-500">-</span>
                          <span className="text-gray-400">{ties}</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-300">
                    {winPct.toFixed(0)}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-medium ${
                      pf > avgPoints ? 'text-sleeper-green' : pf < avgPoints * 0.95 ? 'text-sleeper-red' : 'text-white'
                    }`}>
                      {pf.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-400">
                    {pa.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm ${
                      maxPF > avgMaxPF ? 'text-sleeper-green' : 'text-gray-400'
                    }`}>
                      {maxPF.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm ${
                      efficiency >= 85 ? 'text-sleeper-green' :
                      efficiency >= 75 ? 'text-yellow-400' :
                      efficiency > 0 ? 'text-sleeper-red' :
                      'text-gray-500'
                    }`}>
                      {efficiency > 0 ? `${efficiency.toFixed(1)}%` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-sm font-medium ${
                      differential > 0 ? 'text-sleeper-green' :
                      differential < 0 ? 'text-sleeper-red' :
                      'text-gray-400'
                    }`}>
                      {differential > 0 ? '+' : ''}{differential.toFixed(2)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-gray-800 flex flex-wrap gap-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-sleeper-green rounded-sm"></div>
          <span>Playoff spot</span>
        </div>
        <div>
          <span className="text-gray-400">PF</span> = Points For
        </div>
        <div>
          <span className="text-gray-400">PA</span> = Points Against
        </div>
        <div>
          <span className="text-gray-400">MaxPF</span> = Maximum Potential Points
        </div>
        <div>
          <span className="text-gray-400">Eff %</span> = Lineup Efficiency (PF/MaxPF)
        </div>
      </div>
    </div>
  );
}
