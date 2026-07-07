'use server';

import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, seasons, teams, matchups } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { generateRoundRobin } from '@/engine/schedule';
import { invariant } from '@/lib/invariant';
import { firstZodIssueMessage } from '@/engine/zodIssue';

// Team rows per league are bounded by teamCount's hard cap (32, see
// engine/settings.ts). 40 leaves headroom without an unbounded scan (Rule 3).
const MAX_TEAMS = 40;
// Batched insert size for matchup rows (Rule 2/3): 12 teams x 13 weeks = 78
// rows for a real league; this cap is generous headroom, not a real limit.
const INSERT_BATCH_SIZE = 500;
// Weeks x (teams/2) can never realistically exceed this; guards the insert
// loop with a named bound rather than trusting the engine's output blindly.
const MAX_MATCHUP_ROWS = 32 * 25;

const GenerateScheduleInput = z.object({
  leagueId: z.string().uuid(),
});

export type GenerateScheduleResult =
  | { ok: true; matchupCount: number }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'unauthenticated'
        | 'not_found'
        | 'not_creator'
        | 'season_locked'
        | 'already_scheduled'
        | 'invalid_team_count'
        | 'invalid_settings'
        | 'generation_failed'
        | 'db_error';
      detail?: string;
    };

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

type LeagueRow = { id: string; createdBy: string };
type SeasonRow = { id: string; leagueId: string; year: number; phase: string; settings: unknown };

async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({ id: leagues.id, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({
      id: seasons.id,
      leagueId: seasons.leagueId,
      year: seasons.year,
      phase: seasons.phase,
      settings: seasons.settings,
    })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

async function countExistingMatchups(leagueId: string, season: number): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.season, season)))
    .limit(1);
  return row?.value ?? 0;
}

async function fetchTeamIds(leagueId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .limit(MAX_TEAMS);
  invariant(rows.length <= MAX_TEAMS, 'team count exceeds hard cap');
  return rows.map((r) => r.id);
}

// The engine's per-week invariants already forbid a team appearing twice on
// the SAME side, but the cross-side collision (home in one pairing, away in
// another, same week) is not something the engine type guarantees to the
// caller's satisfaction and is NOT DB-enforced (see matchups table comment).
// Assert it explicitly before any row is written.
function assertNoCrossSideCollision(
  weekPairings: readonly { home: string; away: string }[],
  teamCount: number,
): void {
  const seen = new Set<string>();
  for (const pairing of weekPairings) {
    seen.add(pairing.home);
    seen.add(pairing.away);
  }
  invariant(
    seen.size === teamCount,
    `schedule week has a cross-side collision: ${seen.size} distinct teams, expected ${teamCount}`,
  );
}

type MatchupRow = {
  leagueId: string;
  season: number;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
};

function buildMatchupRows(
  leagueId: string,
  season: number,
  weeks: readonly { week: number; pairings: readonly { home: string; away: string }[] }[],
  teamCount: number,
): MatchupRow[] {
  const rows: MatchupRow[] = [];
  for (const weekPlan of weeks) {
    assertNoCrossSideCollision(weekPlan.pairings, teamCount);
    for (const pairing of weekPlan.pairings) {
      rows.push({
        leagueId,
        season,
        week: weekPlan.week,
        homeTeamId: pairing.home,
        awayTeamId: pairing.away,
      });
    }
  }
  invariant(rows.length <= MAX_MATCHUP_ROWS, 'generated matchup row count exceeds hard cap');
  return rows;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

async function insertMatchupRowsTx(tx: Tx, rows: readonly MatchupRow[]): Promise<number> {
  const batchCount = Math.ceil(rows.length / INSERT_BATCH_SIZE);
  let inserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = rows.slice(i * INSERT_BATCH_SIZE, (i + 1) * INSERT_BATCH_SIZE);
    if (batch.length === 0) continue;
    await tx.insert(matchups).values(batch);
    inserted += batch.length;
  }
  return inserted;
}

type GatePassResult = { ok: true; leagueId: string; season: SeasonRow };
type GateResult = GatePassResult | { ok: false; error: GenerateScheduleError; detail?: string };
type GenerateScheduleError = Exclude<GenerateScheduleResult, { ok: true }>['error'];

// Auth + creator + season + phase + already-scheduled gate, shared by every
// caller of generateSchedule. Split out so the exported function stays under
// the line/complexity caps (Rule 4).
async function runGate(leagueId: string, userId: string): Promise<GateResult> {
  const league = await fetchLeague(leagueId);
  if (!league) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== league.createdBy) {
    return { ok: false, error: 'not_creator' };
  }

  const season = await fetchCurrentSeason(leagueId);
  if (!season) {
    return { ok: false, error: 'not_found' };
  }
  invariant(season.leagueId === leagueId, 'season does not belong to league');
  if (season.phase !== 'offseason') {
    return { ok: false, error: 'season_locked' };
  }

  const existingCount = await countExistingMatchups(leagueId, season.year);
  if (existingCount > 0) {
    return { ok: false, error: 'already_scheduled' };
  }

  return { ok: true, leagueId, season };
}

type PlanResult =
  | { ok: true; rows: MatchupRow[]; expectedCount: number }
  | { ok: false; error: GenerateScheduleError; detail?: string };

// Loads teams + settings and runs the engine, producing the exact rows to
// insert. Split out so generateSchedule itself stays a thin orchestrator.
async function buildSchedulePlan(leagueId: string, season: SeasonRow): Promise<PlanResult> {
  const teamIds = await fetchTeamIds(leagueId);
  invariant(teamIds.length <= MAX_TEAMS, 'team count exceeds hard cap');
  if (teamIds.length < 4 || teamIds.length % 2 !== 0) {
    return {
      ok: false,
      error: 'invalid_team_count',
      detail: `league has ${teamIds.length} teams; scheduling requires an even count of at least 4`,
    };
  }

  const settingsParsed = LeagueSettingsSchema.safeParse(season.settings);
  if (!settingsParsed.success) {
    return { ok: false, error: 'invalid_settings', detail: firstZodIssueMessage(settingsParsed.error) };
  }

  const regularSeasonWeeks = settingsParsed.data.playoffs.startWeek - 1;
  const generated = generateRoundRobin(teamIds, regularSeasonWeeks);
  if (!generated.ok) {
    return { ok: false, error: 'generation_failed', detail: generated.error };
  }

  const rows = buildMatchupRows(leagueId, season.year, generated.value.weeks, teamIds.length);
  const expectedCount = regularSeasonWeeks * (teamIds.length / 2);
  invariant(rows.length === expectedCount, 'built matchup row count diverged from expected');
  return { ok: true, rows, expectedCount };
}

async function persistSchedule(
  rows: readonly MatchupRow[],
  expectedCount: number,
): Promise<GenerateScheduleResult> {
  try {
    const inserted = await getDb().transaction(async (tx) => insertMatchupRowsTx(tx, rows));
    invariant(inserted === expectedCount, 'inserted matchup count diverged from expected');
    return { ok: true, matchupCount: inserted };
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'already_scheduled' };
    }
    const code = pgErrorCode(error);
    return { ok: false, error: 'db_error', detail: code ? `database error (${code})` : 'database error' };
  }
}

export async function generateSchedule(input: unknown): Promise<GenerateScheduleResult> {
  const parsed = GenerateScheduleInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const { leagueId } = parsed.data;

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  const gate = await runGate(leagueId, userId);
  if (!gate.ok) {
    return gate;
  }

  const plan = await buildSchedulePlan(gate.leagueId, gate.season);
  if (!plan.ok) {
    return plan;
  }

  return persistSchedule(plan.rows, plan.expectedCount);
}
