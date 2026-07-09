'use client';

import type { PickAsset, PlayerAsset, TeamAssets } from './types';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE'];
const MAX_PLAYERS_PER_SIDE = 15;
const MAX_PICKS_PER_SIDE = 10;

export type AssetSelection = { playerIds: Set<string>; pickIds: Set<string> };

// Players arrive pre-sorted by position rank + name (tradeQueries.ts); this
// just buckets them into QB/RB/WR/TE groups first, then any remaining
// positions (K, DEF, ...) alphabetically.
function groupPlayersByPosition(players: readonly PlayerAsset[]): [string, PlayerAsset[]][] {
  const groups = new Map<string, PlayerAsset[]>();
  for (const p of players) {
    const list = groups.get(p.position) ?? [];
    list.push(p);
    groups.set(p.position, list);
  }
  const known = POSITION_ORDER.filter((pos) => groups.has(pos));
  const rest = [...groups.keys()].filter((pos) => !POSITION_ORDER.includes(pos)).sort();
  return [...known, ...rest].map((pos) => [pos, groups.get(pos) ?? []]);
}

function groupPicksBySeason(picks: readonly PickAsset[]): [number, PickAsset[]][] {
  const groups = new Map<number, PickAsset[]>();
  for (const p of picks) {
    const list = groups.get(p.season) ?? [];
    list.push(p);
    groups.set(p.season, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function CheckboxRow({
  id,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2 text-sm px-2 py-1 rounded-md cursor-pointer ${checked ? 'bg-white/[0.06]' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="accent-gold-500" />
      <span className="text-gray-200 truncate">{label}</span>
    </label>
  );
}

export default function AssetPicker({
  title,
  assets,
  selection,
  disabled,
  onTogglePlayer,
  onTogglePick,
}: {
  title: string;
  assets: TeamAssets;
  selection: AssetSelection;
  disabled: boolean;
  onTogglePlayer: (playerId: string) => void;
  onTogglePick: (pickId: string) => void;
}) {
  const playersAtCap = selection.playerIds.size >= MAX_PLAYERS_PER_SIDE;
  const picksAtCap = selection.pickIds.size >= MAX_PICKS_PER_SIDE;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-300">{title}</h4>
      {assets.players.length === 0 && assets.picks.length === 0 ? (
        <p className="text-xs text-gray-500 italic">No tradeable assets.</p>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1 border border-white/[0.06] rounded-lg p-2">
          {groupPlayersByPosition(assets.players).map(([position, players]) => (
            <div key={position}>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{position}</p>
              {players.map((player) => (
                <CheckboxRow
                  key={player.playerId}
                  id={`${title}-player-${player.playerId}`}
                  checked={selection.playerIds.has(player.playerId)}
                  disabled={disabled || (!selection.playerIds.has(player.playerId) && playersAtCap)}
                  onToggle={() => onTogglePlayer(player.playerId)}
                  label={
                    <>
                      {player.fullName}
                      {player.status !== 'active' && <span className="text-gray-500"> ({player.status})</span>}
                    </>
                  }
                />
              ))}
            </div>
          ))}
          {groupPicksBySeason(assets.picks).map(([season, picks]) => (
            <div key={season}>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{season} picks</p>
              {picks.map((pick) => (
                <CheckboxRow
                  key={pick.id}
                  id={`${title}-pick-${pick.id}`}
                  checked={selection.pickIds.has(pick.id)}
                  disabled={disabled || (!selection.pickIds.has(pick.id) && picksAtCap)}
                  onToggle={() => onTogglePick(pick.id)}
                  label={`Round ${pick.round} (from ${pick.originalTeamName})`}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-500">
        {selection.playerIds.size}/{MAX_PLAYERS_PER_SIDE} players
        {playersAtCap && ' (max reached)'} · {selection.pickIds.size}/{MAX_PICKS_PER_SIDE} picks
        {picksAtCap && ' (max reached)'}
      </p>
    </div>
  );
}
