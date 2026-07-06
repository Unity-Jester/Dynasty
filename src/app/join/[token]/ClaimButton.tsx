'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { claimTeam } from '@/server/actions/leagues';

const ERROR_TEXT: Record<string, string> = {
  unauthenticated: 'Your session expired. Sign in again to claim this team.',
  invalid_input: 'This invite link looks malformed.',
  invalid_token: 'This invite is invalid or has already been used.',
  already_claimed: 'Someone just claimed this team.',
  no_token: 'This team is no longer accepting claims.',
  token_mismatch: 'This invite is invalid or has already been used.',
  user_has_team: 'You already own a team in this league.',
};

export default function ClaimButton({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    setLoading(true);
    setError(null);
    const result = await claimTeam({ token });
    if (result.ok) {
      router.push(`/l/${result.leagueId}`);
      return;
    }
    setLoading(false);
    setError(ERROR_TEXT[result.error] ?? 'Could not claim this team. Try again.');
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          void handleClaim();
        }}
        disabled={loading}
        className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
      >
        {loading ? 'Claiming…' : 'Claim this team'}
      </button>
      {error && <p className="text-sleeper-red text-sm text-center">{error}</p>}
    </div>
  );
}
