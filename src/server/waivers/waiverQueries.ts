import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  matchups,
  nflGames,
  rosterMembers,
  seasons,
  teams,
  transactions,
} from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import type { RosterMemberShape } from '@/engine/roster';
import type { MatchupResult } from '@/engine/standings';
import { type WaiverClaimPayload } from '@/engine/transactions/payloads';
import type { DbConn, TransactionStatus } from '@/server/trades/tradeQueries';

// Bounded reads (Rule 2/3). A weekly run touches far fewer rows than any of
// these; each cap is a hard error boundary, not a normal limit.
const MAX_LEAGUES_PER_RUN = 50;
const MAX_CLAIMS_PER_LEAGUE = 200; // = resolveWaiverRun's MAX_CLAIMS.
const MAX_TEAMS = 40;
const MAX_LEAGUE_ROSTER_ROWS = MAX_TEAMS * 100; // teamCount * roster-slot cap.
const MAX_SEASON_MATCHUPS = 500; // = computeStandings' MAX_MATCHUPS.
const MAX_GAMES_PER_WEEK = 40; // one NFL week has <=32 team-rows.

export type { DbConn } from '@/server/trades/tradeQueries';

// ---- action-side reads ------------------------------------------------------

export type WaiverTeamRow = {
  id: string;
  leagueId: string;
  ownerId: string | null;
  faabRemaining: number | null;
};

export async function fetchWaiverTeamRow(conn: DbConn, teamId: string): Promise<WaiverTeamRow | null> {
  const [row] = await conn
    .select({
      id: teams.id,
      leagueId: teams.leagueId,
      ownerId: teams.ownerId,
      faabRemaining: teams.faabRemaining,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export type WaiverSettingsResult =
  | { ok: true; settings: LeagueSettings; year: number }
  | { ok: false; error: 'not_found' | 'invalid_settings'; detail?: string };

// Latest season row (highest year) + parsed settings — the single source of
// truth for a league's waiver mode/budget, mirroring tradeQueries/scoreWeek.
export async function loadWaiverSettings(conn: DbConn, leagueId: string): Promise<WaiverSettingsResult> {
  const [row] = await conn
    .select({ year: seasons.year, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  if (!row) {
    return { ok: false, error: 'not_found' };
  }
  const parsed = LeagueSettingsSchema.safeParse(row.settings);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_settings', detail: firstZodIssueMessage(parsed.error) };
  }
  return { ok: true, settings: parsed.data, year: row.year };
}

// True if the player already holds a roster spot ANYWHERE in this league — the
// bounded advisory add-availability check (the league-player unique index is
// the award-time backstop).
export async function isPlayerRosteredInLeague(
  conn: DbConn,
  leagueId: string,
  playerId: string,
): Promise<boolean> {
  const [row] = await conn
    .select({ id: rosterMembers.id })
    .from(rosterMembers)
    .where(and(eq(rosterMembers.leagueId, leagueId), eq(rosterMembers.playerId, playerId)))
    .limit(1);
  return row !== undefined;
}

export async function isPlayerOnTeam(conn: DbConn, teamId: string, playerId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: rosterMembers.id })
    .from(rosterMembers)
    .where(and(eq(rosterMembers.teamId, teamId), eq(rosterMembers.playerId, playerId)))
    .limit(1);
  return row !== undefined;
}

// A pending claim by the SAME team for the SAME add player already exists.
// Reads the jsonb payload's teamId/addPlayerId via ->> (never casts the row).
export async function hasDuplicatePendingClaim(
  conn: DbConn,
  leagueId: string,
  teamId: string,
  addPlayerId: string,
): Promise<boolean> {
  const [row] = await conn
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.leagueId, leagueId),
        eq(transactions.type, 'waiver_claim'),
        eq(transactions.status, 'pending'),
        sql`(${transactions.payload} ->> 'teamId') = ${teamId}`,
        sql`(${transactions.payload} ->> 'addPlayerId') = ${addPlayerId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type WaiverTransactionRow = {
  id: string;
  leagueId: string;
  status: TransactionStatus;
  payload: unknown;
};

export async function fetchWaiverTransaction(
  conn: DbConn,
  transactionId: string,
): Promise<WaiverTransactionRow | null> {
  const [row] = await conn
    .select({
      id: transactions.id,
      leagueId: transactions.leagueId,
      status: transactions.status,
      payload: transactions.payload,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.type, 'waiver_claim')))
    .limit(1);
  return row ?? null;
}

// ---- guarded transitions (waiver analogs of guardedTradeStatus) -------------

/**
 * Guarded status-only transition for a waiver claim: UPDATE only where the row
 * is still `from` AND is a waiver_claim; a lost race matches zero rows and
 * returns false. Used by cancelClaim (pending->cancelled).
 */
export async function guardedWaiverStatus(
  conn: DbConn,
  transactionId: string,
  from: TransactionStatus,
  to: TransactionStatus,
  resolvedAt?: Date,
): Promise<boolean> {
  invariant(from !== to, 'guarded status transition must change the status');
  const updated = await conn
    .update(transactions)
    .set(resolvedAt === undefined ? { status: to } : { status: to, resolvedAt })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.type, 'waiver_claim'),
        eq(transactions.status, from),
      ),
    )
    .returning({ id: transactions.id });
  invariant(updated.length <= 1, 'guarded status update touched more than one row');
  return updated.length === 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Best-effort guarded reject (pending->rejected) of a claim whose stored
 * payload no longer parses as a WaiverClaimPayload. When the payload is still
 * a plain object, a resolution-style annotation is merged in so the audit
 * trail records WHY the claim was rejected; the merged document still fails
 * the payload schema (fine — the UI already renders unreadable transactions
 * degraded). Non-object garbage is left untouched — a bare status flip —
 * rather than fabricating a payload that was never submitted; for those rows
 * the reason lives only in the status + resolvedAt.
 */
export async function rejectUnparseableClaim(
  conn: DbConn,
  transactionId: string,
  rawPayload: unknown,
  now: Date,
): Promise<boolean> {
  const annotated = isPlainObject(rawPayload)
    ? { ...rawPayload, resolution: { outcome: 'rejected', reason: 'invalid_payload' } }
    : null;
  const updated = await conn
    .update(transactions)
    .set(
      annotated === null
        ? { status: 'rejected', resolvedAt: now }
        : { status: 'rejected', payload: annotated, resolvedAt: now },
    )
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.type, 'waiver_claim'),
        eq(transactions.status, 'pending'),
      ),
    )
    .returning({ id: transactions.id });
  invariant(updated.length <= 1, 'guarded unparseable reject touched more than one row');
  return updated.length === 1;
}

/**
 * Guarded resolution of a pending waiver claim: sets status + the resolved
 * payload (carrying the engine's resolution) + resolvedAt in one UPDATE,
 * guarded on status='pending'. Returns false if the row is no longer pending
 * (e.g. a concurrent cancel won) — the run job treats that as a drift abort.
 */
export async function resolveWaiverClaim(
  conn: DbConn,
  transactionId: string,
  to: 'processed' | 'rejected',
  payload: WaiverClaimPayload,
  now: Date,
): Promise<boolean> {
  const updated = await conn
    .update(transactions)
    .set({ status: to, payload, resolvedAt: now })
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.type, 'waiver_claim'),
        eq(transactions.status, 'pending'),
      ),
    )
    .returning({ id: transactions.id });
  invariant(updated.length <= 1, 'guarded resolution touched more than one row');
  return updated.length === 1;
}

// ---- run-job reads ----------------------------------------------------------

// Distinct leagues that currently have at least one pending waiver claim.
export async function fetchPendingWaiverLeagueIds(conn: DbConn): Promise<string[]> {
  const rows = await conn
    .selectDistinct({ leagueId: transactions.leagueId })
    .from(transactions)
    .where(and(eq(transactions.type, 'waiver_claim'), eq(transactions.status, 'pending')))
    .limit(MAX_LEAGUES_PER_RUN);
  invariant(rows.length <= MAX_LEAGUES_PER_RUN, 'pending-waiver league count exceeded its bound');
  return rows.map((r) => r.leagueId);
}

export type PendingClaimRow = { id: string; payload: unknown; createdAt: Date };

// One league's pending claims, oldest first (createdAt drives the engine's
// deterministic tiebreak). Bounded at the engine's own claim ceiling.
export async function fetchPendingWaiverClaims(conn: DbConn, leagueId: string): Promise<PendingClaimRow[]> {
  const rows = await conn
    .select({ id: transactions.id, payload: transactions.payload, createdAt: transactions.createdAt })
    .from(transactions)
    .where(
      and(
        eq(transactions.leagueId, leagueId),
        eq(transactions.type, 'waiver_claim'),
        eq(transactions.status, 'pending'),
      ),
    )
    .orderBy(transactions.createdAt)
    .limit(MAX_CLAIMS_PER_LEAGUE);
  invariant(rows.length <= MAX_CLAIMS_PER_LEAGUE, 'pending claim count exceeded its bound');
  return rows;
}

export type WaiverTeamStateRow = {
  id: string;
  faabRemaining: number | null;
  waiverPriority: number | null;
  createdAt: Date;
};

// Every team in the league with its waiver state, ordered by creation (the
// deterministic lazy-init order for NULL waiverPriority).
export async function fetchLeagueTeamStates(conn: DbConn, leagueId: string): Promise<WaiverTeamStateRow[]> {
  const rows = await conn
    .select({
      id: teams.id,
      faabRemaining: teams.faabRemaining,
      waiverPriority: teams.waiverPriority,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .orderBy(teams.createdAt, teams.id)
    .limit(MAX_TEAMS);
  invariant(rows.length <= MAX_TEAMS, 'league team count exceeded its bound');
  return rows;
}

// Rosters for every team in the league, grouped by team; teams with no members
// still get an (empty) entry so the engine's per-team roster lookup is total.
export async function fetchLeagueRostersByTeam(
  conn: DbConn,
  leagueId: string,
  teamIds: readonly string[],
): Promise<Map<string, RosterMemberShape[]>> {
  const byTeam = new Map<string, RosterMemberShape[]>();
  for (const teamId of teamIds) {
    byTeam.set(teamId, []);
  }
  const rows = await conn
    .select({ teamId: rosterMembers.teamId, playerId: rosterMembers.playerId, status: rosterMembers.status })
    .from(rosterMembers)
    .where(eq(rosterMembers.leagueId, leagueId))
    .limit(MAX_LEAGUE_ROSTER_ROWS);
  invariant(rows.length <= MAX_LEAGUE_ROSTER_ROWS, 'league roster row count exceeded its bound');
  for (const row of rows) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push({ playerId: row.playerId, status: row.status });
    byTeam.set(row.teamId, list);
  }
  return byTeam;
}

// Final matchups for the season as the engine's MatchupResult shape; standings
// are computed from ONLY final rows (computeStandings ignores non-final).
export async function fetchSeasonMatchupResults(
  conn: DbConn,
  leagueId: string,
  season: number,
): Promise<MatchupResult[]> {
  const rows = await conn
    .select({
      homeTeamId: matchups.homeTeamId,
      awayTeamId: matchups.awayTeamId,
      homePoints: matchups.homePoints,
      awayPoints: matchups.awayPoints,
      final: matchups.final,
    })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.season, season)))
    .limit(MAX_SEASON_MATCHUPS);
  invariant(rows.length <= MAX_SEASON_MATCHUPS, 'season matchup count exceeded its bound');
  return rows;
}

// Conn-scoped kickoffs reader for currentTradeWeek — same query/bound as
// tradeQueries.fetchKickoffs (which is module-private there).
export async function fetchWeekKickoffs(
  conn: DbConn,
  season: number,
  week: number,
): Promise<ReadonlyMap<string, string>> {
  const rows = await conn
    .select({ nflTeam: nflGames.nflTeam, kickoff: nflGames.kickoff })
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week)))
    .limit(MAX_GAMES_PER_WEEK);
  invariant(rows.length <= MAX_GAMES_PER_WEEK, 'kickoffs query exceeded its bound');
  const kickoffs = new Map<string, string>();
  for (const row of rows) {
    kickoffs.set(row.nflTeam, row.kickoff.toISOString());
  }
  return kickoffs;
}
