import 'server-only';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, nflGames, pickAssets, players, rosterMembers, seasons, teams, transactions } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import type { RosterMemberShape } from '@/engine/roster';
import type { TradePayload } from '@/engine/transactions/payloads';
import type { TradePickShape, TradeValidationInput } from '@/engine/transactions/validateTrade';
import { currentTradeWeek } from '@/server/currentWeek';

// Every reader here takes a DbConn so the SAME code path serves both the
// pooled client (propose/accept-time reads) and an open transaction
// (execute-time reads — the final authority). This matters doubly because the
// pool is max:1 (db.ts): a getDb() query issued while a transaction holds the
// connection would deadlock, so in-transaction code MUST read through tx.
export type Db = ReturnType<typeof getDb>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbConn = Db | DbTx;

// Roster members per team are bounded by league roster-slot totals; 100 is
// generous headroom, mirroring lineup.ts (Rule 3).
const MAX_ROSTER = 100;
// A team's own pick base is ≤ 3 years × ≤ 10 rounds = 30; even a hoarder
// holding half a 32-team league's picks stays under 200 (Rule 3).
const MAX_PICKS_PER_TEAM = 200;
// One NFL week has ≤ 32 team-rows in nfl_games; 40 mirrors locks.ts.
const MAX_GAMES_PER_WEEK = 40;

export type TransactionStatus = (typeof transactions.$inferSelect)['status'];

export type TradeTeamRow = { id: string; leagueId: string; ownerId: string | null };
export type TradeLeagueRow = { id: string; createdBy: string };
export type TradeSeasonRow = { year: number; settings: unknown };
export type TradeTransactionRow = {
  id: string;
  leagueId: string;
  status: TransactionStatus;
  payload: unknown;
  createdBy: string;
};

export async function fetchTeamRow(conn: DbConn, teamId: string): Promise<TradeTeamRow | null> {
  const [row] = await conn
    .select({ id: teams.id, leagueId: teams.leagueId, ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export async function fetchLeagueRow(conn: DbConn, leagueId: string): Promise<TradeLeagueRow | null> {
  const [row] = await conn
    .select({ id: leagues.id, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

// "Current" season = highest year; mirrors lineup.ts/scoreWeek.ts — do not
// invent a second source of truth for which season is live.
async function fetchLatestSeasonRow(conn: DbConn, leagueId: string): Promise<TradeSeasonRow | null> {
  const [row] = await conn
    .select({ year: seasons.year, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

// Exported for reuse by commish.ts's force-add capacity check (Phase 7 Task
// 8) — same bounded (league roster-slot totals) per-team roster read used by
// trade validation, no reason for a third copy.
export async function fetchRosterShapes(conn: DbConn, teamId: string): Promise<RosterMemberShape[]> {
  const rows = await conn
    .select({ playerId: rosterMembers.playerId, status: rosterMembers.status })
    .from(rosterMembers)
    .where(eq(rosterMembers.teamId, teamId))
    .limit(MAX_ROSTER);
  invariant(rows.length <= MAX_ROSTER, 'roster member query exceeded its bound');
  return rows;
}

async function fetchTeamPickShapes(
  conn: DbConn,
  leagueId: string,
  teamId: string,
): Promise<TradePickShape[]> {
  const rows = await conn
    .select({ id: pickAssets.id, season: pickAssets.season })
    .from(pickAssets)
    .where(and(eq(pickAssets.leagueId, leagueId), eq(pickAssets.currentTeamId, teamId)))
    .limit(MAX_PICKS_PER_TEAM);
  invariant(rows.length <= MAX_PICKS_PER_TEAM, 'pick asset query exceeded its bound');
  return rows;
}

// Conn-scoped twin of locks.ts getKickoffs (which is hard-wired to the pooled
// client) so the current-week scan works inside a transaction too.
async function fetchKickoffs(
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

// Conn-scoped twin of locks.ts getLockedNflTeams (hard-wired to the pooled
// client, so structurally unusable inside a transaction with max:1 pooling).
// Same query shape and bound: NFL team codes whose (season, week) game has
// already kicked off as of `now`.
export async function fetchLockedNflTeams(
  conn: DbConn,
  season: number,
  week: number,
  now: Date,
): Promise<ReadonlySet<string>> {
  invariant(!Number.isNaN(now.getTime()), 'now is an invalid Date');
  const rows = await conn
    .select({ nflTeam: nflGames.nflTeam })
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week), lte(nflGames.kickoff, now)))
    .limit(MAX_GAMES_PER_WEEK);
  invariant(rows.length <= MAX_GAMES_PER_WEEK, 'locked-team query exceeded its bound');
  const locked = new Set<string>();
  for (const row of rows) {
    locked.add(row.nflTeam);
  }
  return locked;
}

// Bound mirrors the trade payload cap (15 players per side; see payloads.ts).
const MAX_PLAYER_LOOKUP = 30;

/** playerId -> nflTeam (null = free agent) for the given players. Locks are
 *  keyed by NFL team while lineup slots store player ids; this is the join. */
export async function fetchPlayerNflTeams(
  conn: DbConn,
  playerIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  invariant(playerIds.length <= MAX_PLAYER_LOOKUP, 'player lookup exceeded its bound');
  const byId = new Map<string, string | null>();
  if (playerIds.length === 0) {
    return byId;
  }
  const rows = await conn
    .select({ id: players.sleeperId, nflTeam: players.nflTeam })
    .from(players)
    .where(inArray(players.sleeperId, [...playerIds]))
    .limit(MAX_PLAYER_LOOKUP);
  invariant(rows.length <= MAX_PLAYER_LOOKUP, 'player lookup result exceeded its bound');
  for (const row of rows) {
    byId.set(row.id, row.nflTeam);
  }
  return byId;
}

export async function fetchTradeTransaction(
  conn: DbConn,
  transactionId: string,
): Promise<TradeTransactionRow | null> {
  const [row] = await conn
    .select({
      id: transactions.id,
      leagueId: transactions.leagueId,
      status: transactions.status,
      payload: transactions.payload,
      createdBy: transactions.createdBy,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.type, 'trade')))
    .limit(1);
  return row ?? null;
}

/**
 * Guarded status transition — THE race idiom (plan decision #11): UPDATE only
 * where the status is still what the caller believes; a lost race matches
 * zero rows and returns false, never silently overwrites. Pass resolvedAt for
 * terminal states (processed/rejected/cancelled/vetoed).
 */
export async function guardedTradeStatus(
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
    .where(and(eq(transactions.id, transactionId), eq(transactions.status, from)))
    .returning({ id: transactions.id });
  invariant(updated.length <= 1, 'guarded status update touched more than one row');
  return updated.length === 1;
}

export type TradeContext = {
  settings: LeagueSettings;
  currentSeason: number;
  currentWeek: number;
  proposingRoster: RosterMemberShape[];
  counterpartyRoster: RosterMemberShape[];
  proposingPicks: TradePickShape[];
  counterpartyPicks: TradePickShape[];
};

export type LoadTradeContextResult =
  | { ok: true; context: TradeContext }
  | { ok: false; error: 'not_found' | 'invalid_settings'; detail?: string };

/**
 * Everything validateTradeProposal needs, read through `conn` so execute-time
 * callers get in-transaction (final-authority) reads and propose/accept-time
 * callers get pooled reads. Sequential awaits on purpose: with max:1 pooling
 * the statements share one connection anyway, and inside a transaction they
 * MUST be sequential.
 */
export async function loadTradeContext(
  conn: DbConn,
  leagueId: string,
  payload: TradePayload,
  now: Date,
): Promise<LoadTradeContextResult> {
  const proposingTeam = await fetchTeamRow(conn, payload.proposingTeamId);
  const counterpartyTeam = await fetchTeamRow(conn, payload.counterpartyTeamId);
  if (!proposingTeam || !counterpartyTeam) {
    return { ok: false, error: 'not_found' };
  }
  // proposeTrade only writes payloads whose teams share the transaction's
  // league, and teams have no delete/move path — a mismatch here means the
  // ledger drifted from the teams table: impossible state, not an error.
  invariant(
    proposingTeam.leagueId === leagueId && counterpartyTeam.leagueId === leagueId,
    'trade payload references a team outside the transaction league',
  );

  const season = await fetchLatestSeasonRow(conn, leagueId);
  if (!season) {
    return { ok: false, error: 'not_found' };
  }
  const parsedSettings = LeagueSettingsSchema.safeParse(season.settings);
  if (!parsedSettings.success) {
    return { ok: false, error: 'invalid_settings', detail: firstZodIssueMessage(parsedSettings.error) };
  }
  const settings = parsedSettings.data;

  const lastRegularWeek = Math.max(1, settings.playoffs.startWeek - 1);
  const currentWeek = await currentTradeWeek(lastRegularWeek, now, (w) =>
    fetchKickoffs(conn, season.year, w),
  );

  const proposingRoster = await fetchRosterShapes(conn, payload.proposingTeamId);
  const counterpartyRoster = await fetchRosterShapes(conn, payload.counterpartyTeamId);
  const proposingPicks = await fetchTeamPickShapes(conn, leagueId, payload.proposingTeamId);
  const counterpartyPicks = await fetchTeamPickShapes(conn, leagueId, payload.counterpartyTeamId);

  return {
    ok: true,
    context: {
      settings,
      currentSeason: season.year,
      currentWeek,
      proposingRoster,
      counterpartyRoster,
      proposingPicks,
      counterpartyPicks,
    },
  };
}

/** Adapter from a loaded context to the engine's input shape. */
export function toValidationInput(payload: TradePayload, context: TradeContext): TradeValidationInput {
  return {
    payload,
    proposingRoster: context.proposingRoster,
    counterpartyRoster: context.counterpartyRoster,
    proposingPicks: context.proposingPicks,
    counterpartyPicks: context.counterpartyPicks,
    settings: context.settings,
    currentSeason: context.currentSeason,
    currentWeek: context.currentWeek,
    // Reserved by the engine's input contract; trades are capacity-only today.
    playerPositions: new Map<string, string>(),
  };
}
