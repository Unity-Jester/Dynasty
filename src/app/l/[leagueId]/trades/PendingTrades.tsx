'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelTrade, respondToTrade } from '@/server/actions/trades';
import { cancelTradeErrorMessage, respondSuccessMessage, respondTradeErrorMessage } from './errorText';
import { SectionEmptyState } from './PageChrome';
import TradeAssetSummary, { UnreadableTradeCard } from './TradeAssetSummary';
import type { ResolvedTrade } from './types';

type OkTrade = Extract<ResolvedTrade, { ok: true }>;

function ActionButton({
  label,
  pendingLabel,
  pending,
  onClick,
  tone = 'default',
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  const toneClasses =
    tone === 'danger'
      ? 'bg-white/[0.06] text-sleeper-red hover:bg-sleeper-red/10 border border-sleeper-red/30'
      : 'bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark hover:brightness-110';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${toneClasses}`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function IncomingTradeRow({ trade }: { trade: OkTrade }) {
  const router = useRouter();
  const [pending, setPending] = useState<'accept' | 'reject' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function respond(response: 'accept' | 'reject') {
    setPending(response);
    setMessage(null);
    const result = await respondToTrade({ transactionId: trade.id, response });
    setPending(null);
    if (!result.ok) {
      setMessage(respondTradeErrorMessage(result.error, result.detail));
      return;
    }
    setMessage(respondSuccessMessage(result.status));
    router.refresh();
  }

  return (
    <TradeAssetSummary trade={trade}>
      <div className="flex items-center gap-2 pt-1">
        <ActionButton label="Accept" pendingLabel="Accepting…" pending={pending === 'accept'} onClick={() => void respond('accept')} />
        <ActionButton
          label="Reject"
          pendingLabel="Rejecting…"
          pending={pending === 'reject'}
          onClick={() => void respond('reject')}
          tone="danger"
        />
        {message && <span className="text-xs text-gray-400">{message}</span>}
      </div>
    </TradeAssetSummary>
  );
}

function OutgoingTradeRow({ trade }: { trade: OkTrade }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setMessage(null);
    const result = await cancelTrade({ transactionId: trade.id });
    setPending(false);
    if (!result.ok) {
      setMessage(cancelTradeErrorMessage(result.error, result.detail));
      return;
    }
    router.refresh();
  }

  return (
    <TradeAssetSummary trade={trade}>
      <div className="flex items-center gap-2 pt-1">
        <ActionButton label="Cancel proposal" pendingLabel="Cancelling…" pending={pending} onClick={() => void cancel()} tone="danger" />
        {message && <span className="text-xs text-gray-400">{message}</span>}
      </div>
    </TradeAssetSummary>
  );
}

export default function PendingTrades({ trades, myTeamId }: { trades: ResolvedTrade[]; myTeamId: string }) {
  const incoming = trades.filter((t): t is OkTrade => t.ok && t.counterpartyTeamId === myTeamId);
  const outgoing = trades.filter((t): t is OkTrade => t.ok && t.proposingTeamId === myTeamId);
  const unreadable = trades.filter((t): t is Extract<ResolvedTrade, { ok: false }> => !t.ok);

  return (
    <section className="space-y-6">
      <h2 className="font-display text-lg text-white">Pending</h2>
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-400">Incoming — awaiting your response</h3>
        {incoming.length === 0 ? (
          <SectionEmptyState message="No trades are waiting on you." />
        ) : (
          incoming.map((trade) => <IncomingTradeRow key={trade.id} trade={trade} />)
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-400">Outgoing — you proposed</h3>
        {outgoing.length === 0 ? (
          <SectionEmptyState message="You haven't proposed any trades that are still pending." />
        ) : (
          outgoing.map((trade) => <OutgoingTradeRow key={trade.id} trade={trade} />)
        )}
      </div>
      {unreadable.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">Unreadable</h3>
          {unreadable.map((trade) => (
            <UnreadableTradeCard key={trade.id} trade={trade} />
          ))}
        </div>
      )}
    </section>
  );
}
