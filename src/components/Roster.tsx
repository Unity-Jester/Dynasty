import { SleeperRoster, SleeperPlayersMap } from '@/lib/types';
import { getPlayerAvatarUrl } from '@/lib/sleeper';
import { getPositionTextColor } from '@/lib/utils';
import Image from 'next/image';

interface RosterProps {
  roster: SleeperRoster;
  players: SleeperPlayersMap;
  rosterPositions: string[];
  teamName: string;
}

export default function Roster({ roster, players, rosterPositions, teamName }: RosterProps) {
  const starters = roster.starters || [];
  const bench = (roster.players || []).filter(p => !starters.includes(p));

  const starterSlots = rosterPositions.filter(pos => pos !== 'BN');

  return (
    <div className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-lg font-semibold text-white">{teamName}</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Starters */}
        <div>
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
            Starters
          </h3>
          <div className="space-y-2">
            {starters.map((playerId, idx) => {
              const player = players[playerId];
              const slotPosition = starterSlots[idx] || 'FLEX';

              return (
                <div
                  key={`${playerId}-${idx}`}
                  className="flex items-center gap-3 p-2 bg-gray-800/30 rounded-lg"
                >
                  <span className={`text-xs font-medium w-12 ${getPositionTextColor(slotPosition)}`}>
                    {slotPosition}
                  </span>
                  <Image
                    src={getPlayerAvatarUrl(playerId)}
                    alt={player?.full_name || playerId}
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {player?.full_name || playerId}
                    </p>
                    <p className="text-xs text-gray-400">
                      {player?.team || 'FA'} - {player?.position || '??'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bench */}
        {bench.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Bench
            </h3>
            <div className="space-y-2">
              {bench.map((playerId) => {
                const player = players[playerId];

                return (
                  <div
                    key={playerId}
                    className="flex items-center gap-3 p-2 bg-gray-800/20 rounded-lg"
                  >
                    <span className={`text-xs font-medium w-12 ${getPositionTextColor('BN')}`}>
                      BN
                    </span>
                    <Image
                      src={getPlayerAvatarUrl(playerId)}
                      alt={player?.full_name || playerId}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {player?.full_name || playerId}
                      </p>
                      <p className="text-xs text-gray-400">
                        {player?.team || 'FA'} - {player?.position || '??'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* IR/Taxi */}
        {roster.reserve && roster.reserve.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              IR
            </h3>
            <div className="space-y-2">
              {roster.reserve.map((playerId) => {
                const player = players[playerId];

                return (
                  <div
                    key={playerId}
                    className="flex items-center gap-3 p-2 bg-red-900/20 rounded-lg"
                  >
                    <span className="text-xs font-medium w-12 text-red-400">
                      IR
                    </span>
                    <Image
                      src={getPlayerAvatarUrl(playerId)}
                      alt={player?.full_name || playerId}
                      width={32}
                      height={32}
                      className="rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {player?.full_name || playerId}
                      </p>
                      <p className="text-xs text-gray-400">
                        {player?.team || 'FA'} - {player?.position || '??'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
