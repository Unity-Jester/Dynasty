import {
  SleeperTransaction,
  SleeperRoster,
  SleeperUser,
  SleeperPlayersMap,
  TradeValueSwing,
  TransactionValueChange,
} from '@/lib/types';
import { getUserByOwnerId, getPlayerAvatarUrl, getUserAvatarUrl } from '@/lib/sleeper';
import { timeAgo, cn, getTeamName as teamDisplayName } from '@/lib/utils';
import Image from 'next/image';

interface TransactionCardProps {
  transaction: SleeperTransaction;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  players: SleeperPlayersMap;
  tradeValues?: TradeValueSwing[];
  valueChanges?: TransactionValueChange[];
}

function formatNet(value: number): string {
  const abs = Math.abs(Math.round(value)).toLocaleString();
  return value > 0 ? `+${abs}` : value < 0 ? `-${abs}` : '0';
}

function formatValue(value: number): string {
  return Math.round(value).toLocaleString();
}

// Compact value-swing chip shown next to each side of a trade
function ValueSwingChip({ swing }: { swing: TradeValueSwing }) {
  const color =
    swing.netAverage > 0
      ? 'text-sleeper-green bg-sleeper-green/10'
      : swing.netAverage < 0
        ? 'text-sleeper-red bg-sleeper-red/10'
        : 'text-gray-400 bg-white/[0.06]';
  return (
    <span
      className={`ml-auto shrink-0 px-2 py-0.5 rounded text-xs font-medium tabular-nums ${color}`}
      title={`Net value - at trade: ${formatNet(swing.netAtTrade)} · today: ${formatNet(swing.netCurrent)}`}
    >
      {formatNet(swing.netAverage)}
    </span>
  );
}

function ValueChangeChip({ change }: { change: TransactionValueChange }) {
  const color =
    change.netValue > 0
      ? 'text-sleeper-green bg-sleeper-green/10'
      : change.netValue < 0
        ? 'text-sleeper-red bg-sleeper-red/10'
        : 'text-gray-400 bg-white/[0.06]';

  return (
    <span
      className={`ml-auto shrink-0 px-2 py-0.5 rounded text-xs font-medium tabular-nums ${color}`}
      title={`Value change - added: ${formatValue(change.addedValue)} · dropped: ${formatValue(change.droppedValue)}`}
    >
      {formatNet(change.netValue)}
    </span>
  );
}

export default function TransactionCard({
  transaction,
  rosters,
  users,
  players,
  tradeValues,
  valueChanges,
}: TransactionCardProps) {
  const getTeamName = (rosterId: number) => {
    const roster = rosters.find(r => r.roster_id === rosterId);
    if (!roster) return `Team ${rosterId}`;
    const user = getUserByOwnerId(users, roster.owner_id);
    return teamDisplayName(user, rosterId);
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
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-sleeper-accent uppercase">Trade</span>
          <span className="text-xs text-gray-500">{timeAgo(transaction.created)}</span>
        </div>

        <div className="space-y-3">
          {involvedTeams.map((rosterId) => (
            <div key={rosterId} className="border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
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
                {(() => {
                  const swing = tradeValues?.find(v => v.rosterId === rosterId);
                  return swing ? <ValueSwingChip swing={swing} /> : null;
                })()}
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
  const valueChange = valueChanges?.find(v => v.rosterId === rosterId);

  return (
    <div className="panel p-4">
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
        {valueChange && <ValueChangeChip change={valueChange} />}
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
