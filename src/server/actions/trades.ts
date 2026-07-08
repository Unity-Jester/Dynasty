'use server';

// Trade lifecycle actions (Phase 7 Task 3). State machine as implemented
// (plan decision #11; every transition is a guarded UPDATE):
//
//   pending --cancelTrade(proposer)------------------> cancelled  (terminal)
//   pending --respondToTrade reject------------------> rejected   (terminal)
//   pending --respondToTrade accept------------------> accepted
//   accepted --fresh re-validation FAILED------------> pending    (restored, typed error)
//   accepted --reviewMode none: executeTrade OK------> processed  (terminal)
//   accepted --reviewMode none: executeTrade FAILED--> pending    (restored, typed error)
//   accepted --reviewMode commissioner/league_vote---> pending_review
//   pending_review --reviewTrade veto----------------> vetoed     (terminal)
//   pending_review --reviewTrade approve OK----------> processed  (terminal)
//   pending_review --reviewTrade approve FAILED------> pending_review (execute rolls back;
//                                                      the commissioner sees the typed error
//                                                      and can retry or veto)
//
// While a request holds 'accepted' no OTHER actor can transition the row
// (accept/reject/cancel all guard on 'pending', review guards on
// 'pending_review'), so the accepted->pending restores are asserted, not
// error paths. league_vote behaves as commissioner for MVP (decision #3).

import { z } from 'zod';
import { getDb } from '@/server/db';
import { transactions } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { invariant } from '@/lib/invariant';
import {
  parseTransactionPayload,
  TradePayloadSchema,
  type TradePayload,
} from '@/engine/transactions/payloads';
import {
  validateTradeProposal,
  type TradeValidationErrorCode,
} from '@/engine/transactions/validateTrade';
import {
  fetchLeagueRow,
  fetchTeamRow,
  fetchTradeTransaction,
  guardedTradeStatus,
  loadTradeContext,
  toValidationInput,
  type TradeTransactionRow,
} from '@/server/trades/tradeQueries';
import { executeTrade, type ExecuteTradeFailure } from '@/server/trades/executeTrade';

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---- shared row loading -----------------------------------------------------

type LoadedTradeRow =
  | { ok: true; row: TradeTransactionRow; payload: TradePayload }
  | { ok: false; error: 'not_found' | 'invalid_payload'; detail?: string };

// EVERY read path obtains the payload via parseTransactionPayload — never a
// jsonb cast (Task 2 ruling: the engine treats a post-parse duplicate asset as
// an impossible state, so an unparsed payload could crash it). A row whose
// payload no longer parses is a typed 'invalid_payload', not a throw.
async function loadTradeRow(transactionId: string): Promise<LoadedTradeRow> {
  const row = await fetchTradeTransaction(getDb(), transactionId);
  if (!row) {
    return { ok: false, error: 'not_found' };
  }
  const parsed = parseTransactionPayload('trade', row.payload);
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_payload', detail: parsed.error };
  }
  if (parsed.value.kind !== 'trade') {
    // parseTransactionPayload cross-checks type/kind, so this cannot happen;
    // the branch exists to narrow the union for TypeScript.
    return { ok: false, error: 'invalid_payload', detail: 'payload kind is not trade' };
  }
  return { ok: true, row, payload: parsed.value };
}

// ---- proposeTrade -----------------------------------------------------------

// The client names both teams and both asset lists; `kind` is stamped
// server-side so the input schema IS the payload schema minus the tag.
const ProposeTradeInput = TradePayloadSchema.omit({ kind: true });

export type ProposeTradeWarning = { code: 'capacity'; detail: string };

export type ProposeTradeError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'wrong_league'
  | 'invalid_settings'
  // Engine codes re-exposed as-is; 'capacity' is excluded because a
  // capacity-only failure downgrades to a warning (see below).
  | Exclude<TradeValidationErrorCode, 'capacity'>;

export type ProposeTradeResult =
  | { ok: true; transactionId: string; warning?: ProposeTradeWarning }
  | { ok: false; error: ProposeTradeError; detail?: string };

type ProposeGate =
  | { ok: true; leagueId: string }
  | { ok: false; error: 'not_found' | 'not_owner' | 'wrong_league' };

async function runProposeGate(payload: TradePayload, userId: string): Promise<ProposeGate> {
  const proposing = await fetchTeamRow(getDb(), payload.proposingTeamId);
  const counterparty = await fetchTeamRow(getDb(), payload.counterpartyTeamId);
  if (!proposing || !counterparty) {
    return { ok: false, error: 'not_found' };
  }
  if (proposing.leagueId !== counterparty.leagueId) {
    return { ok: false, error: 'wrong_league' };
  }
  // Proposer must OWN the proposing team; the league creator gets no bypass.
  if (userId !== proposing.ownerId) {
    return { ok: false, error: 'not_owner' };
  }
  return { ok: true, leagueId: proposing.leagueId };
}

export async function proposeTrade(input: unknown): Promise<ProposeTradeResult> {
  const parsed = ProposeTradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const payload: TradePayload = { kind: 'trade', ...parsed.data };

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }
  const gate = await runProposeGate(payload, userId);
  if (!gate.ok) {
    return gate;
  }

  const loaded = await loadTradeContext(getDb(), gate.leagueId, payload, new Date());
  if (!loaded.ok) {
    return loaded;
  }
  const validation = validateTradeProposal(toValidationInput(payload, loaded.context));
  // Capacity is the LAST check in the engine's precedence order, so
  // error === 'capacity' means everything structural (ownership, window,
  // deadline) passed. Capacity alone does NOT block a proposal: rosters drift
  // between propose and accept (cuts, waivers, other trades), so it is
  // re-checked with fresh data at accept AND execute time. It is surfaced as
  // a warning so the proposer knows the receiver must cut first.
  if (!validation.ok && validation.error !== 'capacity') {
    return { ok: false, error: validation.error, detail: validation.detail };
  }
  const warning: ProposeTradeWarning | undefined = validation.ok
    ? undefined
    : { code: 'capacity', detail: validation.detail };

  const [row] = await getDb()
    .insert(transactions)
    .values({ leagueId: gate.leagueId, type: 'trade', status: 'pending', payload, createdBy: userId })
    .returning({ id: transactions.id });
  invariant(row !== undefined, 'transaction insert returned no row');
  return warning === undefined
    ? { ok: true, transactionId: row.id }
    : { ok: true, transactionId: row.id, warning };
}

// ---- respondToTrade ---------------------------------------------------------

const RespondToTradeInput = z.object({
  transactionId: z.string().uuid(),
  response: z.enum(['accept', 'reject']),
});

export type RespondToTradeError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'invalid_payload'
  | 'invalid_status'
  | 'invalid_settings'
  | 'validation_failed'
  | 'conflict'
  | 'db_error';

export type RespondToTradeResult =
  | { ok: true; status: 'rejected' | 'pending_review' | 'processed' }
  | { ok: false; error: RespondToTradeError; detail?: string };

export async function respondToTrade(input: unknown): Promise<RespondToTradeResult> {
  const parsed = RespondToTradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const loaded = await loadTradeRow(parsed.data.transactionId);
  if (!loaded.ok) {
    return loaded;
  }
  // The responder must own the counterparty team — the proposer cancels, the
  // creator reviews; neither responds.
  const counterparty = await fetchTeamRow(getDb(), loaded.payload.counterpartyTeamId);
  if (!counterparty) {
    return { ok: false, error: 'not_found' };
  }
  invariant(
    counterparty.leagueId === loaded.row.leagueId,
    'counterparty team drifted out of the transaction league',
  );
  if (userId !== counterparty.ownerId) {
    return { ok: false, error: 'not_owner' };
  }

  if (parsed.data.response === 'reject') {
    const won = await guardedTradeStatus(getDb(), loaded.row.id, 'pending', 'rejected', new Date());
    return won ? { ok: true, status: 'rejected' } : { ok: false, error: 'invalid_status' };
  }
  return acceptTrade(loaded.row, loaded.payload);
}

// Restore step shared by the accept path's failure branches. Asserted because
// no other actor transitions a row out of 'accepted' (see module header) —
// a lost restore means the state machine itself is broken.
async function restoreAcceptedToPending(transactionId: string): Promise<void> {
  const restored = await guardedTradeStatus(getDb(), transactionId, 'accepted', 'pending');
  invariant(restored, 'accepted->pending restore lost: no other actor leaves accepted');
}

// Accept path: win the pending->accepted race FIRST, then re-validate with
// fresh reads. Failure restores pending and tells the RESPONDER what broke
// (never a silent reject — the trade stays open). reviewMode none executes
// inline; commissioner/league_vote parks it for review.
async function acceptTrade(
  row: TradeTransactionRow,
  payload: TradePayload,
): Promise<RespondToTradeResult> {
  const won = await guardedTradeStatus(getDb(), row.id, 'pending', 'accepted');
  if (!won) {
    return { ok: false, error: 'invalid_status' };
  }

  const loaded = await loadTradeContext(getDb(), row.leagueId, payload, new Date());
  if (!loaded.ok) {
    await restoreAcceptedToPending(row.id);
    return loaded;
  }
  const validation = validateTradeProposal(toValidationInput(payload, loaded.context));
  if (!validation.ok) {
    await restoreAcceptedToPending(row.id);
    return {
      ok: false,
      error: 'validation_failed',
      detail: `${validation.error}: ${validation.detail}`,
    };
  }

  if (loaded.context.settings.trades.reviewMode !== 'none') {
    const parked = await guardedTradeStatus(getDb(), row.id, 'accepted', 'pending_review');
    invariant(parked, 'accepted->pending_review lost: no other actor leaves accepted');
    return { ok: true, status: 'pending_review' };
  }

  const executed = await executeTrade({
    transactionId: row.id,
    leagueId: row.leagueId,
    payload,
    expectedStatus: 'accepted',
  });
  if (!executed.ok) {
    // The execute transaction rolled back entirely; the row is still
    // 'accepted' (only this request transitions out of it), so restore it to
    // pending and surface the executor's typed error to the responder.
    await restoreAcceptedToPending(row.id);
    return { ok: false, error: executed.error, detail: executed.detail };
  }
  return { ok: true, status: 'processed' };
}

// ---- cancelTrade ------------------------------------------------------------

const CancelTradeInput = z.object({ transactionId: z.string().uuid() });

export type CancelTradeError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'invalid_payload'
  | 'invalid_status';

export type CancelTradeResult =
  | { ok: true }
  | { ok: false; error: CancelTradeError; detail?: string };

export async function cancelTrade(input: unknown): Promise<CancelTradeResult> {
  const parsed = CancelTradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const loaded = await loadTradeRow(parsed.data.transactionId);
  if (!loaded.ok) {
    return loaded;
  }
  // "Proposer" = the current owner of the proposing team (survives a team
  // changing hands better than createdBy would).
  const proposing = await fetchTeamRow(getDb(), loaded.payload.proposingTeamId);
  if (!proposing) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== proposing.ownerId) {
    return { ok: false, error: 'not_owner' };
  }

  const won = await guardedTradeStatus(getDb(), loaded.row.id, 'pending', 'cancelled', new Date());
  return won ? { ok: true } : { ok: false, error: 'invalid_status' };
}

// ---- reviewTrade ------------------------------------------------------------

const ReviewTradeInput = z.object({
  transactionId: z.string().uuid(),
  decision: z.enum(['approve', 'veto']),
});

export type ReviewTradeError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_creator'
  | 'invalid_payload'
  | 'invalid_status'
  | 'invalid_settings'
  | 'validation_failed'
  | 'conflict'
  | 'db_error';

export type ReviewTradeResult =
  | { ok: true; status: 'processed' | 'vetoed' }
  | { ok: false; error: ReviewTradeError; detail?: string };

export async function reviewTrade(input: unknown): Promise<ReviewTradeResult> {
  const parsed = ReviewTradeInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const loaded = await loadTradeRow(parsed.data.transactionId);
  if (!loaded.ok) {
    return loaded;
  }
  const league = await fetchLeagueRow(getDb(), loaded.row.leagueId);
  if (!league) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== league.createdBy) {
    return { ok: false, error: 'not_creator' };
  }

  // Advisory early check: avoids running a full execution transaction for a
  // row that is obviously not reviewable. Race-safe regardless — the guarded
  // transitions below (veto's UPDATE, approve's in-transaction guard) are the
  // authority, this read just fails fast for the common case.
  if (loaded.row.status !== 'pending_review') {
    return { ok: false, error: 'invalid_status' };
  }

  if (parsed.data.decision === 'veto') {
    const won = await guardedTradeStatus(
      getDb(),
      loaded.row.id,
      'pending_review',
      'vetoed',
      new Date(),
    );
    return won ? { ok: true, status: 'vetoed' } : { ok: false, error: 'invalid_status' };
  }

  // Approve: the pending_review->processed guard runs INSIDE the execute
  // transaction, atomic with the moves. On any failure the transaction rolls
  // back and the row is still pending_review — the commissioner can retry
  // after rosters change, or veto. No restore step is needed here.
  const executed = await executeTrade({
    transactionId: loaded.row.id,
    leagueId: loaded.row.leagueId,
    payload: loaded.payload,
    expectedStatus: 'pending_review',
  });
  if (!executed.ok) {
    return mapReviewExecuteFailure(executed);
  }
  return { ok: true, status: 'processed' };
}

function mapReviewExecuteFailure(failure: ExecuteTradeFailure): ReviewTradeResult {
  return { ok: false, error: failure.error, detail: failure.detail };
}
