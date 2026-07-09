'use server';

// Waiver claim actions (Phase 7 Task 6). Claim lifecycle (decision #11; every
// transition is a guarded UPDATE):
//
//   pending --cancelClaim(owner)-------------------> cancelled  (terminal)
//   pending --runWaivers award---------------------> processed  (terminal, resolution)
//   pending --runWaivers reject / bad payload------> rejected   (terminal, resolution)
//
// submitClaim inserts the pending row; the run job (runWaivers.ts) resolves it.
// processWaiversNow is the creator-only "run now" button, wrapping the same job
// for a single league (no CRON_SECRET — auth is league ownership).

import { z } from 'zod';
import { getDb } from '@/server/db';
import { transactions } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { invariant } from '@/lib/invariant';
import {
  parseTransactionPayload,
  type WaiverClaimPayload,
} from '@/engine/transactions/payloads';
import type { LeagueSettings } from '@/engine/settings';
import { fetchLeagueRow } from '@/server/trades/tradeQueries';
import {
  fetchWaiverTeamRow,
  fetchWaiverTransaction,
  guardedWaiverStatus,
  hasDuplicatePendingClaim,
  isPlayerOnTeam,
  isPlayerRosteredInLeague,
  loadWaiverSettings,
  type DbConn,
} from '@/server/waivers/waiverQueries';
import { runWaivers, type RunWaiversResult } from '@/server/jobs/runWaivers';

const MAX_BID = 10_000; // mirrors WaiverClaimPayloadSchema's bid cap.

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ---- submitClaim ------------------------------------------------------------

const SubmitClaimInput = z.object({
  teamId: z.string().uuid(),
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).nullable().default(null),
  bid: z.number().int().min(0).max(MAX_BID).nullable().default(null),
});
type SubmitClaimData = z.infer<typeof SubmitClaimInput>;

export type SubmitClaimError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'invalid_settings'
  | 'player_rostered'
  | 'bid_required' // FAAB league, no bid supplied (0 is allowed, null is not).
  | 'bid_not_allowed' // priority league, a bid was supplied.
  | 'insufficient_funds' // bid exceeds the team's remaining FAAB (advisory — re-checked at run).
  | 'invalid_drop' // dropPlayerId is not on the claiming team's roster.
  | 'duplicate_claim';

export type SubmitClaimResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: SubmitClaimError; detail?: string };

type BidResult =
  | { ok: true; bid: number | null }
  | { ok: false; error: 'bid_required' | 'bid_not_allowed' | 'insufficient_funds' };

// Bid is required iff FAAB (0 allowed); in priority mode a bid is rejected.
// The FAAB affordability check is advisory here (null faab lazy-inits to the
// budget) — the run re-checks against live balances (decision #8/#9).
function resolveBid(settings: LeagueSettings, faabRemaining: number | null, bid: number | null): BidResult {
  if (settings.waivers.mode === 'faab') {
    if (bid === null) {
      return { ok: false, error: 'bid_required' };
    }
    const effective = faabRemaining ?? settings.waivers.budget;
    if (bid > effective) {
      return { ok: false, error: 'insufficient_funds' };
    }
    return { ok: true, bid };
  }
  if (bid !== null) {
    return { ok: false, error: 'bid_not_allowed' };
  }
  return { ok: true, bid: null };
}

type ClaimGateResult =
  | { ok: true }
  | { ok: false; error: 'player_rostered' | 'invalid_drop' | 'duplicate_claim' };

// Bounded availability gates: the add player must be UNROSTERED league-wide
// (the league-player unique index backstops at award time), the drop (if any)
// must be on the claiming roster, and no identical pending claim may exist.
async function runClaimGates(conn: DbConn, leagueId: string, input: SubmitClaimData): Promise<ClaimGateResult> {
  if (await isPlayerRosteredInLeague(conn, leagueId, input.addPlayerId)) {
    return { ok: false, error: 'player_rostered' };
  }
  if (input.dropPlayerId !== null && !(await isPlayerOnTeam(conn, input.teamId, input.dropPlayerId))) {
    return { ok: false, error: 'invalid_drop' };
  }
  if (await hasDuplicatePendingClaim(conn, leagueId, input.teamId, input.addPlayerId)) {
    return { ok: false, error: 'duplicate_claim' };
  }
  return { ok: true };
}

export async function submitClaim(input: unknown): Promise<SubmitClaimResult> {
  const parsed = SubmitClaimInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const db = getDb();
  const team = await fetchWaiverTeamRow(db, parsed.data.teamId);
  if (!team) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== team.ownerId) {
    return { ok: false, error: 'not_owner' };
  }

  const settings = await loadWaiverSettings(db, team.leagueId);
  if (!settings.ok) {
    return { ok: false, error: settings.error === 'not_found' ? 'not_found' : 'invalid_settings', detail: settings.detail };
  }
  const bid = resolveBid(settings.settings, team.faabRemaining, parsed.data.bid);
  if (!bid.ok) {
    return { ok: false, error: bid.error };
  }
  const gate = await runClaimGates(db, team.leagueId, parsed.data);
  if (!gate.ok) {
    return gate;
  }

  const payload: WaiverClaimPayload = {
    kind: 'waiver_claim',
    teamId: parsed.data.teamId,
    addPlayerId: parsed.data.addPlayerId,
    dropPlayerId: parsed.data.dropPlayerId,
    bid: bid.bid,
  };
  const [row] = await db
    .insert(transactions)
    .values({ leagueId: team.leagueId, type: 'waiver_claim', status: 'pending', payload, createdBy: userId })
    .returning({ id: transactions.id });
  invariant(row !== undefined, 'waiver claim insert returned no row');
  return { ok: true, transactionId: row.id };
}

// ---- cancelClaim ------------------------------------------------------------

const CancelClaimInput = z.object({ transactionId: z.string().uuid() });

export type CancelClaimError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'invalid_payload'
  | 'invalid_status';

export type CancelClaimResult = { ok: true } | { ok: false; error: CancelClaimError; detail?: string };

export async function cancelClaim(input: unknown): Promise<CancelClaimResult> {
  const parsed = CancelClaimInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const db = getDb();
  const row = await fetchWaiverTransaction(db, parsed.data.transactionId);
  if (!row) {
    return { ok: false, error: 'not_found' };
  }
  const payload = parseTransactionPayload('waiver_claim', row.payload);
  if (!payload.ok || payload.value.kind !== 'waiver_claim') {
    return { ok: false, error: 'invalid_payload', detail: payload.ok ? 'payload kind is not waiver_claim' : payload.error };
  }
  // Owner of the CLAIMING team may cancel (survives a team changing hands
  // better than createdBy would).
  const team = await fetchWaiverTeamRow(db, payload.value.teamId);
  if (!team) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== team.ownerId) {
    return { ok: false, error: 'not_owner' };
  }

  const won = await guardedWaiverStatus(db, row.id, 'pending', 'cancelled', new Date());
  return won ? { ok: true } : { ok: false, error: 'invalid_status' };
}

// ---- processWaiversNow (commissioner "run now") -----------------------------

export type ProcessWaiversError = 'invalid_input' | 'unauthenticated' | 'not_found' | 'not_creator';

export type ProcessWaiversResult =
  | { ok: true; result: RunWaiversResult }
  | { ok: false; error: ProcessWaiversError };

/**
 * Creator-only "run waivers now" for a single league — powers the commissioner
 * UI button. Wraps the SAME job logic as the cron route (runWaivers) but gates
 * on league ownership instead of CRON_SECRET, and scopes to one league.
 */
export async function processWaiversNow(leagueId: unknown): Promise<ProcessWaiversResult> {
  const parsed = z.string().uuid().safeParse(leagueId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }
  const league = await fetchLeagueRow(getDb(), parsed.data);
  if (!league) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== league.createdBy) {
    return { ok: false, error: 'not_creator' };
  }
  const result = await runWaivers(parsed.data);
  return { ok: true, result };
}
