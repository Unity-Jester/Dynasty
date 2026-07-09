'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { reviewTrade } from '@/server/actions/trades';
import { reviewSuccessMessage, reviewTradeErrorMessage } from './errorText';
import { ReviewModeNotice, SectionEmptyState } from './PageChrome';
import TradeAssetSummary, { UnreadableTradeCard } from './TradeAssetSummary';
import type { ResolvedTrade } from './types';

type OkTrade = Extract<ResolvedTrade, { ok: true }>;

function ReviewTradeRow({ trade }: { trade: OkTrade }) {
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'veto' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'veto') {
    setPending(decision);
    setMessage(null);
    const result = await reviewTrade({ transactionId: trade.id, decision });
    setPending(null);
    if (!result.ok) {
      setMessage(reviewTradeErrorMessage(result.error, result.detail));
      return;
    }
    setMessage(reviewSuccessMessage(result.status));
    router.refresh();
  }

  return (
    <TradeAssetSummary trade={trade}>
      <div className="flex items-start gap-2 pt-1 flex-wrap">
        <button
          type="button"
          onClick={() => void decide('approve')}
          disabled={pending !== null}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => void decide('veto')}
          disabled={pending !== null}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/[0.06] text-sleeper-red hover:bg-sleeper-red/10 border border-sleeper-red/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending === 'veto' ? 'Vetoing…' : 'Veto'}
        </button>
        {message && <span className="text-xs text-gray-400 self-center">{message}</span>}
      </div>
    </TradeAssetSummary>
  );
}

export default function ReviewQueue({
  trades,
  reviewMode,
}: {
  trades: ResolvedTrade[];
  reviewMode: 'none' | 'commissioner' | 'league_vote';
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">Review queue</h2>
      <ReviewModeNotice reviewMode={reviewMode} />
      {trades.length === 0 ? (
        <SectionEmptyState message="No trades are awaiting review." />
      ) : (
        <div className="space-y-3">
          {trades.map((trade) =>
            trade.ok ? <ReviewTradeRow key={trade.id} trade={trade} /> : <UnreadableTradeCard key={trade.id} trade={trade} />,
          )}
        </div>
      )}
    </section>
  );
}
