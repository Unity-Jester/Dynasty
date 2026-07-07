'use server';

import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { lineupSlots, players, rosterMembers, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { invariant } from '@/lib/invariant';
import {
  validateLineup,
  type LineupAssignment,
  type LineupError,
  type LineupMember,
} from '@/engine/lineup/validateLineup';
import { getLockedNflTeams } from '@/server/lineup/locks';

// Roster members per team are bounded by the league's roster-slot totals
// (BENCH 15 + starters + TAXI/IR); 100 is generous headroom, not a real limit
// (Rule 3). The same cap bounds the player-detail fetch keyed off member ids.
const MAX_ROSTER = 100;
// A team-week has exactly (# starter slots) lineup rows — 9-ish for the default
// SUPER_FLEX build, MAX_SLOT_COUNT (40) at the schema ceiling. 30 comfortably
// covers any real starter set; it matches the validator's own MAX_ASSIGNMENTS.
const MAX_LINEUP_ROWS = 30;
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
});

// The action's own gate/persistence codes plus every engine code from
// validateLineup (LineupError). Callers must branch on the full union.
export type SaveLineupError =
  | LineupError
  | 'invalid_input'
  | 'unauthenticated'
  | 'not_found'
  | 'not_owner'
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

type TeamRow = { id: string; leagueId: string; ownerId: string | null };
type SeasonRow = { id: string; leagueId: string; year: number; settings: unknown };

async function fetchTeam(teamId: string): Promise<TeamRow | null> {
  const [row] = await getDb()
    .select({ id: teams.id, leagueId: teams.leagueId, ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

async function fetchLatestSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({
      id: seasons.id,
      leagueId: seasons.leagueId,
      year: seasons.year,
      settings: seasons.settings,
    })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

// Tagged like schedule.ts's gate — these action files are the template
// future flows copy; keep the discriminant uniform (review ruling).
type GatePass = { ok: true; team: TeamRow; settings: LeagueSettings };
type GateResult = GatePass | { ok: false; error: SaveLineupError; detail?: string };
type ParsedInput = z.infer<typeof SaveLineupInput>;

// Auth → team → owner → latest season → season match → settings → week range.
// Split out so saveLineup stays a thin orchestrator under the line cap (Rule 4).
async function runGate(input: ParsedInput, userId: string): Promise<GateResult> {
  const team = await fetchTeam(input.teamId);
  if (!team) {
    return { ok: false, error: 'not_found' };
  }
  // Owners only. The league CREATOR does NOT get to edit another owner's
  // lineup here — a commissioner override is a deliberate Phase 7 commish
  // tool, not this action. Compared against team.ownerId, never league.createdBy.
  if (userId !== team.ownerId) {
    return { ok: false, error: 'not_owner' };
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

type ValidationInputs = {
  members: LineupMember[];
  playerPositions: Map<string, string>;
  playerNflTeams: Map<string, string | null>;
  current: LineupAssignment[];
};

async function loadValidationInputs(team: TeamRow, input: ParsedInput): Promise<ValidationInputs> {
  const memberRows = await getDb()
    .select({ playerId: rosterMembers.playerId, status: rosterMembers.status })
    .from(rosterMembers)
    .where(eq(rosterMembers.teamId, team.id))
    .limit(MAX_ROSTER);
  invariant(memberRows.length <= MAX_ROSTER, 'roster member count exceeded its bound');
  const members: LineupMember[] = memberRows.map((r) => ({ playerId: r.playerId, status: r.status }));

  const memberIds = members.map((m) => m.playerId);
  const playerPositions = new Map<string, string>();
  const playerNflTeams = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const playerRows = await getDb()
      .select({ id: players.sleeperId, position: players.position, nflTeam: players.nflTeam })
      .from(players)
      .where(inArray(players.sleeperId, memberIds))
      .limit(MAX_ROSTER);
    invariant(playerRows.length <= MAX_ROSTER, 'player detail count exceeded its bound');
    for (const p of playerRows) {
      playerPositions.set(p.id, p.position);
      playerNflTeams.set(p.id, p.nflTeam);
    }
  }

  const currentRows = await getDb()
    .select({ slot: lineupSlots.slot, slotIndex: lineupSlots.slotIndex, playerId: lineupSlots.playerId })
    .from(lineupSlots)
    .where(
      and(
        eq(lineupSlots.teamId, team.id),
        eq(lineupSlots.season, input.season),
        eq(lineupSlots.week, input.week),
      ),
    )
    .limit(MAX_LINEUP_ROWS);
  invariant(currentRows.length <= MAX_LINEUP_ROWS, 'current lineup row count exceeded its bound');
  const current: LineupAssignment[] = currentRows.map((r) => ({
    slot: r.slot,
    slotIndex: r.slotIndex,
    playerId: r.playerId,
  }));

  return { members, playerPositions, playerNflTeams, current };
}

type LineupRow = {
  teamId: string;
  season: number;
  week: number;
  slot: string;
  slotIndex: number;
  playerId: string | null;
};

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// One transaction: replace the whole (team, season, week) instance set. We
// DELETE then batch-INSERT the full proposed set — INCLUDING empty slots as
// playerId=null rows — because the instance set is always fully materialized
// (one row per configured starter-slot instance, filled or not).
async function persistLineupTx(tx: Tx, rows: readonly LineupRow[]): Promise<number> {
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
  return inserted;
}

async function persistLineup(rows: readonly LineupRow[]): Promise<SaveLineupResult> {
  try {
    const inserted = await getDb().transaction(async (tx) => persistLineupTx(tx, rows));
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
  const lockedNflTeams = await getLockedNflTeams(data.season, data.week, new Date());

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

  return persistLineup(rows);
}
