'use client';

import { cn } from '@/lib/utils';
import type { LineupPlayer } from './types';

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

function formatKickoff(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SlotRow({
  label,
  player,
  locked,
  kickoffIso,
  onTap,
}: {
  label: string;
  player: LineupPlayer | null;
  locked: boolean;
  kickoffIso: string | undefined;
  onTap: () => void;
}) {
  const kickoffText = formatKickoff(kickoffIso);
  const isEmpty = player === null;

  return (
    <button
      type="button"
      disabled={locked}
      onClick={onTap}
      className={cn(
        'w-full flex items-center justify-between gap-3 px-4 py-4 rounded-xl text-left transition-colors panel',
        locked ? 'cursor-not-allowed opacity-90' : 'enabled:hover:border-gold-500/25',
        isEmpty && 'ring-1 ring-amber-500/50',
      )}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium w-16 shrink-0">
          {label}
        </span>
        {isEmpty ? (
          <span className="text-sm text-amber-400">Empty</span>
        ) : (
          <span className="min-w-0">
            <span className="text-white text-sm font-medium truncate block">{player.fullName}</span>
            <span className="text-xs text-gray-500">
              {player.position} · {player.nflTeam ?? 'FA'}
            </span>
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5 shrink-0 text-xs">
        {locked && (
          <span className="flex items-center gap-1 text-amber-400">
            <LockIcon />
          </span>
        )}
        {kickoffText && <span className="text-gray-500">{kickoffText}</span>}
      </span>
    </button>
  );
}
