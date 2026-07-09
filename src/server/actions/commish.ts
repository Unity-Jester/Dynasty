'use server';

// Commissioner force-add / force-drop (Phase 7 Task 8). Both actions are
// creator-only (never owner-gated — a commissioner acts on ANY team in their
// league) and write an audited `commish` transaction, status 'processed'
// immediately (binding decision #11), in the SAME db.transaction as the
// roster mutation (binding decision #10: every commish mutation is atomic
// with its audit row). Mirrors executeTrade.ts's abort-from-tx idiom: a
// typed failure is thrown as a subclass of Error inside the transaction
// callback (never returned), so drizzle rolls back on any abort.

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { rosterMembers, transactions } from '@/server/schema';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { invariant } from '@/lib/invariant';
import { validateRosterCounts, type RosterMemberShape } from '@/engine/roster';
import type { LeagueSettings } from '@/engine/settings';
import { currentTradeWeek } from '@/server/currentWeek';
import { clearDroppedLineupSlots } from '@/server/rosterCleanup';
import { fetchRosterShapes, type DbTx } from '@/server/trades/tradeQueries';
import { fetchWeekKickoffs, isPlayerOnTeam, isPlayerRosteredInLeague, loadWaiverSettings } from '@/server/waivers/waiverQueries';
import {
  buildCommishAuditValues,
  fetchPlayerName,
  getAuthedUserId,
  pgErrorCode,
  requireCreatorForTeam,
  PG_UNIQUE_VIOLATION,
} from '@/server/commish/commishQueries';

// ---- commishForceAdd --------------------------------------------------------

const CommishForceAddInput = z.object({
  teamId: z.string().uuid(),
  playerId: z.string().min(1).max(30),
});

export type CommishForceAddError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_creator'
  | 'invalid_settings'
  | 'player_rostered'
  | 'over_capacity'
  | 'taxi_full'
  | 'ir_full'
  | 'conflict'
  | 'db_error';

export type CommishForceAddResult = { ok: true } | { ok: false; error: CommishForceAddError; detail?: string };

class ForceAddAbort extends Error {
  constructor(readonly failure: Extract<CommishForceAddResult, { ok: false }>) {
    super(`commish force-add aborted: ${failure.error}`);
    this.name = 'ForceAddAbort';
  }
}

type ForceAddArgs = {
  leagueId: string;
  teamId: string;
  playerId: string;
  playerName: string;
  settings: LeagueSettings;
  userId: string;
  now: Date;
};

// Final-authority checks + the write, all inside ONE transaction (mirrors
// executeTrade.runExecution): re-check unrostered-in-league, re-check
// capacity against a freshly-read roster, THEN insert. Capacity applies to
// the commissioner too (binding decision #10) — force-add is validated, not
// a raw bypass. Landed player status is 'active' (Sleeper parity: every
// other "land a new player" path — trade, waiver award — lands 'active';
// taxi/IR placement is a separate lineup-style move, not modeled here).
async function runForceAdd(tx: DbTx, args: ForceAddArgs): Promise<void> {
  if (await isPlayerRosteredInLeague(tx, args.leagueId, args.playerId)) {
    throw new ForceAddAbort({ ok: false, error: 'player_rostered' });
  }

  const members = await fetchRosterShapes(tx, args.teamId);
  const post: RosterMemberShape[] = [...members, { playerId: args.playerId, status: 'active' }];
  const counts = validateRosterCounts(args.settings, post);
  if (!counts.ok) {
    throw new ForceAddAbort({ ok: false, error: counts.error, detail: counts.detail });
  }

  await tx.insert(rosterMembers).values({
    leagueId: args.leagueId,
    teamId: args.teamId,
    playerId: args.playerId,
    status: 'active',
    acquiredVia: 'commish',
  });

  await tx.insert(transactions).values(
    buildCommishAuditValues({
      leagueId: args.leagueId,
      teamId: args.teamId,
      action: 'force_add',
      detail: { playerId: args.playerId, playerName: args.playerName },
      userId: args.userId,
      now: args.now,
    }),
  );
}

export async function commishForceAdd(input: unknown): Promise<CommishForceAddResult> {
  const parsed = CommishForceAddInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const gate = await requireCreatorForTeam(parsed.data.teamId, userId);
  if (!gate.ok) {
    return gate;
  }

  const playerName = await fetchPlayerName(getDb(), parsed.data.playerId);
  if (playerName === null) {
    return { ok: false, error: 'not_found', detail: 'unknown player' };
  }

  const settingsResult = await loadWaiverSettings(getDb(), gate.leagueId);
  if (!settingsResult.ok) {
    return {
      ok: false,
      error: settingsResult.error === 'not_found' ? 'not_found' : 'invalid_settings',
      detail: settingsResult.detail,
    };
  }

  try {
    await getDb().transaction(async (tx) =>
      runForceAdd(tx, {
        leagueId: gate.leagueId,
        teamId: gate.teamId,
        playerId: parsed.data.playerId,
        playerName,
        settings: settingsResult.settings,
        userId,
        now: new Date(),
      }),
    );
    return { ok: true };
  } catch (error) {
    return mapForceAddCatch(error);
  }
}

// roster_members_league_player_uq: someone else rostered this player
// (trade/waiver/another commish action) between our pre-check and the
// insert — the unique index is the final backstop. Split out of
// commishForceAdd purely to keep its own complexity under the lint cap.
function mapForceAddCatch(error: unknown): CommishForceAddResult {
  if (error instanceof ForceAddAbort) {
    return error.failure;
  }
  const code = pgErrorCode(error);
  if (code === PG_UNIQUE_VIOLATION) {
    return { ok: false, error: 'conflict' };
  }
  if (code !== null) {
    return { ok: false, error: 'db_error', detail: `database error (${code})` };
  }
  throw error;
}

// ---- commishForceDrop --------------------------------------------------------

const CommishForceDropInput = z.object({
  teamId: z.string().uuid(),
  playerId: z.string().min(1).max(30),
});

export type CommishForceDropError =
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_creator'
  | 'not_rostered'
  | 'invalid_settings'
  | 'conflict'
  | 'db_error';

export type CommishForceDropResult = { ok: true } | { ok: false; error: CommishForceDropError; detail?: string };

class ForceDropAbort extends Error {
  constructor(readonly failure: Extract<CommishForceDropResult, { ok: false }>) {
    super(`commish force-drop aborted: ${failure.error}`);
    this.name = 'ForceDropAbort';
  }
}

type ForceDropArgs = {
  leagueId: string;
  teamId: string;
  playerId: string;
  playerName: string;
  season: number;
  currentWeek: number;
  userId: string;
  now: Date;
};

// Guarded delete (final authority: a lost race — the player already left the
// roster via a trade/waiver/other commish action — is a typed conflict, not
// a silent no-op), then the SAME lock-aware lineup cleanup trades/waivers
// use, then the audit row. All one transaction (binding decision #5/#10).
async function runForceDrop(tx: DbTx, args: ForceDropArgs): Promise<void> {
  const deleted = await tx
    .delete(rosterMembers)
    .where(
      and(
        eq(rosterMembers.leagueId, args.leagueId),
        eq(rosterMembers.playerId, args.playerId),
        eq(rosterMembers.teamId, args.teamId),
      ),
    )
    .returning({ id: rosterMembers.id });
  invariant(deleted.length <= 1, 'guarded roster delete touched more than one row');
  if (deleted.length !== 1) {
    throw new ForceDropAbort({
      ok: false,
      error: 'conflict',
      detail: 'player is no longer on this roster',
    });
  }

  await clearDroppedLineupSlots(tx, {
    teamIds: [args.teamId],
    droppedPlayerIds: [args.playerId],
    currentSeason: args.season,
    currentWeek: args.currentWeek,
    now: args.now,
  });

  await tx.insert(transactions).values(
    buildCommishAuditValues({
      leagueId: args.leagueId,
      teamId: args.teamId,
      action: 'force_drop',
      detail: { playerId: args.playerId, playerName: args.playerName },
      userId: args.userId,
      now: args.now,
    }),
  );
}

export async function commishForceDrop(input: unknown): Promise<CommishForceDropResult> {
  const parsed = CommishForceDropInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const gate = await requireCreatorForTeam(parsed.data.teamId, userId);
  if (!gate.ok) {
    return gate;
  }

  const onRoster = await isPlayerOnTeam(getDb(), gate.teamId, parsed.data.playerId);
  if (!onRoster) {
    return { ok: false, error: 'not_rostered' };
  }

  const settingsResult = await loadWaiverSettings(getDb(), gate.leagueId);
  if (!settingsResult.ok) {
    return {
      ok: false,
      error: settingsResult.error === 'not_found' ? 'not_found' : 'invalid_settings',
      detail: settingsResult.detail,
    };
  }
  // Membership was just confirmed above, and rosterMembers.playerId is a
  // foreign key into players — the catalog row is guaranteed to exist.
  const playerName = (await fetchPlayerName(getDb(), parsed.data.playerId)) ?? parsed.data.playerId;

  const now = new Date();
  const lastRegularWeek = Math.max(1, settingsResult.settings.playoffs.startWeek - 1);
  const currentWeek = await currentTradeWeek(lastRegularWeek, now, (w) =>
    fetchWeekKickoffs(getDb(), settingsResult.year, w),
  );

  try {
    await getDb().transaction(async (tx) =>
      runForceDrop(tx, {
        leagueId: gate.leagueId,
        teamId: gate.teamId,
        playerId: parsed.data.playerId,
        playerName,
        season: settingsResult.year,
        currentWeek,
        userId,
        now,
      }),
    );
    return { ok: true };
  } catch (error) {
    return mapForceDropCatch(error);
  }
}

// Split out of commishForceDrop purely to keep its own complexity under the
// lint cap — same shape as mapForceAddCatch above.
function mapForceDropCatch(error: unknown): CommishForceDropResult {
  if (error instanceof ForceDropAbort) {
    return error.failure;
  }
  const code = pgErrorCode(error);
  if (code === PG_UNIQUE_VIOLATION) {
    return { ok: false, error: 'conflict' };
  }
  if (code !== null) {
    return { ok: false, error: 'db_error', detail: `database error (${code})` };
  }
  throw error;
}
