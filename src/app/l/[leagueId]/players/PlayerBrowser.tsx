'use client';

import { useState } from 'react';
import ClaimModal from './ClaimModal';
import { SectionEmptyState } from './PageChrome';
import type { RosterOption, UnrosteredPlayer } from './types';
import type { LeagueSettings } from '@/engine/settings';

function PlayerListRow({ player, onClaim, canClaim }: { player: UnrosteredPlayer; onClaim: () => void; canClaim: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm text-white font-medium">{player.fullName}</p>
        <p className="text-xs text-gray-500">
          {player.position}
          {player.nflTeam ? ` · ${player.nflTeam}` : ' · Free agent'}
        </p>
      </div>
      {canClaim ? (
        <button
          type="button"
          onClick={onClaim}
          className="px-3 py-1.5 rounded-md text-sm font-semibold bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark hover:brightness-110 transition-all"
        >
          Claim
        </button>
      ) : (
        <span className="text-xs text-gray-600">Own a team to claim</span>
      )}
    </div>
  );
}

/**
 * The unrostered browse list + the claim modal it opens. A single client
 * island (rather than a server list + a separate client button) because the
 * modal needs to know WHICH row was clicked — state that has to live above
 * the row it opens from.
 */
export default function PlayerBrowser({
  results,
  myTeamId,
  waivers,
  faabRemaining,
  rosterOptions,
}: {
  results: UnrosteredPlayer[];
  myTeamId: string | null;
  waivers: LeagueSettings['waivers'];
  faabRemaining: number | null;
  rosterOptions: RosterOption[];
}) {
  const [claiming, setClaiming] = useState<UnrosteredPlayer | null>(null);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">Browse unrostered players</h2>
      {results.length === 0 ? (
        <SectionEmptyState message="No unrostered players match your search." />
      ) : (
        <div className="panel divide-y divide-white/[0.06]">
          {results.map((player) => (
            <PlayerListRow
              key={player.id}
              player={player}
              canClaim={myTeamId !== null}
              onClaim={() => setClaiming(player)}
            />
          ))}
        </div>
      )}
      {claiming && myTeamId !== null && (
        <ClaimModal
          player={claiming}
          myTeamId={myTeamId}
          waivers={waivers}
          faabRemaining={faabRemaining}
          rosterOptions={rosterOptions}
          onClose={() => setClaiming(null)}
        />
      )}
    </section>
  );
}
