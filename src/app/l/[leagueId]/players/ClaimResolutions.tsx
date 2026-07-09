import { resolutionReasonText } from './errorText';
import { SectionEmptyState } from './PageChrome';
import type { ResolvedClaim } from './types';

const STATUS_LABEL: Record<string, string> = {
  processed: 'Awarded',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Exported for reuse by the activity feed (Phase 7 Task 8) — same claim
// detail rendering, no third copy of the bid/drop/resolution line.
export function ClaimRowDetail({ claim }: { claim: Extract<ResolvedClaim, { ok: true }> }) {
  const detail =
    claim.status === 'cancelled' ? 'You cancelled this claim.' : resolutionReasonText(claim.resolution);
  return (
    <div>
      <p className="text-sm text-white font-medium">
        {claim.addPosition} {claim.addPlayerName}
      </p>
      <p className="text-xs text-gray-500">
        {claim.bid !== null ? `Bid: $${claim.bid} · ` : ''}
        {claim.dropPlayerName ? `Drop: ${claim.dropPlayerName} · ` : ''}
        {detail}
      </p>
    </div>
  );
}

export default function ClaimResolutions({ claims }: { claims: ResolvedClaim[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">Recent resolutions</h2>
      <p className="text-xs text-gray-500 -mt-2">
        Most recent {claims.length ? `${claims.length} ` : ''}processed, rejected, and cancelled claims.
      </p>
      {claims.length === 0 ? (
        <SectionEmptyState message="No resolved waiver claims yet." />
      ) : (
        <div className="space-y-2">
          {claims.map((claim) => (
            <div key={claim.id} className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
              {claim.ok ? (
                <ClaimRowDetail claim={claim} />
              ) : (
                <p className="text-sm text-gray-400">Unreadable claim ({formatDate(claim.createdAt)})</p>
              )}
              <span className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{formatDate(claim.resolvedAt ?? claim.createdAt)}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-gray-300 border border-white/10">
                  {STATUS_LABEL[claim.status] ?? claim.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
