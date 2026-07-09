import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { pickAssets, rosterMembers } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import type { TradePayload } from '@/engine/transactions/payloads';
import {
  planTradeExecution,
  validateTradeProposal,
  type TradePickMove,
  type TradePlayerMove,
} from '@/engine/transactions/validateTrade';
import {
  guardedTradeStatus,
  loadTradeContext,
  toValidationInput,
  type DbTx,
} from '@/server/trades/tradeQueries';
import { clearDroppedLineupSlots } from '@/server/rosterCleanup';

// Move-loop bounds: TradePayload caps each side at 15 players / 10 picks
// (payloads.ts), so a legal plan never exceeds these (Rule 2).
const MAX_PLAYER_MOVES = 30;
const MAX_PICK_MOVES = 20;

const PG_UNIQUE_VIOLATION = '23505';

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export type ExecuteTradeFailure = {
  ok: false;
  error: 'validation_failed' | 'invalid_status' | 'not_found' | 'invalid_settings' | 'conflict' | 'db_error';
  detail?: string;
};
export type ExecuteTradeResult = { ok: true } | ExecuteTradeFailure;

// Thrown inside the db.transaction callback to trigger a ROLLBACK while
// carrying a typed failure out to executeTrade's catch. drizzle's postgres-js
// driver rolls back when the callback throws and rethrows the original error,
// so throwing (never returning an error value) is the ONLY correct way to
// abort — a returned error object would COMMIT the partial writes.
class ExecuteAbort extends Error {
  constructor(readonly failure: ExecuteTradeFailure) {
    super(`trade execution aborted: ${failure.error}`);
    this.name = 'ExecuteAbort';
  }
}

type ExecuteArgs = {
  transactionId: string;
  leagueId: string;
  payload: TradePayload;
  /** The status the caller believes the row is in: 'accepted' (respond flow)
   *  or 'pending_review' (commissioner approve flow). */
  expectedStatus: 'accepted' | 'pending_review';
};

/**
 * Executes an accepted/approved trade atomically. Inside ONE db.transaction:
 * re-reads rosters/picks/settings/current-week (in-transaction = the final
 * authority), re-validates, applies the engine's execution plan (guarded
 * per-row writes), nulls moved players out of current+future lineup slots
 * (lock-aware for the current week — see clearDroppedLineupSlots), and finally the
 * guarded status transition to 'processed'. ANY failure
 * throws, so the whole transaction rolls back — the transaction row's status
 * is exactly what it was before the call on every failure path.
 *
 * Failure modes: 'validation_failed' (trade no longer legal against fresh
 * data), 'invalid_status' (a concurrent actor resolved the row first —
 * approve vs approve, approve vs veto), 'conflict' (a concurrent roster/pick
 * mutation raced the guarded writes, or the one-player-per-league unique
 * index fired), 'not_found'/'invalid_settings' (season row problems),
 * 'db_error' (other Postgres failures, SQLSTATE in detail).
 */
export async function executeTrade(args: ExecuteArgs): Promise<ExecuteTradeResult> {
  try {
    await getDb().transaction(async (tx) => runExecution(tx, args));
    return { ok: true };
  } catch (error) {
    if (error instanceof ExecuteAbort) {
      return error.failure;
    }
    const code = pgErrorCode(error);
    if (code === PG_UNIQUE_VIOLATION) {
      // roster_members_league_player_uq: someone else rostered a moved player
      // in this league concurrently. The DB index is the final backstop.
      return { ok: false, error: 'conflict' };
    }
    if (code !== null) {
      return { ok: false, error: 'db_error', detail: `database error (${code})` };
    }
    // Invariant violations and unknown failures are impossible states —
    // crash loudly rather than mask them as typed results.
    throw error;
  }
}

async function runExecution(tx: DbTx, args: ExecuteArgs): Promise<void> {
  const loaded = await loadTradeContext(tx, args.leagueId, args.payload, new Date());
  if (!loaded.ok) {
    throw new ExecuteAbort({ ok: false, error: loaded.error, detail: loaded.detail });
  }
  const validation = validateTradeProposal(toValidationInput(args.payload, loaded.context));
  if (!validation.ok) {
    throw new ExecuteAbort({
      ok: false,
      error: 'validation_failed',
      detail: `${validation.error}: ${validation.detail}`,
    });
  }

  const plan = planTradeExecution(args.payload, {
    proposingRoster: loaded.context.proposingRoster,
    counterpartyRoster: loaded.context.counterpartyRoster,
  });

  await movePlayers(tx, args.leagueId, plan.playerMoves);
  await movePicks(tx, args.leagueId, args.payload, plan.pickMoves);
  await clearDroppedLineupSlots(tx, {
    teamIds: [args.payload.proposingTeamId, args.payload.counterpartyTeamId],
    droppedPlayerIds: plan.playerMoves.map((move) => move.playerId),
    currentSeason: loaded.context.currentSeason,
    currentWeek: loaded.context.currentWeek,
    now: new Date(),
  });

  const processed = await guardedTradeStatus(
    tx,
    args.transactionId,
    args.expectedStatus,
    'processed',
    new Date(),
  );
  if (!processed) {
    // A concurrent actor resolved this transaction between the caller's read
    // and now (approve vs approve, approve vs veto). Roll everything back.
    throw new ExecuteAbort({ ok: false, error: 'invalid_status' });
  }
}

// DELETE each departing membership guarded by (league, player, FROM team):
// under READ COMMITTED a concurrent commit can move a player between our
// in-transaction validation read and this statement, so the team guard turns
// that race into a typed 'conflict' instead of silently moving the wrong row.
// Arrivals land status 'active' / acquiredVia 'trade' (plan decision #2).
async function movePlayers(
  tx: DbTx,
  leagueId: string,
  moves: readonly TradePlayerMove[],
): Promise<void> {
  invariant(moves.length <= MAX_PLAYER_MOVES, 'player move count exceeded its bound');
  if (moves.length === 0) {
    return;
  }
  let deletedCount = 0;
  for (const move of moves) {
    const deleted = await tx
      .delete(rosterMembers)
      .where(
        and(
          eq(rosterMembers.leagueId, leagueId),
          eq(rosterMembers.playerId, move.playerId),
          eq(rosterMembers.teamId, move.fromTeamId),
        ),
      )
      .returning({ id: rosterMembers.id });
    invariant(deleted.length <= 1, 'guarded roster delete touched more than one row');
    if (deleted.length !== 1) {
      throw new ExecuteAbort({
        ok: false,
        error: 'conflict',
        detail: `player ${move.playerId} is no longer on the sending roster`,
      });
    }
    deletedCount += 1;
  }

  const inserted = await tx
    .insert(rosterMembers)
    .values(
      moves.map((move) => ({
        leagueId,
        teamId: move.toTeamId,
        playerId: move.playerId,
        status: 'active' as const,
        acquiredVia: 'trade' as const,
      })),
    )
    .returning({ id: rosterMembers.id });

  // Post-invariants: moved counts match the plan exactly (spec contract).
  invariant(deletedCount === moves.length, 'deleted roster rows diverged from the plan');
  invariant(inserted.length === moves.length, 'inserted roster rows diverged from the plan');
}

// UPDATE each pick guarded by (league, id, FROM team). The currentTeamId
// guard is what stops the double-trade race: if another executed trade moved
// this pick after our validation read, zero rows match -> typed 'conflict'.
async function movePicks(
  tx: DbTx,
  leagueId: string,
  payload: TradePayload,
  moves: readonly TradePickMove[],
): Promise<void> {
  invariant(moves.length <= MAX_PICK_MOVES, 'pick move count exceeded its bound');
  let movedCount = 0;
  for (const move of moves) {
    // Two-team trade: the sender is whichever team is NOT the receiver.
    const fromTeamId =
      move.toTeamId === payload.proposingTeamId
        ? payload.counterpartyTeamId
        : payload.proposingTeamId;
    const updated = await tx
      .update(pickAssets)
      .set({ currentTeamId: move.toTeamId })
      .where(
        and(
          eq(pickAssets.id, move.pickId),
          eq(pickAssets.leagueId, leagueId),
          eq(pickAssets.currentTeamId, fromTeamId),
        ),
      )
      .returning({ id: pickAssets.id });
    invariant(updated.length <= 1, 'guarded pick update touched more than one row');
    if (updated.length !== 1) {
      throw new ExecuteAbort({
        ok: false,
        error: 'conflict',
        detail: `pick ${move.pickId} is no longer owned by the sending team`,
      });
    }
    movedCount += 1;
  }
  invariant(movedCount === moves.length, 'moved pick rows diverged from the plan');
}
