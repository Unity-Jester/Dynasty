import 'server-only';
import { count, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import {
  leagues, seasons, teams, rosterMembers, pickAssets, players,
} from '@/server/schema';
import {
  getLeague, getLeagueUsers, getLeagueRosters, getTradedPicks,
} from '@/lib/sleeper';
import { translateSettings } from '@/engine/import/translateSettings';
import { translateRosters, type TeamPlan } from '@/engine/import/translateRosters';
import { translatePicks, type PickPlan } from '@/engine/import/translatePicks';
import { generateInviteToken } from '@/engine/invites';
import type { LeagueSettings } from '@/engine/settings';
import { invariant } from '@/lib/invariant';
import { buildReport, LeagueNameSchema, type ImportReport } from './report';

export type { ImportReport } from './report';

// Bounded read of the player universe: only sleeperId is needed to build the
// known-id set the roster translator filters against. Cap matches the player
// sync's 30k ceiling (MAX_SLEEPER_PLAYERS).
const MAX_KNOWN_PLAYERS = 30000;
// Batched writes inside the execute transaction (Rule 2/3): 500 rows/statement,
// with named batch ceilings derived from the translators' own hard caps.
const BATCH_SIZE = 500;
// rosterMembers: ≤32 teams × ≤100 players = 3200 rows → 7 batches; 16 headroom.
const MAX_MEMBER_BATCHES = 16;
// pickAssets: ≤32 teams × 3 years × ≤10 rounds = 960 rows → 2 batches; 8 headroom.
const MAX_PICK_BATCHES = 8;
// currentSeason sanity window — a Sleeper league season outside this is corrupt.
const MIN_SEASON = 2020;
const MAX_SEASON = 2050;

// A dry-run's userId is never written; a fixed sentinel keeps the read-only
// path honest for callers (e.g. the verification script) that lack a real one.

export type ImportResult =
  | { ok: true; mode: 'dry_run'; report: ImportReport }
  | { ok: true; mode: 'execute'; leagueId: string; report: ImportReport }
  | {
      ok: false;
      error:
        | 'fetch_failed'
        | 'translate_settings'
        | 'translate_rosters'
        | 'translate_picks'
        | 'already_imported'
        | 'blocked'
        | 'db_error';
      detail: string;
    };

// ---- fetch phase ----------------------------------------------------------

type RawLeague = Awaited<ReturnType<typeof getLeague>>;

type FetchedPayloads = {
  rawLeague: RawLeague;
  rawUsers: Awaited<ReturnType<typeof getLeagueUsers>>;
  rawRosters: Awaited<ReturnType<typeof getLeagueRosters>>;
  rawTradedPicks: Awaited<ReturnType<typeof getTradedPicks>>;
  knownPlayerIds: Set<string>;
};

// Reads only players.sleeperId, bounded — the roster translator needs a Set of
// known ids to filter unknown players out of imported rosters.
async function fetchKnownPlayerIds(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ sleeperId: players.sleeperId })
    .from(players)
    .limit(MAX_KNOWN_PLAYERS);
  invariant(rows.length <= MAX_KNOWN_PLAYERS, 'player universe exceeds the bounded read');
  return new Set(rows.map((r) => r.sleeperId));
}

// Fetches all four Sleeper payloads plus the player universe. Any endpoint
// failure surfaces as fetch_failed naming which call threw (the fetchers throw
// on non-OK), so the caller never proceeds on partial data.
async function fetchAll(
  sleeperLeagueId: string,
): Promise<{ ok: true; value: FetchedPayloads } | { ok: false; endpoint: string }> {
  try {
    const rawLeague = await getLeague(sleeperLeagueId);
    const rawUsers = await getLeagueUsers(sleeperLeagueId);
    const rawRosters = await getLeagueRosters(sleeperLeagueId);
    const rawTradedPicks = await getTradedPicks(sleeperLeagueId);
    const knownPlayerIds = await fetchKnownPlayerIds();
    return { ok: true, value: { rawLeague, rawUsers, rawRosters, rawTradedPicks, knownPlayerIds } };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown fetch error';
    return { ok: false, endpoint: detail };
  }
}

// ---- translate phase ------------------------------------------------------

type TranslatedPlan = {
  settings: LeagueSettings;
  settingsWarnings: string[];
  teams: TeamPlan[];
  rosterWarnings: string[];
  picks: PickPlan[];
  pickWarnings: string[];
  currentSeason: number;
};

// Adds the raw Sleeper league name (validated at execute time) to a plan, so
// the execute path has everything it needs without re-threading raw payloads.
type PlanWithName = TranslatedPlan & { leagueNameRaw: string };

type TranslateFailure = {
  error: 'translate_settings' | 'translate_rosters' | 'translate_picks';
  detail: string;
};

// Runs the three translators in order (settings → rosters → picks); the first
// failure short-circuits to its matching error variant. currentSeason is the
// raw league's season, asserted to a sane integer window before it seeds picks.
function translateAll(
  payloads: FetchedPayloads,
): { ok: true; value: TranslatedPlan } | { ok: false; failure: TranslateFailure } {
  const settingsResult = translateSettings(payloads.rawLeague);
  if (!settingsResult.ok) {
    return { ok: false, failure: { error: 'translate_settings', detail: settingsResult.error } };
  }
  const { settings } = settingsResult.value;

  const rostersResult = translateRosters(
    { rosters: payloads.rawRosters, users: payloads.rawUsers },
    { knownPlayerIds: payloads.knownPlayerIds, settings },
  );
  if (!rostersResult.ok) {
    return { ok: false, failure: { error: 'translate_rosters', detail: rostersResult.error } };
  }
  const { teams: teamPlans } = rostersResult.value;

  const currentSeason = Number(payloads.rawLeague.season);
  invariant(Number.isInteger(currentSeason), 'league season is not an integer');
  invariant(
    currentSeason >= MIN_SEASON && currentSeason <= MAX_SEASON,
    'league season is outside the sane window',
  );

  const picksResult = translatePicks(
    { tradedPicks: payloads.rawTradedPicks },
    { rosterIds: teamPlans.map((t) => t.rosterId), currentSeason },
  );
  if (!picksResult.ok) {
    return { ok: false, failure: { error: 'translate_picks', detail: picksResult.error } };
  }

  return {
    ok: true,
    value: {
      settings,
      settingsWarnings: settingsResult.value.warnings,
      teams: teamPlans,
      rosterWarnings: rostersResult.value.warnings,
      picks: picksResult.value.picks,
      pickWarnings: picksResult.value.warnings,
      currentSeason,
    },
  };
}

// ---- blockers -------------------------------------------------------------

// Bounded existence check: has this Sleeper league already been imported? The
// partial unique index makes re-import a DB-level impossibility, but a
// pre-write blocker gives the commissioner a clean message before execute.
async function isAlreadyImported(sleeperLeagueId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(leagues)
    .where(eq(leagues.sleeperLeagueId, sleeperLeagueId))
    .limit(1);
  return (row?.value ?? 0) > 0;
}

async function computeBlockers(
  sleeperLeagueId: string,
  knownPlayerIds: ReadonlySet<string>,
): Promise<string[]> {
  const blockers: string[] = [];
  if (await isAlreadyImported(sleeperLeagueId)) {
    blockers.push('This Sleeper league was already imported');
  }
  if (knownPlayerIds.size === 0) {
    blockers.push('Player universe is empty — run the player sync first');
  }
  return blockers;
}

// ---- execute transaction --------------------------------------------------

const PG_UNIQUE_VIOLATION = '23505';
const SLEEPER_UNIQUE_INDEX = 'leagues_sleeper_league_uq';

function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

// True when a DB error is the 23505 raised specifically by the sleeper-league
// partial unique index — i.e. a concurrent import won the race. Other 23505s
// (e.g. roster_members_league_player_uq) are genuine bugs and must not be
// silently mapped to already_imported.
function isSleeperDuplicate(error: unknown): boolean {
  if (pgErrorCode(error) !== PG_UNIQUE_VIOLATION) return false;
  const constraint = error && typeof error === 'object' && 'constraint_name' in error
    ? (error as { constraint_name?: unknown }).constraint_name
    : undefined;
  return typeof constraint !== 'string' || constraint === SLEEPER_UNIQUE_INDEX;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

// Inserts league + season, returns the new league id. Split out so the
// transaction body stays under the line cap.
async function insertLeagueAndSeason(
  tx: Tx,
  name: string,
  sleeperLeagueId: string,
  userId: string,
  plan: TranslatedPlan,
): Promise<string> {
  const [league] = await tx
    .insert(leagues)
    .values({ name, status: 'setup', createdBy: userId, sleeperLeagueId })
    .returning({ id: leagues.id });
  invariant(league, 'league insert returned no row');
  await tx.insert(seasons).values({
    leagueId: league.id,
    year: plan.currentSeason,
    phase: 'offseason',
    settings: plan.settings,
  });
  return league.id;
}

// Inserts one team per TeamPlan and returns a rosterId → new teamId map. Every
// team gets a fresh single-use invite token (same idiom as createLeague).
async function insertTeams(
  tx: Tx,
  leagueId: string,
  plans: readonly TeamPlan[],
): Promise<Map<number, string>> {
  const rows = plans.map((plan) => ({
    leagueId,
    name: plan.name,
    inviteToken: generateInviteToken(),
  }));
  const inserted = await tx.insert(teams).values(rows).returning({ id: teams.id });
  invariant(inserted.length === plans.length, 'team insert count mismatch');

  const rosterToTeam = new Map<number, string>();
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    const teamRow = inserted[i];
    invariant(plan !== undefined && teamRow !== undefined, 'team row vanished mid-map');
    rosterToTeam.set(plan.rosterId, teamRow.id);
  }
  invariant(rosterToTeam.size === plans.length, 'roster→team map size mismatch');
  return rosterToTeam;
}

type MemberRow = {
  leagueId: string;
  teamId: string;
  playerId: string;
  status: 'active' | 'taxi' | 'ir';
  acquiredVia: 'import';
};

// Flattens all TeamPlans into rosterMember rows, resolving each rosterId to its
// team id through the map (invariant: every rosterId maps).
function flattenMembers(
  leagueId: string,
  plans: readonly TeamPlan[],
  rosterToTeam: ReadonlyMap<number, string>,
): MemberRow[] {
  const rows: MemberRow[] = [];
  for (const plan of plans) {
    const teamId = rosterToTeam.get(plan.rosterId);
    invariant(teamId !== undefined, 'roster member references an unmapped rosterId');
    for (const member of plan.members) {
      rows.push({ leagueId, teamId, playerId: member.playerId, status: member.status, acquiredVia: 'import' });
    }
  }
  return rows;
}

// Bounded batched insert of rosterMembers; returns the count actually inserted
// so the caller can assert it against the flattened plan length.
async function insertMembers(tx: Tx, rows: readonly MemberRow[]): Promise<number> {
  const batchCount = Math.ceil(rows.length / BATCH_SIZE);
  invariant(batchCount <= MAX_MEMBER_BATCHES, 'roster member batches exceed MAX_MEMBER_BATCHES');
  let inserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    await tx.insert(rosterMembers).values(batch);
    inserted += batch.length;
  }
  return inserted;
}

type PickRow = {
  leagueId: string;
  season: number;
  round: number;
  originalTeamId: string;
  currentTeamId: string;
};

// Maps PickPlans (roster ids) into pickAsset rows (team ids), resolving both
// original and current owners through the map (invariant: every id maps).
function mapPicks(
  leagueId: string,
  picks: readonly PickPlan[],
  rosterToTeam: ReadonlyMap<number, string>,
): PickRow[] {
  const rows: PickRow[] = [];
  for (const pick of picks) {
    const originalTeamId = rosterToTeam.get(pick.originalRosterId);
    const currentTeamId = rosterToTeam.get(pick.currentRosterId);
    invariant(originalTeamId !== undefined, 'pick references an unmapped original rosterId');
    invariant(currentTeamId !== undefined, 'pick references an unmapped current rosterId');
    rows.push({ leagueId, season: pick.season, round: pick.round, originalTeamId, currentTeamId });
  }
  return rows;
}

async function insertPicks(tx: Tx, rows: readonly PickRow[]): Promise<number> {
  const batchCount = Math.ceil(rows.length / BATCH_SIZE);
  invariant(batchCount <= MAX_PICK_BATCHES, 'pick asset batches exceed MAX_PICK_BATCHES');
  let inserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    await tx.insert(pickAssets).values(batch);
    inserted += batch.length;
  }
  return inserted;
}

// Runs the whole write in ONE transaction. Post-insert invariants (inside the
// transaction so a violation rolls everything back) prove the persisted counts
// match the plan. Never includes connection strings/secrets in error detail.
async function executeImport(
  sleeperLeagueId: string,
  userId: string,
  plan: PlanWithName,
): Promise<{ ok: true; leagueId: string } | { ok: false; result: ImportResult }> {
  try {
    const name = LeagueNameSchema.parse(plan.leagueNameRaw);
    const leagueId = await getDb().transaction(async (tx) => {
      const id = await insertLeagueAndSeason(tx, name, sleeperLeagueId, userId, plan);
      const rosterToTeam = await insertTeams(tx, id, plan.teams);

      const memberRows = flattenMembers(id, plan.teams, rosterToTeam);
      const membersInserted = await insertMembers(tx, memberRows);
      invariant(membersInserted === memberRows.length, 'roster member insert count mismatch');

      const pickRows = mapPicks(id, plan.picks, rosterToTeam);
      const picksInserted = await insertPicks(tx, pickRows);
      invariant(picksInserted === plan.picks.length, 'pick asset insert count mismatch');
      return id;
    });
    return { ok: true, leagueId };
  } catch (error) {
    return { ok: false, result: mapExecuteError(error) };
  }
}

function mapExecuteError(error: unknown): ImportResult {
  if (isSleeperDuplicate(error)) {
    return { ok: false, error: 'already_imported', detail: 'This Sleeper league was already imported' };
  }
  const code = pgErrorCode(error);
  const detail = code ? `database error (${code})` : 'database error';
  return { ok: false, error: 'db_error', detail };
}

// ---- orchestrator ---------------------------------------------------------

/**
 * Fetches, translates, and (in execute mode) persists a Sleeper league import.
 *
 * Execute re-runs the ENTIRE pipeline fresh — it re-fetches from Sleeper and
 * re-translates rather than trusting any report a prior dry-run showed the
 * commissioner. The dry-run report is advisory UI only; the write is derived
 * solely from data fetched within this same call.
 */
export async function runSleeperImport(
  sleeperLeagueId: string,
  mode: 'dry_run' | 'execute',
  userId: string,
): Promise<ImportResult> {
  invariant(sleeperLeagueId.length > 0, 'runSleeperImport requires a sleeperLeagueId');
  invariant(userId.length > 0, 'runSleeperImport requires a userId');

  const fetched = await fetchAll(sleeperLeagueId);
  if (!fetched.ok) {
    return { ok: false, error: 'fetch_failed', detail: fetched.endpoint };
  }

  const translated = translateAll(fetched.value);
  if (!translated.ok) {
    return { ok: false, error: translated.failure.error, detail: translated.failure.detail };
  }
  const plan: PlanWithName = {
    ...translated.value,
    leagueNameRaw: fetched.value.rawLeague.name,
  };

  const blockers = await computeBlockers(sleeperLeagueId, fetched.value.knownPlayerIds);
  const report = buildReport({
    leagueName: plan.leagueNameRaw,
    season: plan.currentSeason,
    teams: plan.teams,
    picks: plan.picks,
    settingsWarnings: plan.settingsWarnings,
    rosterWarnings: plan.rosterWarnings,
    pickWarnings: plan.pickWarnings,
    blockers,
  });

  if (mode === 'dry_run') {
    return { ok: true, mode: 'dry_run', report };
  }

  // Execute must not proceed with any blocker — the path is unreachable with a
  // nonempty blockers list.
  if (blockers.length > 0) {
    return { ok: false, error: 'blocked', detail: blockers.join('; ') };
  }

  const executed = await executeImport(sleeperLeagueId, userId, plan);
  if (!executed.ok) {
    return executed.result;
  }
  return { ok: true, mode: 'execute', leagueId: executed.leagueId, report };
}
