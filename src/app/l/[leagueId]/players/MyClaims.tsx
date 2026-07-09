'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelClaim } from '@/server/actions/waivers';
import { cancelClaimErrorMessage } from './errorText';
import { SectionEmptyState } from './PageChrome';
import type { ResolvedClaim } from './types';

type OkClaim = Extract<ResolvedClaim, { ok: true }>;

function PendingClaimRow({ claim }: { claim: OkClaim }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setError(null);
    const result = await cancelClaim({ transactionId: claim.id });
    setPending(false);
    if (!result.ok) {
      setError(cancelClaimErrorMessage(result.error, result.detail));
      return;
    }
    router.refresh();
  }

  return (
    <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm text-white font-medium">
          {claim.addPosition} {claim.addPlayerName}
        </p>
        <p className="text-xs text-gray-500">
          {claim.bid !== null ? `Bid: $${claim.bid}` : 'Priority claim'}
          {claim.dropPlayerName ? ` · Drop: ${claim.dropPlayerName}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={pending}
          className="px-3 py-1.5 rounded-md text-sm font-semibold bg-white/[0.06] text-sleeper-red hover:bg-sleeper-red/10 border border-sleeper-red/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Cancelling…' : 'Cancel'}
        </button>
        {error && <span className="text-xs text-gray-400">{error}</span>}
      </div>
    </div>
  );
}

function UnreadableClaimCard({ claim }: { claim: Extract<ResolvedClaim, { ok: false }> }) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-gray-400">
        Unreadable claim ({new Date(claim.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
      </p>
    </div>
  );
}

export default function MyClaims({ claims }: { claims: ResolvedClaim[] }) {
  const ok = claims.filter((c): c is OkClaim => c.ok);
  const unreadable = claims.filter((c): c is Extract<ResolvedClaim, { ok: false }> => !c.ok);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">My claims</h2>
      {ok.length === 0 && unreadable.length === 0 ? (
        <SectionEmptyState message="You have no pending waiver claims." />
      ) : (
        <div className="space-y-3">
          {ok.map((claim) => (
            <PendingClaimRow key={claim.id} claim={claim} />
          ))}
          {unreadable.map((claim) => (
            <UnreadableClaimCard key={claim.id} claim={claim} />
          ))}
        </div>
      )}
    </section>
  );
}
