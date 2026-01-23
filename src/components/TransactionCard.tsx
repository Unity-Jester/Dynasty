import { SleeperTransaction, SleeperRoster, SleeperUser, SleeperPlayersMap } from '@/lib/types';
import { getUserByOwnerId, getPlayerAvatarUrl, getUserAvatarUrl } from '@/lib/sleeper';
import { timeAgo, cn } from '@/lib/utils';
import Image from 'next/image';

interface TransactionCardProps {
  transaction: SleeperTransaction;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: SleeperPlayersMap;
}

export default function TransactionCard({ transaction, rosters, users, players }: TransactionCardProps) {
  const getTeamName = (rosterId: number) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    if (!roster) return `Team ${rosterId}`;
    const user = getUserByOwnerId(users, roster.owner_id);
    return user?.display_name || user?.username || `Team ${rosterId}`;
  };

  const getTeamAvatar = (rosterId: number) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    if (!roster) return null;
    const user = getUserByOwnerId(users, roster.owner_id);
    return user?.avatar || null;
  };

  if (transaction.type === 'trade') {
    // Group adds by roster_id
    const teamAdds: Record<number, string[]> = {};
    if (transaction.adds) {
      Object.entries(transaction.adds).forEach(([playerId, rosterId]) => {
        if (!teamAdds[rosterId]) teamAdds[rosterId] = [];
        teamAdds[rosterId].push(playerId);
      });
    }

    // Group draft picks by owner_id
    const teamPicks: Record<number, typeof transaction.draft_picks> = {};
    transaction.draft_picks?.forEach(pick => {
      if (!teamPicks[pick.owner_id]) teamPicks[pick.owner_id] = [];
      teamPicks[pick.owner_id].push(pick);
    });

    const involvedTeams = [...new Set([
      ...Object.keys(teamAdds).map(Number),
      ...Object.keys(teamPicks).map(Number),
    ])];

    return (
      <div className="bg-sleeper-darker rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-sleeper-accent uppercase">Trade</span>
          <span className="text-xs text-gray-500">{timeAgo(transaction.created)}</span>
        </div>

        <div className="space-y-3">
          {involvedTeams.map((rosterId) => (
            <div key={rosterId} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 mb-2">
                <Image
                  src={getUserAvatarUrl(getTeamAvatar(rosterId))}
                  alt={getTeamName(rosterId)}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span className="text-sm font-medium text-white">
                  {getTeamName(rosterId)} receives:
                </span>
              </div>

              <div className="ml-8 space-y-1">
                {teamAdds[rosterId]?.map(playerId => {
                  const player = players[playerId];
                  return (
                    <div key={playerId} className="flex items-center gap-2">
                      <Image
                        src={getPlayerAvatarUrl(playerId)}
                        alt={player?.full_name || playerId}
                        width={20}
                        height={20}
                        className="rounded-full"
                      />
                      <span className="text-sm text-sleeper-green">
                        {player?.full_name || playerId}
                      </span>
                      <span className="text-xs text-gray-500">
                        {player?.position} - {player?.team || 'FA'}
                      </span>
                    </div>
                  );
                })}

                {teamPicks[rosterId]?.map((pick, idx) => (
                  <div key={idx} className="text-sm text-sleeper-green">
                    {pick.season} Round {pick.round} Pick
                    {pick.previous_owner_id !== pick.owner_id && (
                      <span className="text-gray-500"> (from {getTeamName(pick.previous_owner_id)})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Waiver/Free Agent
  const adds = Object.entries(transaction.adds || {});
  const drops = Object.entries(transaction.drops || {});
  const rosterId = transaction.roster_ids[0];

  return (
    <div className="bg-sleeper-darker rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-medium uppercase',
            transaction.type === 'waiver' ? 'text-yellow-400' : 'text-gray-400'
          )}>
            {transaction.type === 'waiver' ? 'Waiver' : 'Free Agent'}
          </span>
          {transaction.settings?.waiver_bid && (
            <span className="text-xs text-gray-500">
              (${transaction.settings.waiver_bid})
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{timeAgo(transaction.created)}</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Image
          src={getUserAvatarUrl(getTeamAvatar(rosterId))}
          alt={getTeamName(rosterId)}
          width={24}
          height={24}
          className="rounded-full"
        />
        <span className="text-sm font-medium text-white">
          {getTeamName(rosterId)}
        </span>
      </div>

      <div className="ml-8 space-y-1">
        {adds.map(([playerId]) => {
          const player = players[playerId];
          return (
            <div key={playerId} className="flex items-center gap-2">
              <span className="text-sleeper-green text-sm">+</span>
              <Image
                src={getPlayerAvatarUrl(playerId)}
                alt={player?.full_name || playerId}
                width={20}
                height={20}
                className="rounded-full"
              />
              <span className="text-sm text-sleeper-green">
                {player?.full_name || playerId}
              </span>
              <span className="text-xs text-gray-500">
                {player?.position} - {player?.team || 'FA'}
              </span>
            </div>
          );
        })}

        {drops.map(([playerId]) => {
          const player = players[playerId];
          return (
            <div key={playerId} className="flex items-center gap-2">
              <span className="text-sleeper-red text-sm">-</span>
              <Image
                src={getPlayerAvatarUrl(playerId)}
                alt={player?.full_name || playerId}
                width={20}
                height={20}
                className="rounded-full"
              />
              <span className="text-sm text-sleeper-red">
                {player?.full_name || playerId}
              </span>
              <span className="text-xs text-gray-500">
                {player?.position} - {player?.team || 'FA'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
