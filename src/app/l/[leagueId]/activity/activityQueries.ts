import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { transactions } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { parseTransactionPayload, type CommishPayload } from '@/engine/transactions/payloads';
import { resolveClaims } from '../players/claimsQueries';
import { resolveTrades } from '../trades/transactionQueries';
import type { ResolvedClaim } from '../players/types';
import type { ResolvedTrade } from '../trades/types';

// The plan's own number for the feed (Rule 2/3) — a real league's full
// history is much larger, but this is a recent-activity feed, not an export.
export const MAX_ACTIVITY_ROWS = 50;

export type ActivityRowType = (typeof transactions.$inferSelect)['type'];
export type ActivityRowStatus = (typeof transactions.$inferSelect)['status'];

export type ActivityRow = {
  id: string;
  type: ActivityRowType;
  status: ActivityRowStatus;
  payload: unknown;
  createdAt: string;
  resolvedAt: string | null;
};

/** Every transaction in the league, newest first, bounded — the league's
 *  full audit trail as shown to every member (all types, all statuses). */
export async function fetchRecentTransactions(leagueId: string): Promise<ActivityRow[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      type: transactions.type,
      status: transactions.status,
      payload: transactions.payload,
      createdAt: transactions.createdAt,
      resolvedAt: transactions.resolvedAt,
    })
    .from(transactions)
    .where(eq(transactions.leagueId, leagueId))
    .orderBy(desc(transactions.createdAt))
    .limit(MAX_ACTIVITY_ROWS);
  invariant(rows.length <= MAX_ACTIVITY_ROWS, 'activity feed query exceeded its bound');
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

export type ResolvedCommishAction =
  | {
      ok: true;
      id: string;
      status: string;
      action: CommishPayload['action'];
      teamName: string;
      detail: Record<string, unknown>;
      createdAt: string;
      resolvedAt: string | null;
    }
  | { ok: false; id: string; status: string; createdAt: string; resolvedAt: string | null };

/** Parses every commish row's payload and resolves its teamId to a display
 *  name — mirrors resolveTrades/resolveClaims's degraded-row convention
 *  (Rule 5: never cast, never let a bad row take the page down). */
function resolveCommishActions(
  rows: readonly ActivityRow[],
  teamNames: ReadonlyMap<string, string>,
): ResolvedCommishAction[] {
  return rows.map((row) => {
    const parsed = parseTransactionPayload('commish', row.payload);
    const teamName = parsed.ok && parsed.value.kind === 'commish' ? teamNames.get(parsed.value.teamId) : undefined;
    if (!parsed.ok || parsed.value.kind !== 'commish' || teamName === undefined) {
      return { ok: false, id: row.id, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt };
    }
    return {
      ok: true,
      id: row.id,
      status: row.status,
      action: parsed.value.action,
      teamName,
      detail: parsed.value.detail,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  });
}

export type ActivityItem =
  | { kind: 'trade'; item: ResolvedTrade }
  | { kind: 'waiver_claim'; item: ResolvedClaim }
  | { kind: 'commish'; item: ResolvedCommishAction };

/**
 * Splits the bounded, newest-first transaction feed by type, resolves each
 * group with its type's OWN existing resolver (resolveTrades / resolveClaims
 * reused verbatim from the trades/players pages — no third copy of that
 * degraded-row logic), then re-interleaves results in the original
 * newest-first row order. Bounded throughout by MAX_ACTIVITY_ROWS.
 */
export async function resolveActivity(
  rows: readonly ActivityRow[],
  teamNames: ReadonlyMap<string, string>,
): Promise<ActivityItem[]> {
  const tradeRows = rows.filter((r) => r.type === 'trade');
  const claimRows = rows.filter((r) => r.type === 'waiver_claim');
  const commishRows = rows.filter((r) => r.type === 'commish');

  const [trades, claims] = await Promise.all([resolveTrades(tradeRows, teamNames), resolveClaims(claimRows)]);
  const commishActions = resolveCommishActions(commishRows, teamNames);

  const byId = new Map<string, ActivityItem>();
  for (const t of trades) byId.set(t.id, { kind: 'trade', item: t });
  for (const c of claims) byId.set(c.id, { kind: 'waiver_claim', item: c });
  for (const a of commishActions) byId.set(a.id, { kind: 'commish', item: a });

  return rows.map((row) => {
    const item = byId.get(row.id);
    invariant(item !== undefined, 'activity row missing from its resolved group');
    return item;
  });
}
