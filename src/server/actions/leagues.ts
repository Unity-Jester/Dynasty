'use server';

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, profiles, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { canClaimTeam, generateInviteToken } from '@/engine/invites';
import { displayNameFromEmail } from '@/lib/auth/displayName';
import { invariant } from '@/lib/invariant';

const SEASON_YEAR = 2026;
const MAX_TEAM_COUNT = 32;
// Bounded read: a user should own at most one team per league, but cap the
// count query defensively rather than trusting the table (Rule 3).
const MAX_USER_TEAMS_SCAN = MAX_TEAM_COUNT;
// Postgres unique-violation SQLSTATE; a FK violation on created_by uses 23503.
const PG_FK_VIOLATION = '23503';

type AuthedUser = { id: string; email: string };

async function getAuthedUser(): Promise<AuthedUser | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  return { id: user.id, email: user.email ?? '' };
}

// ---- createLeague ---------------------------------------------------------

const CreateLeagueInput = z.object({
  name: z.string().trim().min(1).max(80),
  settings: LeagueSettingsSchema,
});

export type CreateLeagueResult =
  | { ok: true; leagueId: string }
  | { ok: false; error: 'unauthenticated' | 'invalid_input' | 'no_profile' };

function isFkViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_FK_VIOLATION
  );
}

function buildTeamRows(leagueId: string, settings: LeagueSettings) {
  const rows: { leagueId: string; name: string; inviteToken: string }[] = [];
  for (let i = 1; i <= settings.teamCount; i += 1) {
    rows.push({ leagueId, name: `Team ${i}`, inviteToken: generateInviteToken() });
  }
  return rows;
}

export async function createLeague(input: unknown): Promise<CreateLeagueResult> {
  const parsed = CreateLeagueInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const { name, settings } = parsed.data;
  invariant(settings.teamCount <= MAX_TEAM_COUNT, 'teamCount exceeds hard cap');

  const user = await getAuthedUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  try {
    const leagueId = await getDb().transaction(async (tx) => {
      const [league] = await tx
        .insert(leagues)
        .values({ name, createdBy: user.id })
        .returning({ id: leagues.id });
      invariant(league, 'league insert returned no row');
      await tx.insert(seasons).values({
        leagueId: league.id,
        year: SEASON_YEAR,
        settings,
      });
      await tx.insert(teams).values(buildTeamRows(league.id, settings));
      return league.id;
    });
    return { ok: true, leagueId };
  } catch (error) {
    if (isFkViolation(error)) {
      return { ok: false, error: 'no_profile' };
    }
    throw error;
  }
}

// ---- claimTeam ------------------------------------------------------------

const ClaimTeamInput = z.object({ token: z.string().min(1).max(200) });

export type ClaimResult =
  | { ok: true; leagueId: string }
  | {
      ok: false;
      error:
        | 'unauthenticated'
        | 'invalid_input'
        | 'invalid_token'
        | 'already_claimed'
        | 'no_token'
        | 'token_mismatch'
        | 'user_has_team';
    };

async function ensureProfile(user: AuthedUser): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({ id: user.id, displayName: displayNameFromEmail(user.email) })
    .onConflictDoNothing({ target: profiles.id });
}

export async function claimTeam(input: unknown): Promise<ClaimResult> {
  const parsed = ClaimTeamInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const user = await getAuthedUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const db = getDb();
  const [team] = await db
    .select({ id: teams.id, leagueId: teams.leagueId, ownerId: teams.ownerId, inviteToken: teams.inviteToken })
    .from(teams)
    .where(eq(teams.inviteToken, parsed.data.token))
    .limit(1);
  if (!team) {
    return { ok: false, error: 'invalid_token' };
  }

  // First-time invitees have no profile row yet; seed one before the FK-bound
  // UPDATE (same pattern as the auth callback).
  await ensureProfile(user);

  const owned = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, team.leagueId), eq(teams.ownerId, user.id)))
    .limit(MAX_USER_TEAMS_SCAN);

  const check = canClaimTeam({
    team: { ownerId: team.ownerId, inviteToken: team.inviteToken },
    presentedToken: parsed.data.token,
    userId: user.id,
    userTeamCountInLeague: owned.length,
  });
  if (!check.ok) {
    return { ok: false, error: check.error };
  }

  // Race guard: only claim if still unclaimed. If another request won, the
  // guarded WHERE matches zero rows and we report already_claimed.
  const updated = await db
    .update(teams)
    .set({ ownerId: user.id, inviteToken: sql`NULL` })
    .where(and(eq(teams.id, team.id), isNull(teams.ownerId)))
    .returning({ id: teams.id });
  if (updated.length === 0) {
    return { ok: false, error: 'already_claimed' };
  }
  return { ok: true, leagueId: team.leagueId };
}
