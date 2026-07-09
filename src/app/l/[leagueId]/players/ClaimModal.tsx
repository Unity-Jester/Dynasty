'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitClaim } from '@/server/actions/waivers';
import { submitClaimErrorMessage } from './errorText';
import type { RosterOption, UnrosteredPlayer } from './types';
import type { LeagueSettings } from '@/engine/settings';

export default function ClaimModal({
  player,
  myTeamId,
  waivers,
  faabRemaining,
  rosterOptions,
  onClose,
}: {
  player: UnrosteredPlayer;
  myTeamId: string;
  waivers: LeagueSettings['waivers'];
  faabRemaining: number | null;
  rosterOptions: RosterOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isFaab = waivers.mode === 'faab';
  const effectiveRemaining = isFaab ? (faabRemaining ?? waivers.budget) : null;
  const [bid, setBid] = useState(0);
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    const result = await submitClaim({
      teamId: myTeamId,
      addPlayerId: player.id,
      dropPlayerId: dropPlayerId === '' ? null : dropPlayerId,
      bid: isFaab ? bid : null,
    });
    setPending(false);
    if (!result.ok) {
      setError(submitClaimErrorMessage(result.error, result.detail));
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel p-6 w-full max-w-sm space-y-4"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div>
          <h3 className="font-display text-lg text-white">Claim {player.fullName}</h3>
          <p className="text-xs text-gray-500">
            {player.position}
            {player.nflTeam ? ` · ${player.nflTeam}` : ' · Free agent'}
          </p>
        </div>
        {isFaab && (
          <div>
            <label htmlFor="claim-bid" className="block text-sm text-gray-400 mb-1">
              Bid (remaining: ${effectiveRemaining})
            </label>
            <input
              id="claim-bid"
              type="number"
              min={0}
              max={effectiveRemaining ?? undefined}
              value={bid}
              onChange={(e) => setBid(Math.max(0, Number(e.target.value)))}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
        )}
        <div>
          <label htmlFor="claim-drop" className="block text-sm text-gray-400 mb-1">
            Drop a player (optional)
          </label>
          <select
            id="claim-drop"
            value={dropPlayerId}
            onChange={(e) => setDropPlayerId(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">No drop</option>
            {rosterOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.position} {r.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? 'Submitting…' : 'Submit claim'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-sm text-sleeper-red">{error}</p>}
      </div>
    </div>
  );
}
