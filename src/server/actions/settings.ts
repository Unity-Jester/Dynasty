'use server';

import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { invariant } from '@/lib/invariant';
import { firstZodIssueMessage } from '@/engine/zodIssue';

// Team rows per league are bounded by teamCount's hard cap (32, see
// engine/settings.ts). 40 leaves headroom without an unbounded scan (Rule 3).
const MAX_TEAMS = 40;

const UpdateSettingsInput = z.object({
  leagueId: z.string().uuid(),
  // Full document every save — no patching. zod is the trust boundary (Rule 5).
  settings: LeagueSettingsSchema,
});

export type UpdateSettingsResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'unauthenticated'
        | 'not_found'
        | 'not_creator'
        | 'season_locked'
        | 'team_count_mismatch';
      detail?: string;
    };

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

type LeagueRow = { id: string; createdBy: string };
type SeasonRow = { id: string; leagueId: string; phase: string };

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
    .select({ id: seasons.id, leagueId: seasons.leagueId, phase: seasons.phase })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

async function countTeams(leagueId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .limit(1);
  const total = row?.value ?? 0;
  invariant(total <= MAX_TEAMS, 'team count exceeds hard cap');
  return total;
}

export async function updateLeagueSettings(
  input: unknown,
): Promise<UpdateSettingsResult> {
  const parsed = UpdateSettingsInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }
  const { leagueId, settings } = parsed.data;

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

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

  const actualTeamCount = await countTeams(leagueId);
  if (settings.teamCount !== actualTeamCount) {
    return { ok: false, error: 'team_count_mismatch' };
  }

  // Guarded write: the phase clause re-checks offseason at the DB, so a race
  // with a phase transition settles as zero rows → season_locked (Rule 7).
  const updated = await getDb()
    .update(seasons)
    .set({ settings })
    .where(and(eq(seasons.id, season.id), eq(seasons.phase, 'offseason')))
    .returning({ id: seasons.id });
  if (updated.length === 0) {
    return { ok: false, error: 'season_locked' };
  }
  invariant(updated.length === 1, 'guarded update touched more than one season');

  return { ok: true };
}
