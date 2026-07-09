import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { pickAssets, players, teams, transactions } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { parseTransactionPayload, type TradePayload } from '@/engine/transactions/payloads';
import type { ResolvedTrade } from './types';

// Section caps (Rule 2/3, named upper bounds, never a real limit in practice):
export const MAX_PENDING_TRADES = 50;
export const MAX_REVIEW_TRADES = 50;
// The plan's own number for the History section.
export const MAX_HISTORY_TRADES = 20;
const MAX_TRADE_ROWS = MAX_PENDING_TRADES + MAX_REVIEW_TRADES + MAX_HISTORY_TRADES;
// Each trade payload is capped at 15 players / 10 picks per side (payloads.ts);
// two sides per trade, across every row rendered on the page.
const MAX_PLAYER_ID_LOOKUP = MAX_TRADE_ROWS * 15 * 2;
const MAX_PICK_ID_LOOKUP = MAX_TRADE_ROWS * 10 * 2;

export type TransactionStatus = (typeof transactions.$inferSelect)['status'];

export type TradeRow = {
  id: string;
  status: TransactionStatus;
  payload: unknown;
  createdAt: string;
  resolvedAt: string | null;
};

async function fetchByStatuses(
  leagueId: string,
  statuses: readonly TransactionStatus[],
  limit: number,
): Promise<TradeRow[]> {
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
        eq(transactions.type, 'trade'),
        inArray(transactions.status, [...statuses]),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
  invariant(rows.length <= limit, 'trade transaction query exceeded its bound');
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

export function fetchPendingTrades(leagueId: string): Promise<TradeRow[]> {
  return fetchByStatuses(leagueId, ['pending'], MAX_PENDING_TRADES);
}

export function fetchReviewTrades(leagueId: string): Promise<TradeRow[]> {
  return fetchByStatuses(leagueId, ['pending_review'], MAX_REVIEW_TRADES);
}

// Per the plan: processed / vetoed / rejected. Cancelled trades intentionally
// drop out of the UI once cancelled (the proposer withdrew them).
export function fetchHistoryTrades(leagueId: string): Promise<TradeRow[]> {
  return fetchByStatuses(leagueId, ['processed', 'vetoed', 'rejected'], MAX_HISTORY_TRADES);
}

function collectIds(payloads: readonly TradePayload[]): { playerIds: string[]; pickIds: string[] } {
  const playerIds = new Set<string>();
  const pickIds = new Set<string>();
  for (const payload of payloads) {
    for (const id of payload.give.playerIds) playerIds.add(id);
    for (const id of payload.receive.playerIds) playerIds.add(id);
    for (const id of payload.give.pickIds) pickIds.add(id);
    for (const id of payload.receive.pickIds) pickIds.add(id);
  }
  return { playerIds: [...playerIds], pickIds: [...pickIds] };
}

async function fetchPlayerNames(playerIds: readonly string[]): Promise<Map<string, string>> {
  invariant(playerIds.length <= MAX_PLAYER_ID_LOOKUP, 'player name lookup exceeded its bound');
  if (playerIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: players.sleeperId, fullName: players.fullName, position: players.position })
    .from(players)
    .where(inArray(players.sleeperId, [...playerIds]))
    .limit(MAX_PLAYER_ID_LOOKUP);
  invariant(rows.length <= MAX_PLAYER_ID_LOOKUP, 'player name lookup result exceeded its bound');
  return new Map(rows.map((r) => [r.id, `${r.position} ${r.fullName}`]));
}

async function fetchPickLabels(pickIds: readonly string[]): Promise<Map<string, string>> {
  invariant(pickIds.length <= MAX_PICK_ID_LOOKUP, 'pick label lookup exceeded its bound');
  if (pickIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: pickAssets.id,
      season: pickAssets.season,
      round: pickAssets.round,
      originalTeamName: teams.name,
    })
    .from(pickAssets)
    .innerJoin(teams, eq(pickAssets.originalTeamId, teams.id))
    .where(inArray(pickAssets.id, [...pickIds]))
    .limit(MAX_PICK_ID_LOOKUP);
  invariant(rows.length <= MAX_PICK_ID_LOOKUP, 'pick label lookup result exceeded its bound');
  return new Map(rows.map((r) => [r.id, `${r.season} Round ${r.round} (from ${r.originalTeamName})`]));
}

function assetLabels(
  side: TradePayload['give'],
  playerNames: Map<string, string>,
  pickLabels: Map<string, string>,
): { playerNames: string[]; pickLabels: string[] } {
  return {
    playerNames: side.playerIds.map((id) => playerNames.get(id) ?? 'Unknown player'),
    pickLabels: side.pickIds.map((id) => pickLabels.get(id) ?? 'Unknown pick'),
  };
}

/**
 * Parses every trade row's payload and resolves its asset ids to display
 * names. A row whose payload no longer parses (or whose team ids are missing
 * from `teamNames`, which should be impossible — trade payloads only ever
 * reference teams in their own league) renders as a degraded item rather than
 * crashing the page (Rule 5: never cast, never let a bad row take the page down).
 */
export async function resolveTrades(
  rows: readonly TradeRow[],
  teamNames: ReadonlyMap<string, string>,
): Promise<ResolvedTrade[]> {
  const parsedByRow = new Map<string, TradePayload>();
  for (const row of rows) {
    const parsed = parseTransactionPayload('trade', row.payload);
    if (parsed.ok && parsed.value.kind === 'trade') {
      parsedByRow.set(row.id, parsed.value);
    }
  }
  const { playerIds, pickIds } = collectIds([...parsedByRow.values()]);
  const [playerNames, pickLabels] = await Promise.all([fetchPlayerNames(playerIds), fetchPickLabels(pickIds)]);

  return rows.map((row) => {
    const payload = parsedByRow.get(row.id);
    const proposingTeamName = payload ? teamNames.get(payload.proposingTeamId) : undefined;
    const counterpartyTeamName = payload ? teamNames.get(payload.counterpartyTeamId) : undefined;
    if (!payload || !proposingTeamName || !counterpartyTeamName) {
      return { ok: false, id: row.id, status: row.status, createdAt: row.createdAt, resolvedAt: row.resolvedAt };
    }
    return {
      ok: true,
      id: row.id,
      status: row.status,
      proposingTeamId: payload.proposingTeamId,
      proposingTeamName,
      counterpartyTeamId: payload.counterpartyTeamId,
      counterpartyTeamName,
      give: assetLabels(payload.give, playerNames, pickLabels),
      receive: assetLabels(payload.receive, playerNames, pickLabels),
      note: payload.note ?? null,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  });
}
