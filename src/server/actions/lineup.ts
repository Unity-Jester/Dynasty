'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { lineupSlots, transactions } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { invariant } from '@/lib/invariant';
import { validateLineup, type LineupAssignment, type LineupError } from '@/engine/lineup/validateLineup';
import type { CommishPayload } from '@/engine/transactions/payloads';
import { getLockedNflTeams } from '@/server/lineup/locks';
import { fetchLatestSeason, fetchTeam, loadValidationInputs, type TeamRow } from '@/server/lineup/lineupActionQueries';
import { fetchLeagueRow } from '@/server/trades/tradeQueries';

// Batched insert size (Rule 2/3). One team-week is well under a single batch;
// this exists to bound the loop, mirroring schedule.ts.
const INSERT_BATCH_SIZE = 500;

const AssignmentInput = z.object({
  slot: z.string().max(20),
  slotIndex: z.number().int().min(0).max(39),
  playerId: z.string().max(30).nullable(),
});

const SaveLineupInput = z.object({
  teamId: z.string().uuid(),
  season: z.number().int().min(2020).max(2050),
  week: z.number().int().min(1).max(18),
  assignments: z.array(AssignmentInput).max(30),
  // Commissioner override (Phase 7 Task 8): bypasses the owner gate AND lock
  // enforcement for the league CREATOR only — every other rule (shape,
  // roster membership, eligibility, duplicates) still applies. Defaults to
  // false so every existing caller is unaffected.
  asCommissioner: z.boolean().optional().default(false),
});

// The action's own gate/persistence codes plus every engine code from
// validateLineup (LineupError). Callers must branch on the full union.
export type SaveLineupError =
  | LineupError
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
  | 'not_creator'
  | 'wrong_season'
  | 'invalid_settings'
  | 'week_out_of_range'
  | 'conflict'
  | 'db_error';

export type SaveLineupResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: SaveLineupError; detail?: string };

const PG_UNIQUE_VIOLATION = '23505';

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Tagged like schedule.ts's gate — these action files are the template
// future flows copy; keep the discriminant uniform (review ruling).
type GatePass = { ok: true; team: TeamRow; settings: LeagueSettings };
type GateResult = GatePass | { ok: false; error: SaveLineupError; detail?: string };
type ParsedInput = z.infer<typeof SaveLineupInput>;

// Auth → team → owner → latest season → season match → settings → week range.
// Split out so saveLineup stays a thin orchestrator under the line cap (Rule 4).
type OwnershipGateResult = { ok: true } | { ok: false; error: 'not_found' | 'not_owner' | 'not_creator' };

// Owners only, UNLESS this is a commissioner override: asCommissioner=true
// skips the ownership check entirely (even for a team the creator happens to
// also own) but ONLY once the caller is verified as the league CREATOR
// (binding decision #10) — an owner who is not the creator gets no bypass on
// their own team via this flag. Split out of runGate purely to keep its own
// complexity under the lint cap.
async function resolveOwnershipGate(
  input: ParsedInput,
  team: TeamRow,
  userId: string,
): Promise<OwnershipGateResult> {
  if (!input.asCommissioner) {
    return userId === team.ownerId ? { ok: true } : { ok: false, error: 'not_owner' };
  }
  const league = await fetchLeagueRow(getDb(), team.leagueId);
  if (!league) {
    return { ok: false, error: 'not_found' };
  }
  return userId === league.createdBy ? { ok: true } : { ok: false, error: 'not_creator' };
}

async function runGate(input: ParsedInput, userId: string): Promise<GateResult> {
  const team = await fetchTeam(input.teamId);
  if (!team) {
    return { ok: false, error: 'not_found' };
  }
  const ownership = await resolveOwnershipGate(input, team, userId);
  if (!ownership.ok) {
    return ownership;
  }

  const season = await fetchLatestSeason(team.leagueId);
  if (!season) {
    return { ok: false, error: 'not_found' };
  }
  invariant(season.leagueId === team.leagueId, 'season does not belong to team league');
  // Defense against a stale client saving into a season that has since rolled
  // over: the client must name the season it thinks it's editing.
  if (season.year !== input.season) {
    return { ok: false, error: 'wrong_season' };
  }

  const parsed = LeagueSettingsSchema.safeParse(season.settings);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_settings', detail: firstZodIssueMessage(parsed.error) };
  }

  // Playoff lineups are post-MVP: only regular-season weeks are editable, so
  // valid weeks are 1..(startWeek - 1). Playoff-week saves are rejected here
  // rather than half-supported.
  const lastRegularWeek = parsed.data.playoffs.startWeek - 1;
  if (input.week < 1 || input.week > lastRegularWeek) {
    return {
      ok: false,
      error: 'week_out_of_range',
      detail: `week ${input.week} is outside the regular season (1..${lastRegularWeek})`,
    };
  }

  return { ok: true, team, settings: parsed.data };
}

type LineupRow = {
  teamId: string;
  season: number;
  week: number;
  slot: string;
  slotIndex: number;
  playerId: string | null;
};

// Audit context for a commissioner save — present only when asCommissioner
// gated true. Written as a `commish` transaction row in the SAME transaction
// as the lineup write (binding decision #10: EVERY commish mutation is
// audited, atomically with its effect).
type CommishLineupAudit = {
  leagueId: string;
  teamId: string;
  userId: string;
  week: number;
  changedSlots: number;
};

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// One transaction: replace the whole (team, season, week) instance set. We
// DELETE then batch-INSERT the full proposed set — INCLUDING empty slots as
// playerId=null rows — because the instance set is always fully materialized
// (one row per configured starter-slot instance, filled or not).
async function persistLineupTx(
  tx: Tx,
  rows: readonly LineupRow[],
  audit: CommishLineupAudit | null,
): Promise<number> {
  const [first] = rows;
  invariant(first !== undefined, 'refusing to persist an empty lineup instance set');
  await tx
    .delete(lineupSlots)
    .where(
      and(
        eq(lineupSlots.teamId, first.teamId),
        eq(lineupSlots.season, first.season),
        eq(lineupSlots.week, first.week),
      ),
    );

  const batchCount = Math.ceil(rows.length / INSERT_BATCH_SIZE);
  let inserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = rows.slice(i * INSERT_BATCH_SIZE, (i + 1) * INSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await tx.insert(lineupSlots).values(batch);
    inserted += batch.length;
  }

  if (audit !== null) {
    const now = new Date();
    const payload: CommishPayload = {
      kind: 'commish',
      action: 'lineup_edit',
      teamId: audit.teamId,
      detail: { week: audit.week, changedSlots: audit.changedSlots },
    };
    // Status 'processed' immediately (binding decision #11) — commish
    // mutations take effect synchronously, there is no review step.
    await tx.insert(transactions).values({
      leagueId: audit.leagueId,
      type: 'commish',
      status: 'processed',
      payload,
      createdBy: audit.userId,
      resolvedAt: now,
    });
  }

  return inserted;
}

async function persistLineup(
  rows: readonly LineupRow[],
  audit: CommishLineupAudit | null,
): Promise<SaveLineupResult> {
  try {
    const inserted = await getDb().transaction(async (tx) => persistLineupTx(tx, rows, audit));
    invariant(inserted === rows.length, 'inserted lineup count diverged from proposed');
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (error) {
    // 23505 on either lineup_slots index (instance uq or player-once partial
    // uq) means a concurrent save for this team-week raced us between our
    // DELETE and INSERT. Surface it as a retryable conflict, not a 500.
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'conflict' };
    }
    const code = pgErrorCode(error);
    return { ok: false, error: 'db_error', detail: code ? `database error (${code})` : 'database error' };
  }
}

export async function saveLineup(input: unknown): Promise<SaveLineupResult> {
  const parsed = SaveLineupInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const data = parsed.data;

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const gate = await runGate(data, userId);
  if (!gate.ok) {
    return gate;
  }

  const { members, playerPositions, playerNflTeams, current } = await loadValidationInputs(gate.team, data);
  const proposed: LineupAssignment[] = data.assignments.map((a) => ({
    slot: a.slot,
    slotIndex: a.slotIndex,
    playerId: a.playerId,
  }));

  // Locks are computed HERE, at validation time. A kickoff that occurs between
  // this read and the transaction commit below is accepted — that window is
  // milliseconds. The alternative (recomputing locks inside the transaction
  // and re-checking against the FOR-UPDATE'd rows) is deliberate future
  // hardening (TOCTOU), noted and NOT built for the MVP.
  //
  // Commissioner override: an EMPTY lock set bypasses lock enforcement
  // entirely (binding decision #10) — every other validateLineup rule
  // (shape, roster membership, active status, eligibility, duplicates)
  // still runs unchanged below.
  const lockedNflTeams = data.asCommissioner
    ? new Set<string>()
    : await getLockedNflTeams(data.season, data.week, new Date());

  const validation = validateLineup({
    settings: gate.settings,
    members,
    playerPositions,
    current,
    proposed,
    lockedNflTeams,
    playerNflTeams,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error, detail: validation.detail };
  }

  const rows: LineupRow[] = proposed.map((a) => ({
    teamId: gate.team.id,
    season: data.season,
    week: data.week,
    slot: a.slot,
    slotIndex: a.slotIndex,
    playerId: a.playerId,
  }));

  const audit: CommishLineupAudit | null = data.asCommissioner
    ? {
        leagueId: gate.team.leagueId,
        teamId: gate.team.id,
        userId,
        week: data.week,
        changedSlots: countChangedInstances(current, proposed),
      }
    : null;

  return persistLineup(rows, audit);
}

// Instance-keyed diff count (current vs proposed), same pairing logic as
// validateLineup's own checkLocks — used only for the commish audit row's
// `changedSlots` detail, never for a validation decision.
function countChangedInstances(
  current: readonly LineupAssignment[],
  proposed: readonly LineupAssignment[],
): number {
  const key = (a: LineupAssignment): string => `${a.slot}:${a.slotIndex}`;
  const currentByKey = new Map(current.map((a) => [key(a), a.playerId]));
  const proposedByKey = new Map(proposed.map((a) => [key(a), a.playerId]));
  const allKeys = new Set<string>([...currentByKey.keys(), ...proposedByKey.keys()]);
  let changed = 0;
  for (const k of allKeys) {
    if ((currentByKey.get(k) ?? null) !== (proposedByKey.get(k) ?? null)) {
      changed += 1;
    }
  }
  return changed;
}
