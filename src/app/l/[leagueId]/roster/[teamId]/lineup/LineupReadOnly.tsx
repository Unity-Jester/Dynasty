import { slotLabel, type LineupPlayer, type SlotInstance } from './types';

function formatKickoff(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function ReadOnlyRow({
  label,
  player,
  kickoffIso,
}: {
  label: string;
  player: LineupPlayer | null;
  kickoffIso: string | undefined;
}) {
  const kickoffText = formatKickoff(kickoffIso);
  return (
    <div className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-xl panel">
      <span className="flex items-center gap-3 min-w-0">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium w-16 shrink-0">
          {label}
        </span>
        {player === null ? (
          <span className="text-sm text-gray-500">Empty</span>
        ) : (
          <span className="min-w-0">
            <span className="text-white text-sm font-medium truncate block">{player.fullName}</span>
            <span className="text-xs text-gray-500">
              {player.position} · {player.nflTeam ?? 'FA'}
            </span>
          </span>
        )}
      </span>
      {kickoffText && <span className="text-xs text-gray-500 shrink-0">{kickoffText}</span>}
    </div>
  );
}

export default function LineupReadOnly({
  instances,
  rosterById,
  kickoffs,
}: {
  instances: SlotInstance[];
  rosterById: Map<string, LineupPlayer>;
  kickoffs: Record<string, string>;
}) {
  const slotCounts = new Map<string, number>();
  for (const inst of instances) {
    slotCounts.set(inst.slot, (slotCounts.get(inst.slot) ?? 0) + 1);
  }

  return (
    <div className="space-y-3">
      {instances.map((inst) => {
        const player = inst.playerId !== null ? rosterById.get(inst.playerId) ?? null : null;
        return (
          <ReadOnlyRow
            key={`${inst.slot}:${inst.slotIndex}`}
            label={slotLabel(inst.slot, inst.slotIndex, slotCounts.get(inst.slot) ?? 1)}
            player={player}
            kickoffIso={player?.nflTeam ? kickoffs[player.nflTeam] : undefined}
          />
        );
      })}
    </div>
  );
}
