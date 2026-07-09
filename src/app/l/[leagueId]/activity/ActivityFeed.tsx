import { ClaimRowDetail } from '../players/ClaimResolutions';
import TradeAssetSummary, { StatusBadge, UnreadableTradeCard } from '../trades/TradeAssetSummary';
import type { ActivityItem, ResolvedCommishAction } from './activityQueries';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

type OkCommishAction = Extract<ResolvedCommishAction, { ok: true }>;

function playerLabel(detail: Record<string, unknown>): string {
  return str(detail.playerName) ?? str(detail.playerId) ?? 'a player';
}

function lineupEditText(detail: Record<string, unknown>): string {
  const week = num(detail.week);
  const changed = num(detail.changedSlots);
  const weekText = week !== null ? ` for week ${week}` : '';
  const changedText = changed !== null ? ` (${changed} slot${changed === 1 ? '' : 's'} changed)` : '';
  return `Edited the lineup${weekText}${changedText}`;
}

/** One line of prose per commish action kind — a plain switch (not a lookup
 *  table) per CODING_STANDARDS.md Rule 9, exhaustive over the 3-member
 *  CommishPayload['action'] union without a default branch. Branching for
 *  each case lives in its own small helper above, purely to keep this
 *  function's own complexity under the lint cap. */
function commishActionText(action: OkCommishAction['action'], detail: Record<string, unknown>): string {
  switch (action) {
    case 'force_add':
      return `Force added ${playerLabel(detail)}`;
    case 'force_drop':
      return `Force dropped ${playerLabel(detail)}`;
    case 'lineup_edit':
      return lineupEditText(detail);
  }
}

function CommishRow({ item }: { item: ResolvedCommishAction }) {
  if (!item.ok) {
    return (
      <div className="panel p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">Unreadable transaction ({formatDate(item.createdAt)})</p>
        <StatusBadge status={item.status} />
      </div>
    );
  }
  return (
    <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm text-white font-medium">{item.teamName}</p>
        <p className="text-xs text-gray-500">{commishActionText(item.action, item.detail)}</p>
      </div>
      <span className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{formatDate(item.createdAt)}</span>
        <StatusBadge status={item.status} />
      </span>
    </div>
  );
}

function ClaimRow({ item }: { item: ActivityItem & { kind: 'waiver_claim' } }) {
  const { item: claim } = item;
  if (!claim.ok) {
    return (
      <div className="panel p-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">Unreadable transaction ({formatDate(claim.createdAt)})</p>
        <StatusBadge status={claim.status} />
      </div>
    );
  }
  return (
    <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
      <ClaimRowDetail claim={claim} />
      <span className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{formatDate(claim.resolvedAt ?? claim.createdAt)}</span>
        <StatusBadge status={claim.status} />
      </span>
    </div>
  );
}

/** The league's full transaction feed, newest first — trades, waiver claims,
 *  and commissioner actions rendered per-type, each reusing its own page's
 *  existing card/row components rather than a third copy. */
export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-gray-400 text-sm">No activity yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((entry) => {
        switch (entry.kind) {
          case 'trade': {
            const trade = entry.item;
            return trade.ok ? (
              <TradeAssetSummary key={trade.id} trade={trade} />
            ) : (
              <UnreadableTradeCard key={trade.id} trade={trade} />
            );
          }
          case 'waiver_claim':
            return <ClaimRow key={entry.item.id} item={entry} />;
          case 'commish':
            return <CommishRow key={entry.item.id} item={entry.item} />;
        }
      })}
    </div>
  );
}
