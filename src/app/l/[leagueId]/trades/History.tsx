import { SectionEmptyState } from './PageChrome';
import TradeAssetSummary, { UnreadableTradeCard } from './TradeAssetSummary';
import type { ResolvedTrade } from './types';

export default function History({ trades }: { trades: ResolvedTrade[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-white">History</h2>
      <p className="text-xs text-gray-500 -mt-2">Most recent {trades.length ? `${trades.length} ` : ''}processed, vetoed, and rejected trades.</p>
      {trades.length === 0 ? (
        <SectionEmptyState message="No trades have been processed, vetoed, or rejected yet." />
      ) : (
        <div className="space-y-3">
          {trades.map((trade) =>
            trade.ok ? <TradeAssetSummary key={trade.id} trade={trade} /> : <UnreadableTradeCard key={trade.id} trade={trade} />,
          )}
        </div>
      )}
    </section>
  );
}
