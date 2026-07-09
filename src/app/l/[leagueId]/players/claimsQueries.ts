import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { players, transactions } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { parseTransactionPayload, type WaiverClaimPayload } from '@/engine/transactions/payloads';
import type { ResolvedClaim } from './types';

// Section caps (Rule 2/3) — a real team never approaches these in a season.
export const MAX_PENDING_CLAIMS = 50;
// The plan's own number for the resolutions list.
export const MAX_RESOLVED_CLAIMS = 10;
const MAX_CLAIM_ROWS = MAX_PENDING_CLAIMS + MAX_RESOLVED_CLAIMS;
// Two player ids per row at most (add + drop).
const MAX_PLAYER_ID_LOOKUP = MAX_CLAIM_ROWS * 2;

export type TransactionStatus = (typeof transactions.$inferSelect)['status'];

export type ClaimRow = {
  id: string;
  status: TransactionStatus;
  payload: unknown;
  createdAt: string;
  resolvedAt: string | null;
};

async function fetchTeamClaims(
  leagueId: string,
  teamId: string,
  statuses: readonly TransactionStatus[],
  limit: number,
  order: 'created_desc' | 'resolved_desc',
): Promise<ClaimRow[]> {
  const rows = await getDb()
    .select({
      id: transactions.id,
      status: transactions.status,
      payload: transactions.payload,
      createdAt: transactions.createdAt,
      resolvedAt: transactions.resolvedAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.leagueId, leagueId),
        eq(transactions.type, 'waiver_claim'),
        inArray(transactions.status, [...statuses]),
        // Claims are scoped to MY team via the payload's teamId — the same
        // jsonb ->> comparison waiverQueries.hasDuplicatePendingClaim uses.
        sql`(${transactions.payload} ->> 'teamId') = ${teamId}`,
      ),
    )
    .orderBy(order === 'created_desc' ? desc(transactions.createdAt) : desc(transactions.resolvedAt))
    .limit(limit);
  invariant(rows.length <= limit, 'waiver claim query exceeded its bound');
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

export function fetchPendingClaims(leagueId: string, teamId: string): Promise<ClaimRow[]> {
  return fetchTeamClaims(leagueId, teamId, ['pending'], MAX_PENDING_CLAIMS, 'created_desc');
}

export function fetchResolvedClaims(leagueId: string, teamId: string): Promise<ClaimRow[]> {
  return fetchTeamClaims(
    leagueId,
    teamId,
    ['processed', 'rejected', 'cancelled'],
    MAX_RESOLVED_CLAIMS,
    'resolved_desc',
  );
}

async function fetchPlayerLabels(ids: readonly string[]): Promise<Map<string, { fullName: string; position: string }>> {
  invariant(ids.length <= MAX_PLAYER_ID_LOOKUP, 'claim player lookup exceeded its bound');
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: players.sleeperId, fullName: players.fullName, position: players.position })
    .from(players)
    .where(inArray(players.sleeperId, [...ids]))
    .limit(MAX_PLAYER_ID_LOOKUP);
  invariant(rows.length <= MAX_PLAYER_ID_LOOKUP, 'claim player lookup result exceeded its bound');
  return new Map(rows.map((r) => [r.id, { fullName: r.fullName, position: r.position }]));
}

/**
 * Parses every claim row's payload and resolves the add/drop player ids to
 * display labels. A row whose payload no longer parses, or whose add player
 * can't be resolved, renders degraded (Rule 5: never cast, never let a bad
 * row take the page down) — mirrors transactionQueries.resolveTrades. A
 * missing drop label falls back to "Unknown player" rather than degrading
 * the whole row, since the add side is what matters most here.
 */
export async function resolveClaims(rows: readonly ClaimRow[]): Promise<ResolvedClaim[]> {
  const parsedByRow = new Map<string, WaiverClaimPayload>();
  for (const row of rows) {
    const parsed = parseTransactionPayload('waiver_claim', row.payload);
    if (parsed.ok && parsed.value.kind === 'waiver_claim') {
      parsedByRow.set(row.id, parsed.value);
    }
  }
  const ids = new Set<string>();
  for (const payload of parsedByRow.values()) {
    ids.add(payload.addPlayerId);
    if (payload.dropPlayerId !== null) ids.add(payload.dropPlayerId);
  }
  const labels = await fetchPlayerLabels([...ids]);

  return rows.map((row) => {
    const payload = parsedByRow.get(row.id);
    const add = payload ? labels.get(payload.addPlayerId) : undefined;
    if (!payload || !add) {
      return { ok: false, id: row.id, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt };
    }
    const drop = payload.dropPlayerId !== null ? labels.get(payload.dropPlayerId) : undefined;
    return {
      ok: true,
      id: row.id,
      status: row.status,
      addPlayerName: add.fullName,
      addPosition: add.position,
      dropPlayerName: payload.dropPlayerId === null ? null : (drop ? `${drop.position} ${drop.fullName}` : 'Unknown player'),
      bid: payload.bid,
      resolution: payload.resolution ?? null,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  });
}
