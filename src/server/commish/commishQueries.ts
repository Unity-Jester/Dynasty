import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { players } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import type { CommishPayload } from '@/engine/transactions/payloads';
import { fetchLeagueRow, fetchTeamRow, type DbConn } from '@/server/trades/tradeQueries';

// Shared helpers for commish.ts's two actions (force-add / force-drop) — split
// into their own module purely to keep commish.ts's own file size under the
// lint cap (CODING_STANDARDS.md Rule 4), mirroring the tradeQueries.ts /
// waiverQueries.ts split for their respective action files.

export const PG_UNIQUE_VIOLATION = '23505';

export function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function fetchPlayerName(conn: DbConn, playerId: string): Promise<string | null> {
  const [row] = await conn.select({ fullName: players.fullName }).from(players).where(eq(players.sleeperId, playerId)).limit(1);
  return row?.fullName ?? null;
}

export type CreatorTeamGate =
  | { ok: true; teamId: string; leagueId: string }
  | { ok: false; error: 'not_found' | 'not_creator' };

/**
 * Shared gate for both commish actions: team must exist, and the caller must
 * be the league CREATOR — never the team owner, never a non-creator member.
 * This is the one check that makes "commish" mean something (binding
 * decision #10).
 */
export async function requireCreatorForTeam(teamId: string, userId: string): Promise<CreatorTeamGate> {
  const team = await fetchTeamRow(getDb(), teamId);
  if (!team) {
    return { ok: false, error: 'not_found' };
  }
  const league = await fetchLeagueRow(getDb(), team.leagueId);
  if (!league) {
    return { ok: false, error: 'not_found' };
  }
  if (userId !== league.createdBy) {
    return { ok: false, error: 'not_creator' };
  }
  return { ok: true, teamId: team.id, leagueId: team.leagueId };
}

export type CommishAuditRow = {
  leagueId: string;
  type: 'commish';
  status: 'processed';
  payload: CommishPayload;
  createdBy: string;
  resolvedAt: Date;
};

/** Builds a `commish` transactions insert row — status 'processed'
 *  immediately (binding decision #11), no review step for commish actions. */
export function buildCommishAuditValues(args: {
  leagueId: string;
  teamId: string;
  action: CommishPayload['action'];
  detail: Record<string, unknown>;
  userId: string;
  now: Date;
}): CommishAuditRow {
  const payload: CommishPayload = {
    kind: 'commish',
    action: args.action,
    teamId: args.teamId,
    detail: args.detail,
  };
  return {
    leagueId: args.leagueId,
    type: 'commish',
    status: 'processed',
    payload,
    createdBy: args.userId,
    resolvedAt: args.now,
  };
}
