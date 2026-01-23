import { MatchupPair, SleeperPlayersMap } from '@/lib/types';
import { getUserAvatarUrl, getPlayerAvatarUrl } from '@/lib/sleeper';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface H2HRecord {
  wins: number;
  losses: number;
  ties: number;
}

interface MatchupProps {
  matchup: MatchupPair;
  players?: SleeperPlayersMap;
  showStarters?: boolean;
  h2hRecord?: H2HRecord | null;
}

export default function Matchup({ matchup, players, showStarters = false, h2hRecord }: MatchupProps) {
  const { team1, team2 } = matchup;
  const team1Winning = team1.points > team2.points;
  const team2Winning = team2.points > team1.points;
  const isTied = team1.points === team2.points && team1.points > 0;

  return (
    <div className="bg-sleeper-darker rounded-lg overflow-hidden">
      <div className="p-4">
        {/* H2H Record Banner */}
        {h2hRecord && (h2hRecord.wins > 0 || h2hRecord.losses > 0 || h2hRecord.ties > 0) && (
          <div className="mb-3 pb-3 border-b border-gray-800">
            <div className="flex items-center justify-center gap-2 text-xs">
              <span className="text-gray-500">All-Time H2H:</span>
              <span className={cn(
                'font-medium',
                h2hRecord.wins > h2hRecord.losses ? 'text-sleeper-green' :
                h2hRecord.wins < h2hRecord.losses ? 'text-sleeper-red' :
                'text-gray-400'
              )}>
                {team1.teamName}
              </span>
              <span className="text-white font-bold">
                {h2hRecord.wins}-{h2hRecord.losses}
                {h2hRecord.ties > 0 && `-${h2hRecord.ties}`}
              </span>
              <span className={cn(
                'font-medium',
                h2hRecord.losses > h2hRecord.wins ? 'text-sleeper-green' :
                h2hRecord.losses < h2hRecord.wins ? 'text-sleeper-red' :
                'text-gray-400'
              )}>
                {team2.teamName}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          {/* Team 1 */}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Image
                src={getUserAvatarUrl(team1.user?.avatar || null)}
                alt={team1.teamName}
                width={40}
                height={40}
                className="rounded-full"
              />
              <div className="min-w-0">
                <p className={cn(
                  'text-sm font-medium truncate',
                  team1Winning ? 'text-sleeper-green' : 'text-white'
                )}>
                  {team1.teamName}
                </p>
                <p className="text-xs text-gray-400">
                  {team1.user?.username}
                </p>
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="flex items-center gap-2 px-4">
            <span className={cn(
              'text-2xl font-bold tabular-nums',
              team1Winning ? 'text-sleeper-green' : isTied ? 'text-yellow-400' : 'text-white'
            )}>
              {team1.points.toFixed(2)}
            </span>
            <span className="text-gray-500 text-lg">-</span>
            <span className={cn(
              'text-2xl font-bold tabular-nums',
              team2Winning ? 'text-sleeper-green' : isTied ? 'text-yellow-400' : 'text-white'
            )}>
              {team2.points.toFixed(2)}
            </span>
          </div>

          {/* Team 2 */}
          <div className="flex-1">
            <div className="flex items-center justify-end gap-3">
              <div className="min-w-0 text-right">
                <p className={cn(
                  'text-sm font-medium truncate',
                  team2Winning ? 'text-sleeper-green' : 'text-white'
                )}>
                  {team2.teamName}
                </p>
                <p className="text-xs text-gray-400">
                  {team2.user?.username}
                </p>
              </div>
              <Image
                src={getUserAvatarUrl(team2.user?.avatar || null)}
                alt={team2.teamName}
                width={40}
                height={40}
                className="rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Starters comparison */}
        {showStarters && players && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="grid grid-cols-2 gap-4">
              {/* Team 1 Starters */}
              <div className="space-y-2">
                {team1.starters.map((playerId, idx) => {
                  const player = players[playerId];
                  const points = team1.startersPoints[idx] || 0;
                  return (
                    <div key={`${playerId}-${idx}`} className="flex items-center gap-2">
                      <Image
                        src={getPlayerAvatarUrl(playerId)}
                        alt={player?.full_name || playerId}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                      <span className="text-xs text-gray-400 flex-1 truncate">
                        {player?.full_name || playerId}
                      </span>
                      <span className="text-xs font-medium text-white tabular-nums">
                        {points.toFixed(1)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Team 2 Starters */}
              <div className="space-y-2">
                {team2.starters.map((playerId, idx) => {
                  const player = players[playerId];
                  const points = team2.startersPoints[idx] || 0;
                  return (
                    <div key={`${playerId}-${idx}`} className="flex items-center gap-2 justify-end">
                      <span className="text-xs font-medium text-white tabular-nums">
                        {points.toFixed(1)}
                      </span>
                      <span className="text-xs text-gray-400 flex-1 truncate text-right">
                        {player?.full_name || playerId}
                      </span>
                      <Image
                        src={getPlayerAvatarUrl(playerId)}
                        alt={player?.full_name || playerId}
                        width={24}
                        height={24}
                        className="rounded-full"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
