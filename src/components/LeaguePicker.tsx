'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface FoundLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
}

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

function rememberLeague(leagueId: string) {
  document.cookie = `lastLeagueId=${leagueId}; path=/; max-age=31536000; samesite=lax`;
}

// Entry point when no league is configured: paste a league ID directly, or
// look up leagues by Sleeper username (the Sleeper API is public and CORS-
// enabled, so lookups run straight from the browser).
export default function LeaguePicker() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<FoundLeague[] | null>(null);
  const [searchedUser, setSearchedUser] = useState('');

  const openLeague = (leagueId: string) => {
    rememberLeague(leagueId);
    router.push(`/league/${leagueId}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    if (!value) return;

    // Pure digits = league ID
    if (/^\d+$/.test(value)) {
      openLeague(value);
      return;
    }

    // Otherwise treat as a Sleeper username
    setLoading(true);
    setError(null);
    setLeagues(null);
    try {
      const userRes = await fetch(`${SLEEPER_API_BASE}/user/${encodeURIComponent(value)}`);
      const user = userRes.ok ? await userRes.json() : null;
      if (!user?.user_id) {
        setError(`No Sleeper user named "${value}" found.`);
        return;
      }

      const year = new Date().getFullYear();
      let found: FoundLeague[] = [];
      for (const season of [year, year - 1]) {
        const res = await fetch(`${SLEEPER_API_BASE}/user/${user.user_id}/leagues/nfl/${season}`);
        if (res.ok) {
          const data: FoundLeague[] = await res.json();
          if (data?.length) {
            found = data;
            break;
          }
        }
      }

      if (found.length === 0) {
        setError(`"${value}" has no NFL leagues in ${year} or ${year - 1}.`);
        return;
      }
      setSearchedUser(value);
      setLeagues(found);
    } catch {
      setError('Could not reach the Sleeper API. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-16">
      <div className="text-center mb-10">
        <div
          className="w-16 h-16 rounded-2xl bg-gradient-to-b from-gold-400 to-gold-600 flex items-center justify-center mx-auto mb-6 shadow-gold-glow animate-rise"
          style={{ animationDelay: '0ms' }}
        >
          <svg viewBox="0 0 24 24" className="w-9 h-9 text-sleeper-dark" fill="currentColor" aria-hidden="true">
            <path d="M3 7.5l4.6 4.1L12 4.5l4.4 7.1L21 7.5l-1.7 9.7a1 1 0 01-1 .8H5.7a1 1 0 01-1-.8L3 7.5z" />
          </svg>
        </div>
        <h1
          className="font-display text-4xl sm:text-5xl text-white mb-4 animate-rise"
          style={{ animationDelay: '80ms' }}
        >
          Dynasty <span className="text-gold-gradient">League Hub</span>
        </h1>
        <p className="text-gray-400 animate-rise" style={{ animationDelay: '160ms' }}>
          Standings, matchups, trade grades, draft analysis, and league history &mdash;
          a private clubhouse for any Sleeper league.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 animate-rise"
        style={{ animationDelay: '240ms' }}
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="League ID or Sleeper username"
          className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {loading ? 'Looking up…' : 'View League'}
        </button>
      </form>

      {error && <p className="text-sleeper-red text-sm mt-4 text-center">{error}</p>}

      {leagues && (
        <div className="mt-6 space-y-2">
          <p className="text-sm text-gray-400">
            Leagues for <span className="text-white">{searchedUser}</span>:
          </p>
          {leagues.map(league => (
            <button
              key={league.league_id}
              onClick={() => openLeague(league.league_id)}
              className="w-full flex items-center justify-between px-4 py-3 panel panel-hover text-left"
            >
              <div>
                <p className="text-white font-medium">{league.name}</p>
                <p className="text-xs text-gray-500">
                  {league.season} season &middot; {league.total_rosters} teams
                </p>
              </div>
              <span className="text-sleeper-accent">→</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-600 mt-8 text-center">
        Find your League ID in the Sleeper app under League Settings.
      </p>
    </div>
  );
}
