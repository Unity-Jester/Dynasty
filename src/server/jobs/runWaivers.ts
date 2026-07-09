import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { rosterMembers, teams } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import type { LeagueSettings } from '@/engine/settings';
import { computeStandings } from '@/engine/standings';
import {
  resolveWaiverRun,
  type WaiverClaimInput,
  type WaiverDecision,
} from '@/engine/transactions/resolveWaiverRun';
import {
  parseTransactionPayload,
  type WaiverClaimPayload,
} from '@/engine/transactions/payloads';
import { currentTradeWeek } from '@/server/currentWeek';
import { clearDroppedLineupSlots } from '@/server/rosterCleanup';
import {
  fetchLeagueRostersByTeam,
  fetchLeagueTeamStates,
  fetchPendingWaiverClaims,
  fetchPendingWaiverLeagueIds,
  fetchSeasonMatchupResults,
  fetchWeekKickoffs,
  guardedWaiverStatus,
  loadWaiverSettings,
  resolveWaiverClaim,
  type DbConn,
  type PendingClaimRow,
  type WaiverTeamStateRow,
} from '@/server/waivers/waiverQueries';

// Per-run league ceiling (Rule 2/3); one error line per league at most.
const MAX_LEAGUES_PER_RUN = 50;
const MAX_TEAMS = 40;
const PG_UNIQUE_VIOLATION = '23505';

export type RunWaiversResult = {
  leaguesProcessed: number;
  awarded: number;
  rejected: number;
  skippedLeagues: number;
  errors: string[];
};

// Thrown inside a league's db.transaction to force a ROLLBACK carrying a typed
// reason. drizzle rethrows the original error, so throwing (never returning an
// error) is the ONLY way to abort — a returned value would COMMIT partial work.
class WaiverAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiverAbort';
  }
}

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function describeAbort(error: unknown): string {
  if (error instanceof WaiverAbort) {
    return error.message;
  }
  const code = pgErrorCode(error);
  if (code === PG_UNIQUE_VIOLATION) {
    // roster_members_league_player_uq fired: the awarded player was rostered
    // in this league between load and the apply tx (commish add, a racing run).
    // The engine serialized awards, so this is external drift — the whole
    // league rolls back and its claims stay pending for the next run.
    return 'conflict: a player was rostered concurrently (roster drift)';
  }
  if (code !== null) {
    return `database error (${code})`;
  }
  return error instanceof Error ? error.message : 'unknown error';
}

// ---- pure input construction ------------------------------------------------

type ParsedClaims = { claims: WaiverClaimInput[]; badRowIds: string[] };

// Parse each pending row's payload via parseTransactionPayload (never a cast).
// A row that no longer parses is quarantined as a bad row (rejected in the tx)
// rather than crashing the league run (engine contract, decision #9).
function parseClaims(rows: readonly PendingClaimRow[]): ParsedClaims {
  const claims: WaiverClaimInput[] = [];
  const badRowIds: string[] = [];
  for (const row of rows) {
    const parsed = parseTransactionPayload('waiver_claim', row.payload);
    if (!parsed.ok || parsed.value.kind !== 'waiver_claim') {
      badRowIds.push(row.id);
      continue;
    }
    const p = parsed.value;
    claims.push({
      transactionId: row.id,
      teamId: p.teamId,
      addPlayerId: p.addPlayerId,
      dropPlayerId: p.dropPlayerId,
      bid: p.bid,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return { claims, badRowIds };
}

// FAAB mode: every team's live balance, NULL lazy-initialized to the settings
// budget (persisted verbatim as newFaab in the tx). Priority mode: empty — the
// engine never consults faab there and the column stays NULL (decision #8).
function buildFaabMap(teamStates: readonly WaiverTeamStateRow[], settings: LeagueSettings): Map<string, number> {
  const map = new Map<string, number>();
  if (settings.waivers.mode !== 'faab') {
    return map;
  }
  const budget = settings.waivers.budget;
  for (const t of teamStates) {
    map.set(t.id, t.faabRemaining ?? budget);
  }
  return map;
}

// Every team's waiver priority. Existing (non-NULL) priorities are preserved;
// NULL teams are appended after the current max in creation order (the query's
// ORDER BY createdAt, id) — the deterministic lazy-init rule (decision #8).
function buildPriorityMap(teamStates: readonly WaiverTeamStateRow[]): Map<string, number> {
  let maxExisting = 0;
  for (const t of teamStates) {
    if (t.waiverPriority !== null) {
      maxExisting = Math.max(maxExisting, t.waiverPriority);
    }
  }
  const map = new Map<string, number>();
  let next = maxExisting;
  for (const t of teamStates) {
    if (t.waiverPriority !== null) {
      map.set(t.id, t.waiverPriority);
    } else {
      next += 1;
      map.set(t.id, next);
    }
  }
  return map;
}

// Rebuild the claim's payload with the engine's resolution attached — the
// parsed fields are exactly the payload's fields (plus optional resolution).
function buildResolvedPayload(claim: WaiverClaimInput, decision: WaiverDecision): WaiverClaimPayload {
  const resolution =
    decision.outcome === 'awarded'
      ? { outcome: 'awarded' as const }
      : { outcome: 'rejected' as const, reason: decision.reason };
  return {
    kind: 'waiver_claim',
    teamId: claim.teamId,
    addPlayerId: claim.addPlayerId,
    dropPlayerId: claim.dropPlayerId,
    bid: claim.bid,
    resolution,
  };
}

// ---- the apply transaction --------------------------------------------------

type ApplyContext = {
  leagueId: string;
  season: number;
  settings: LeagueSettings;
  decisions: readonly WaiverDecision[];
  claimById: ReadonlyMap<string, WaiverClaimInput>;
  badRowIds: readonly string[];
  newFaab: ReadonlyMap<string, number>;
  newPriority: ReadonlyMap<string, number>;
};

async function deriveCurrentWeek(conn: DbConn, season: number, settings: LeagueSettings, now: Date): Promise<number> {
  const lastRegularWeek = Math.max(1, settings.playoffs.startWeek - 1);
  return currentTradeWeek(lastRegularWeek, now, (w) => fetchWeekKickoffs(conn, season, w));
}

// Land an awarded add ('waiver'/'active'), guarded-delete the drop (a missing
// drop row = roster drift => abort), and null the dropped player's current+
// future lineup slots (lock-aware, via the shared cleanup). The add insert can
// raise 23505 (league-player uq) on drift — that rolls the whole league back.
async function applyAward(
  tx: DbConn,
  leagueId: string,
  season: number,
  currentWeek: number,
  now: Date,
  claim: WaiverClaimInput,
): Promise<void> {
  await tx
    .insert(rosterMembers)
    .values({ leagueId, teamId: claim.teamId, playerId: claim.addPlayerId, status: 'active', acquiredVia: 'waiver' });
  if (claim.dropPlayerId === null) {
    return;
  }
  const deleted = await tx
    .delete(rosterMembers)
    .where(
      and(
        eq(rosterMembers.leagueId, leagueId),
        eq(rosterMembers.playerId, claim.dropPlayerId),
        eq(rosterMembers.teamId, claim.teamId),
      ),
    )
    .returning({ id: rosterMembers.id });
  invariant(deleted.length <= 1, 'guarded drop delete touched more than one row');
  if (deleted.length !== 1) {
    throw new WaiverAbort(`drop ${claim.dropPlayerId} is no longer on the claiming roster`);
  }
  await clearDroppedLineupSlots(tx, {
    teamIds: [claim.teamId],
    droppedPlayerIds: [claim.dropPlayerId],
    currentSeason: season,
    currentWeek,
    now,
  });
}

// Apply one decision + its guarded pending->processed/rejected resolution. A
// lost resolution guard means the claim left 'pending' after load (a concurrent
// cancel) — abort so the award rolls back and the claim stays cancelled.
async function applyDecision(
  tx: DbConn,
  ctx: ApplyContext,
  currentWeek: number,
  now: Date,
  decision: WaiverDecision,
): Promise<void> {
  const claim = ctx.claimById.get(decision.transactionId);
  invariant(claim !== undefined, 'decision has no matching claim');
  if (decision.outcome === 'awarded') {
    await applyAward(tx, ctx.leagueId, ctx.season, currentWeek, now, claim);
  }
  const to = decision.outcome === 'awarded' ? 'processed' : 'rejected';
  const won = await resolveWaiverClaim(tx, claim.transactionId, to, buildResolvedPayload(claim, decision), now);
  if (!won) {
    throw new WaiverAbort(`claim ${claim.transactionId} left pending before resolution`);
  }
}

async function writeFaab(tx: DbConn, leagueId: string, newFaab: ReadonlyMap<string, number>): Promise<void> {
  invariant(newFaab.size <= MAX_TEAMS, 'faab write exceeded its bound');
  for (const [teamId, value] of newFaab) {
    invariant(value >= 0, 'refusing to persist a negative FAAB balance');
    const updated = await tx
      .update(teams)
      .set({ faabRemaining: value })
      .where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId)))
      .returning({ id: teams.id });
    invariant(updated.length === 1, 'faab update did not touch exactly one team');
  }
}

async function writePriority(tx: DbConn, leagueId: string, newPriority: ReadonlyMap<string, number>): Promise<void> {
  invariant(newPriority.size <= MAX_TEAMS, 'priority write exceeded its bound');
  for (const [teamId, value] of newPriority) {
    const updated = await tx
      .update(teams)
      .set({ waiverPriority: value })
      .where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId)))
      .returning({ id: teams.id });
    invariant(updated.length === 1, 'priority update did not touch exactly one team');
  }
}

// The whole apply for ONE league — all-or-nothing. Order: reject bad rows,
// apply every decision (awards + guarded resolutions), then persist the engine's
// newFaab (verbatim, all teams) and newPriority (verbatim; a 1..N renumber in
// rolling modes, otherwise the input echoed — which also persists lazy-init).
async function applyRunTx(tx: DbConn, ctx: ApplyContext): Promise<void> {
  const now = new Date();
  const currentWeek = await deriveCurrentWeek(tx, ctx.season, ctx.settings, now);

  for (const id of ctx.badRowIds) {
    const won = await guardedWaiverStatus(tx, id, 'pending', 'rejected', now);
    if (!won) {
      throw new WaiverAbort(`unparseable claim ${id} left pending before reject`);
    }
  }
  for (const decision of ctx.decisions) {
    await applyDecision(tx, ctx, currentWeek, now, decision);
  }
  await writeFaab(tx, ctx.leagueId, ctx.newFaab);
  await writePriority(tx, ctx.leagueId, ctx.newPriority);
}

// ---- per-league orchestration -----------------------------------------------

type LeagueRunOutcome =
  | { status: 'processed'; awarded: number; rejected: number }
  | { status: 'skipped'; error: string };

// Load (pooled) -> resolve (pure) -> apply (ONE tx). Loads happen outside the
// tx; the engine decides on that snapshot; the tx applies and is the final
// authority. Any load/engine failure or tx abort returns a 'skipped' outcome —
// the claims stay pending for the next run.
async function applyLeagueRun(leagueId: string): Promise<LeagueRunOutcome> {
  const db = getDb();
  const settingsResult = await loadWaiverSettings(db, leagueId);
  if (!settingsResult.ok) {
    return { status: 'skipped', error: `settings: ${settingsResult.error}` };
  }
  const { settings, year } = settingsResult;

  const { claims, badRowIds } = parseClaims(await fetchPendingWaiverClaims(db, leagueId));
  const teamStates = await fetchLeagueTeamStates(db, leagueId);
  const rosters = await fetchLeagueRostersByTeam(db, leagueId, teamStates.map((t) => t.id));
  const standings = computeStandings(await fetchSeasonMatchupResults(db, leagueId, year));
  if (!standings.ok) {
    return { status: 'skipped', error: `standings: ${standings.error}` };
  }

  const run = resolveWaiverRun({
    waivers: settings.waivers,
    claims,
    standings: standings.value,
    rosters,
    faabRemaining: buildFaabMap(teamStates, settings),
    waiverPriority: buildPriorityMap(teamStates),
    settings,
  });
  if (!run.ok) {
    return { status: 'skipped', error: `engine: ${run.error}` };
  }

  const { decisions, newFaab, newPriority } = run.value;
  const ctx: ApplyContext = {
    leagueId,
    season: year,
    settings,
    decisions,
    claimById: new Map(claims.map((c) => [c.transactionId, c])),
    badRowIds,
    newFaab,
    newPriority,
  };
  try {
    await db.transaction((tx) => applyRunTx(tx, ctx));
  } catch (error) {
    return { status: 'skipped', error: describeAbort(error) };
  }
  const awarded = decisions.filter((d) => d.outcome === 'awarded').length;
  // Rejected = engine rejections + quarantined unparseable rows (both closed).
  const rejected = decisions.length - awarded + badRowIds.length;
  return { status: 'processed', awarded, rejected };
}

function pushError(acc: RunWaiversResult, message: string): void {
  if (acc.errors.length < MAX_LEAGUES_PER_RUN) {
    acc.errors.push(message);
  }
}

// One league, fully isolated: applyLeagueRun already contains its own tx
// try/catch, but a load-phase throw (a bounded-read invariant, a DB outage)
// must ALSO be contained here so one bad league cannot poison the loop.
async function runOneLeague(acc: RunWaiversResult, leagueId: string): Promise<void> {
  let outcome: LeagueRunOutcome;
  try {
    outcome = await applyLeagueRun(leagueId);
  } catch (error) {
    acc.skippedLeagues += 1;
    pushError(acc, `${leagueId}: ${describeAbort(error)}`);
    return;
  }
  if (outcome.status === 'skipped') {
    acc.skippedLeagues += 1;
    pushError(acc, `${leagueId}: ${outcome.error}`);
    return;
  }
  acc.leaguesProcessed += 1;
  acc.awarded += outcome.awarded;
  acc.rejected += outcome.rejected;
}

/**
 * Resolves pending waiver claims. With a leagueId, runs just that league;
 * otherwise every league with pending claims (bounded MAX_LEAGUES_PER_RUN).
 * Each league is an isolated ONE-transaction apply of resolveWaiverRun's
 * decisions — awards, FAAB debits, priority rotation, and per-claim guarded
 * status resolutions. One league's failure is counted in skippedLeagues (with a
 * bounded error line) and never blocks the others.
 */
export async function runWaivers(leagueId?: string): Promise<RunWaiversResult> {
  const leagueIds = leagueId !== undefined ? [leagueId] : await fetchPendingWaiverLeagueIds(getDb());
  invariant(leagueIds.length <= MAX_LEAGUES_PER_RUN, 'run-waivers league count exceeded its bound');

  const acc: RunWaiversResult = { leaguesProcessed: 0, awarded: 0, rejected: 0, skippedLeagues: 0, errors: [] };
  for (const id of leagueIds) {
    await runOneLeague(acc, id);
  }
  invariant(
    acc.leaguesProcessed + acc.skippedLeagues === leagueIds.length,
    'every targeted league must be processed or skipped exactly once',
  );
  return acc;
}
