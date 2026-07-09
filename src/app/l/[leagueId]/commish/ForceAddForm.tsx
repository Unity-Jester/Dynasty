'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { commishForceAdd } from '@/server/actions/commish';
import { commishForceAddErrorMessage } from './errorText';
import type { UnrosteredPlayer } from '../players/types';
import type { TeamOption } from '../trades/types';

/** Force-add a searched, unrostered player onto a chosen team. Reuses the
 *  players page's own unrostered-search query (server-rendered via ?q=) —
 *  only the result list + per-row action button are commish-specific. */
export default function ForceAddForm({
  leagueId,
  teams,
  q,
  results,
}: {
  leagueId: string;
  teams: TeamOption[];
  q: string | null;
  results: UnrosteredPlayer[];
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(playerId: string) {
    if (!teamId) return;
    setPending(playerId);
    setError(null);
    const result = await commishForceAdd({ teamId, playerId });
    setPending(null);
    if (!result.ok) {
      setError(commishForceAddErrorMessage(result.error, result.detail));
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">Force add</h2>
      <form action={`/l/${leagueId}/commish`} method="GET" className="flex flex-wrap gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search unrostered players"
          maxLength={60}
          className="flex-1 min-w-[10rem] bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
        />
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
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/[0.06] text-white hover:bg-white/[0.1] transition-colors"
        >
          Search
        </button>
      </form>
      {error && <p className="text-sm text-sleeper-red">{error}</p>}
      {results.length === 0 ? (
        <p className="text-sm text-gray-500">No unrostered players match.</p>
      ) : (
        <ul className="space-y-1.5">
          {results.map((p) => (
            <li key={p.id} className="panel p-3 flex items-center justify-between gap-3">
              <span className="text-sm text-white">
                {p.position} {p.fullName} {p.nflTeam ? <span className="text-gray-500">({p.nflTeam})</span> : null}
              </span>
              <button
                type="button"
                onClick={() => void add(p.id)}
                disabled={pending !== null || !teamId}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending === p.id ? 'Adding…' : 'Force add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
