'use server';

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, profiles, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { canClaimTeam, generateInviteToken, type ClaimError } from '@/engine/invites';
import { displayNameFromEmail } from '@/lib/auth/displayName';
import { invariant } from '@/lib/invariant';

const SEASON_YEAR = 2026;
const MAX_TEAM_COUNT = 32;
// Bounded read: a user should own at most one team per league, but cap the
// count query defensively rather than trusting the table (Rule 3).
const MAX_USER_TEAMS_SCAN = MAX_TEAM_COUNT;
// Postgres SQLSTATEs we branch on: FK violation (created_by/owner_id) and
// unique violation (teams_league_owner_uq settling concurrent claims).
const PG_FK_VIOLATION = '23503';
const PG_UNIQUE_VIOLATION = '23505';

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

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

type NewTeamRow = {
  leagueId: string;
  name: string;
  inviteToken: string;
  faabRemaining: number | null;
  waiverPriority: number;
};

// Seeds waiver state at creation (Phase 7 decision #8): FAAB leagues start every
// team at the full budget; priority leagues leave faabRemaining NULL (no budget
// concept). waiverPriority is creation order (1..teamCount) — the deterministic
// initial order the run job also uses to lazy-init any NULLs.
function buildTeamRows(leagueId: string, settings: LeagueSettings): NewTeamRow[] {
  const faabRemaining = settings.waivers.mode === 'faab' ? settings.waivers.budget : null;
  const rows: NewTeamRow[] = [];
  for (let i = 1; i <= settings.teamCount; i += 1) {
    rows.push({ leagueId, name: `Team ${i}`, inviteToken: generateInviteToken(), faabRemaining, waiverPriority: i });
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
    if (pgErrorCode(error) === PG_FK_VIOLATION) {
      return { ok: false, error: 'no_profile' };
    }
    throw error;
  }
}

// ---- claimTeam ------------------------------------------------------------

const ClaimTeamInput = z.object({ token: z.string().min(1).max(200) });

// Tied to the engine union so the action can't drift from canClaimTeam's
// vocabulary; only transport-level failures are added here.
export type ClaimResult =
  | { ok: true; leagueId: string }
  | {
      ok: false;
      error: ClaimError | 'unauthenticated' | 'invalid_input' | 'invalid_token';
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

  // Advisory pre-read for friendly UX only: it catches the common case before
  // any write, but concurrent claims can slip past it. The enforced invariant
  // is the teams_league_owner_uq partial unique index, handled below.
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

  // The claim is a meaningful action, so only now seed a profile row for
  // first-time invitees (FK target for owner_id; same pattern as the auth
  // callback). Failed claim attempts above never create profiles.
  await ensureProfile(user);

  // Race guard: only claim if still unclaimed. If another request won, the
  // guarded WHERE matches zero rows and we report already_claimed. Note the
  // WHERE guard protects single-row invariants only; multi-row invariants
  // (one team per owner per league) need a DB constraint — that's
  // teams_league_owner_uq, whose violation we map to user_has_team.
  try {
    const updated = await db
      .update(teams)
      .set({ ownerId: user.id, inviteToken: sql`NULL` })
      .where(and(eq(teams.id, team.id), isNull(teams.ownerId)))
      .returning({ id: teams.id });
    if (updated.length === 0) {
      return { ok: false, error: 'already_claimed' };
    }
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: 'user_has_team' };
    }
    throw error;
  }
  return { ok: true, leagueId: team.leagueId };
}
