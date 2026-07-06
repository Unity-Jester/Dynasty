'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createLeague } from '@/server/actions/leagues';
import { DEFAULT_SUPERFLEX_PPR } from '@/engine/settings';

const TEAM_COUNT_OPTIONS = [8, 10, 12, 14, 16] as const;
const DEFAULT_TEAM_COUNT = 12;

const ERROR_TEXT: Record<string, string> = {
  unauthenticated: 'Your session expired. Sign in again to create a league.',
  invalid_input: 'Check the league name and try again.',
  no_profile: 'We could not find your account. Sign out and back in, then retry.',
};

export default function NewLeagueForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [teamCount, setTeamCount] = useState<number>(DEFAULT_TEAM_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    setLoading(true);
    setError(null);
    const result = await createLeague({
      name: trimmed,
      settings: { ...DEFAULT_SUPERFLEX_PPR, teamCount },
    });
    if (result.ok) {
      router.push(`/l/${result.leagueId}`);
      return;
    }
    setLoading(false);
    setError(ERROR_TEXT[result.error] ?? 'Could not create the league. Try again.');
  };

  return (
    <form onSubmit={handleSubmit} className="panel p-6 space-y-4">
      <div className="space-y-2">
        <label htmlFor="league-name" className="block text-sm text-gray-400">
          League name
        </label>
        <input
          id="league-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Dynasty Warriors"
          className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="team-count" className="block text-sm text-gray-400">
          Number of teams
        </label>
        <select
          id="team-count"
          value={teamCount}
          onChange={(e) => setTeamCount(Number(e.target.value))}
          className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
        >
          {TEAM_COUNT_OPTIONS.map((count) => (
            <option key={count} value={count} className="bg-sleeper-dark">
              {count} teams
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-600">
          You can fine-tune scoring and roster settings later.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
      >
        {loading ? 'Creating…' : 'Create league'}
      </button>

      {error && <p className="text-sleeper-red text-sm text-center">{error}</p>}
    </form>
  );
}
