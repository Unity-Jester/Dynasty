'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { commishForceDrop } from '@/server/actions/commish';
import { commishForceDropErrorMessage } from './errorText';
import type { TeamAssets, TeamOption } from '../trades/types';

/** Force-drop a rostered player off a chosen team. Reuses the trades page's
 *  fetchAllTeamAssets query (already ships every team's rostered players,
 *  bounded, keyed by team) so this form needs no third roster query. */
export default function ForceDropForm({
  teams,
  teamAssetsById,
}: {
  teams: TeamOption[];
  teamAssetsById: Record<string, TeamAssets>;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roster = useMemo(() => teamAssetsById[teamId]?.players ?? [], [teamAssetsById, teamId]);

  async function drop(playerId: string) {
    if (!teamId) return;
    setPending(playerId);
    setError(null);
    const result = await commishForceDrop({ teamId, playerId });
    setPending(null);
    if (!result.ok) {
      setError(commishForceDropErrorMessage(result.error, result.detail));
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">Force drop</h2>
      <select
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white"
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-sleeper-red">{error}</p>}
      {roster.length === 0 ? (
        <p className="text-sm text-gray-500">This team has no rostered players.</p>
      ) : (
        <ul className="space-y-1.5">
          {roster.map((p) => (
            <li key={p.playerId} className="panel p-3 flex items-center justify-between gap-3">
              <span className="text-sm text-white">
                {p.position} {p.fullName} <span className="text-gray-500 text-xs">({p.status})</span>
              </span>
              <button
                type="button"
                onClick={() => void drop(p.playerId)}
                disabled={pending !== null}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-white/[0.06] text-sleeper-red hover:bg-sleeper-red/10 border border-sleeper-red/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending === p.playerId ? 'Dropping…' : 'Force drop'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
