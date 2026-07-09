import type { ResolvedSide, ResolvedTrade } from './types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function AssetList({ side }: { side: ResolvedSide }) {
  const items = [...side.playerNames, ...side.pickLabels];
  if (items.length === 0) {
    return <p className="text-xs text-gray-500 italic">Nothing</p>;
  }
  return (
    <ul className="text-sm text-gray-200 space-y-0.5">
      {items.map((item, i) => (
        // Labels aren't guaranteed unique across an asset list (e.g. a
        // duplicate pick label from two different original teams), so the
        // list position is part of the key.
        <li key={`${item}-${i}`}>{item}</li>
      ))}
    </ul>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  pending_review: 'Awaiting review',
  processed: 'Processed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  vetoed: 'Vetoed',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-gray-300 border border-white/10">
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function UnreadableTradeCard({ trade }: { trade: Extract<ResolvedTrade, { ok: false }> }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">Unreadable transaction ({formatDate(trade.createdAt)})</p>
        <StatusBadge status={trade.status} />
      </div>
    </div>
  );
}

export default function TradeAssetSummary({
  trade,
  children,
}: {
  trade: Extract<ResolvedTrade, { ok: true }>;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-white font-medium">
          {trade.proposingTeamName} &harr; {trade.counterpartyTeamName}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{formatDate(trade.createdAt)}</span>
          <StatusBadge status={trade.status} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{trade.proposingTeamName} sends</p>
          <AssetList side={trade.give} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{trade.counterpartyTeamName} sends</p>
          <AssetList side={trade.receive} />
        </div>
      </div>
      {trade.note && <p className="text-xs text-gray-400 italic">&ldquo;{trade.note}&rdquo;</p>}
      {children}
    </div>
  );
}
