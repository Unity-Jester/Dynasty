'use client';

import type { LineupPlayer } from './types';

// Bench candidates rendered by the picker are already bounded by the roster
// query (MAX_ROSTER = 100 in lineupQueries.ts); this is a defensive re-cap at
// the render layer (Rule 2/3), never expected to bind.
const MAX_PICKER_ROWS = 100;

export type PickerCandidate = {
  player: LineupPlayer;
  locked: boolean;
};

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 inline-block" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1a4 4 0 00-4 4v2H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-1V5a4 4 0 00-4-4zm2 6V5a2 2 0 10-4 0v2h4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CandidateRow({
  candidate,
  onPick,
}: {
  candidate: PickerCandidate;
  onPick: (playerId: string) => void;
}) {
  const { player, locked } = candidate;
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onPick(player.playerId)}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-white/[0.06] bg-white/[0.03] border border-white/[0.06]"
    >
      <span className="min-w-0">
        <span className="text-white text-sm font-medium truncate block">{player.fullName}</span>
        <span className="text-xs text-gray-500">
          {player.position} · {player.nflTeam ?? 'FA'}
        </span>
      </span>
      {locked && (
        <span className="flex items-center gap-1 text-[11px] text-amber-400 shrink-0">
          <LockIcon />
          Locked
        </span>
      )}
    </button>
  );
}

export default function PlayerPicker({
  title,
  candidates,
  canLeaveEmpty,
  onPick,
  onLeaveEmpty,
  onClose,
}: {
  title: string;
  candidates: PickerCandidate[];
  canLeaveEmpty: boolean;
  onPick: (playerId: string) => void;
  onLeaveEmpty: () => void;
  onClose: () => void;
}) {
  const rows = candidates.slice(0, MAX_PICKER_ROWS);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative w-full sm:max-w-md sm:mx-4 max-h-[80vh] flex flex-col panel rounded-t-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <h3 className="font-display text-base text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm px-2 py-1"
          >
            Cancel
          </button>
        </div>
        <div className="overflow-y-auto p-3 space-y-2">
          {canLeaveEmpty && (
            <button
              type="button"
              onClick={onLeaveEmpty}
              className="w-full px-4 py-3 rounded-lg text-left text-sm text-gray-400 hover:bg-white/[0.06] bg-white/[0.03] border border-white/[0.06] border-dashed"
            >
              Leave empty
            </button>
          )}
          {rows.length === 0 && (
            <p className="text-sm text-gray-500 px-1 py-2">No eligible bench players for this slot.</p>
          )}
          {rows.map((candidate) => (
            <CandidateRow key={candidate.player.playerId} candidate={candidate} onPick={onPick} />
          ))}
        </div>
      </div>
    </div>
  );
}
