import Image from 'next/image';
import { SleeperRoster, SleeperUser } from '@/lib/types';
import { getUserByOwnerId, getUserAvatarUrl } from '@/lib/sleeper';
import { getTeamName } from '@/lib/utils';
import { LuckRow } from '@/lib/seasonStats';

interface LuckIndexProps {
  rows: LuckRow[];
  rosters: SleeperRoster[];
  users: SleeperUser[];
}

// Luck = actual wins minus "all-play" expected wins. A team that outscores
// most of the league but keeps drawing the week's top opponent shows up
// here as unlucky rather than bad.
export default function LuckIndex({ rows, rosters, users }: LuckIndexProps) {
  if (rows.length === 0) return null;

  const teamFor = (rosterId: number) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;
    return { name: getTeamName(user, rosterId), avatar: user?.avatar || null };
  };

  const luckColor = (luck: number) =>
    luck > 0.5 ? 'text-sleeper-green' : luck < -0.5 ? 'text-sleeper-red' : 'text-gray-300';

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-lg font-semibold text-white">Luck Index</h2>
        <p className="text-sm text-gray-400">
          Expected wins if every team played every other team each week (&ldquo;all-play&rdquo;),
          compared to actual record
        </p>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="pb-2 pr-4">Team</th>
              <th className="pb-2 pr-4 text-center">Record</th>
              <th className="pb-2 pr-4 text-center">Expected Wins</th>
              <th className="pb-2 text-right">Luck</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const team = teamFor(row.rosterId);
              return (
                <tr key={row.rosterId} className="text-gray-300 border-t border-gray-800/50">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <Image
                        src={getUserAvatarUrl(team.avatar)}
                        alt={team.name}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                      <span className="text-white truncate max-w-[180px]">{team.name}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-center tabular-nums">
                    {row.actualWins}-{row.actualLosses}
                    {row.actualTies > 0 ? `-${row.actualTies}` : ''}
                  </td>
                  <td className="py-2 pr-4 text-center tabular-nums">
                    {row.expectedWins.toFixed(1)}
                  </td>
                  <td className={`py-2 text-right font-medium tabular-nums ${luckColor(row.luck)}`}>
                    {row.luck > 0 ? '+' : ''}
                    {row.luck.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
