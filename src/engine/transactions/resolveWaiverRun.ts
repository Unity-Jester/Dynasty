import { invariant } from '../../lib/invariant';
import type { LeagueSettings } from '../settings';
import type { Standing } from '../standings';
import type { RosterMemberShape } from '../roster';
import { validateRosterCounts } from '../roster';

// A single waiver run processes at most this many claims (Rule 2/3). A real
// weekly run in a 32-team league is well under this; exceeding it is a bug
// upstream (unbounded fan-in), not a normal error path.
const MAX_CLAIMS = 200;
// Sanity bound on distinct teams appearing across the input maps/rosters.
const MAX_TEAMS = 40;

export interface WaiverClaimInput {
  readonly transactionId: string;
  readonly teamId: string;
  readonly addPlayerId: string;
  readonly dropPlayerId: string | null;
  /** Non-null only in FAAB mode (submitClaim enforces bid iff FAAB). */
  readonly bid: number | null;
  /** ISO-8601 timestamp; lexicographic order == chronological order. */
  readonly createdAt: string;
}

export type WaiverDecisionReason =
  | 'outbid'
  | 'player_taken'
  | 'insufficient_funds'
  | 'roster_full'
  | 'invalid_drop';

export interface WaiverDecision {
  readonly transactionId: string;
  readonly outcome: 'awarded' | 'rejected';
  readonly reason?: WaiverDecisionReason;
}

export interface ResolveWaiverRunInput {
  readonly waivers: LeagueSettings['waivers'];
  readonly claims: readonly WaiverClaimInput[];
  /** Season standings; EMPTY in preseason (no final matchups). */
  readonly standings: readonly Standing[];
  readonly rosters: ReadonlyMap<string, readonly RosterMemberShape[]>;
  readonly faabRemaining: ReadonlyMap<string, number>;
  /** teamId -> priority number; LOWER number = earlier pick. */
  readonly waiverPriority: ReadonlyMap<string, number>;
  readonly settings: LeagueSettings;
}

export interface WaiverRunResult {
  readonly decisions: WaiverDecision[];
  readonly newFaab: Map<string, number>;
  readonly newPriority: Map<string, number>;
}

export type ResolveWaiverRunResult =
  | { ok: true; value: WaiverRunResult }
  | { ok: false; error: string };

// Mutable simulation state threaded through processing. Rosters, budgets and the
// rolling priority queue all mutate AS awards land, so a team's later claim sees
// the state its earlier awards produced (decision #9).
interface RunContext {
  readonly mode: 'faab' | 'priority';
  readonly isRolling: boolean;
  /** true when the tiebreak uses priority order: rolling, OR reverse_standings with no standings. */
  readonly tiebreakByPriority: boolean;
  readonly settings: LeagueSettings;
  readonly standingsRank: Map<string, Standing>;
  readonly rosters: Map<string, RosterMemberShape[]>;
  /**
   * Player ids on ANY roster at RUN START — a frozen snapshot, never mutated.
   * A run-start-rostered player is unclaimable for the ENTIRE run, even if a
   * mid-run award drops him: dropped players go on waivers for the NEXT run
   * (decision #7 — unclaimed players remain claimable next run), never straight
   * to a same-run claim (that would be a disguised instant free-agent add).
   */
  readonly rosteredAtStart: ReadonlySet<string>;
  /** For players awarded THIS run: the winning bid (null in priority mode). */
  readonly awardedBid: Map<string, number | null>;
  readonly faab: Map<string, number>;
  /** Teams ordered best-first; mutated (winner -> back) on award in rolling mode. */
  readonly priorityQueue: string[];
}

// ---- lookups (assert the input contract exactly where it is consulted) ------

function membersOf(ctx: RunContext, teamId: string): RosterMemberShape[] {
  const members = ctx.rosters.get(teamId);
  invariant(members !== undefined, `claiming team ${teamId} has no roster entry`);
  return members;
}

function faabOf(ctx: RunContext, teamId: string): number {
  const remaining = ctx.faab.get(teamId);
  invariant(remaining !== undefined, `FAAB claim team ${teamId} has no budget entry`);
  return remaining;
}

function priorityRankOf(ctx: RunContext, teamId: string): number {
  const idx = ctx.priorityQueue.indexOf(teamId);
  invariant(idx >= 0, `claiming team ${teamId} has no waiver priority entry`);
  return idx;
}

// ---- ordering ---------------------------------------------------------------

// reverse_standings: the WORSE team wins. "Worse" mirrors the app's standings
// sort (wins desc -> pointsFor desc) reversed: fewer wins first, then fewer
// pointsFor. A team missing from non-empty standings is treated as 0/0 (worst).
function reverseStandingsCompare(ctx: RunContext, a: WaiverClaimInput, b: WaiverClaimInput): number {
  const sa = ctx.standingsRank.get(a.teamId);
  const sb = ctx.standingsRank.get(b.teamId);
  const aw = sa?.wins ?? 0;
  const bw = sb?.wins ?? 0;
  if (aw !== bw) return aw - bw; // fewer wins => worse => earlier
  const apf = sa?.pointsFor ?? 0;
  const bpf = sb?.pointsFor ?? 0;
  return apf - bpf; // fewer points => worse => earlier
}

function tiebreakCompare(ctx: RunContext, a: WaiverClaimInput, b: WaiverClaimInput): number {
  if (ctx.tiebreakByPriority) {
    return priorityRankOf(ctx, a.teamId) - priorityRankOf(ctx, b.teamId);
  }
  return reverseStandingsCompare(ctx, a, b);
}

// Total order over distinct claims. FAAB: bid desc -> tiebreak -> createdAt asc
// -> transactionId asc. Priority: tiebreak -> createdAt asc -> transactionId asc.
// The transactionId tail makes the order STRICT (no residual ties) => determinism.
function compareClaims(ctx: RunContext, a: WaiverClaimInput, b: WaiverClaimInput): number {
  if (ctx.mode === 'faab') {
    // bids are non-null in FAAB (validated at the boundary before processing).
    const bidDiff = (b.bid ?? 0) - (a.bid ?? 0);
    if (bidDiff !== 0) return bidDiff;
  }
  const tb = tiebreakCompare(ctx, a, b);
  if (tb !== 0) return tb;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0;
}

// Selection-sort step: the single best remaining claim under the CURRENT (possibly
// rotated) ordering. Independent of Set iteration order because compareClaims is
// strict-total, so the minimum is unique.
function selectNextClaim(remaining: ReadonlySet<WaiverClaimInput>, ctx: RunContext): WaiverClaimInput | null {
  let best: WaiverClaimInput | null = null;
  for (const c of remaining) {
    if (best === null || compareClaims(ctx, c, best) < 0) best = c;
  }
  return best;
}

// ---- per-claim state machine ------------------------------------------------

// A run-start-rostered player has no awardedBid entry, so such a claim can
// never be 'outbid' — there is no winning bid to be beaten by; it is always
// 'player_taken' (the player was taken/rostered when the run began).
function reasonForTaken(ctx: RunContext, claim: WaiverClaimInput): WaiverDecisionReason {
  if (ctx.mode === 'faab') {
    const winBid = ctx.awardedBid.get(claim.addPlayerId);
    // Strictly-higher winning bid => outbid; equal bid or non-award drift => player_taken.
    if (winBid !== undefined && winBid !== null && claim.bid !== null && winBid > claim.bid) {
      return 'outbid';
    }
  }
  return 'player_taken';
}

function postRosterFor(ctx: RunContext, claim: WaiverClaimInput): RosterMemberShape[] {
  const members = membersOf(ctx, claim.teamId);
  const afterDrop =
    claim.dropPlayerId !== null ? members.filter((m) => m.playerId !== claim.dropPlayerId) : members;
  return [...afterDrop, { playerId: claim.addPlayerId, status: 'active' }];
}

// Note: a mid-run drop mutates ONLY the team's member list (freeing capacity
// for that team's later claims). It does NOT make the dropped player claimable
// — availability is rosteredAtStart + awardedBid, and neither shrinks.
function commitAward(ctx: RunContext, claim: WaiverClaimInput, post: RosterMemberShape[]): void {
  ctx.rosters.set(claim.teamId, post);
  ctx.awardedBid.set(claim.addPlayerId, ctx.mode === 'faab' ? claim.bid : null);
  if (ctx.mode === 'faab' && claim.bid !== null) {
    const next = faabOf(ctx, claim.teamId) - claim.bid;
    invariant(next >= 0, `award drove ${claim.teamId} FAAB below zero`);
    ctx.faab.set(claim.teamId, next);
  }
  if (ctx.isRolling) {
    const idx = priorityRankOf(ctx, claim.teamId);
    ctx.priorityQueue.splice(idx, 1);
    ctx.priorityQueue.push(claim.teamId);
  }
}

// Decision precedence maps 1:1 onto decision #9's ordered steps:
//   1. drop must be applicable            -> invalid_drop
//   2. bid must be affordable (FAAB)      -> insufficient_funds
//   3. add player must still be available -> player_taken / outbid
//   4. post-swap roster must fit          -> roster_full
// then award: pay bid, land player 'active', rolling rotate winner to back.
function processClaim(ctx: RunContext, claim: WaiverClaimInput): WaiverDecision {
  const reject = (reason: WaiverDecisionReason): WaiverDecision => ({
    transactionId: claim.transactionId,
    outcome: 'rejected',
    reason,
  });

  if (claim.dropPlayerId !== null && !membersOf(ctx, claim.teamId).some((m) => m.playerId === claim.dropPlayerId)) {
    return reject('invalid_drop');
  }
  if (ctx.mode === 'faab' && claim.bid !== null && claim.bid > faabOf(ctx, claim.teamId)) {
    return reject('insufficient_funds');
  }
  // Unavailable = rostered anywhere at run start OR already awarded this run.
  // A run-start snapshot (not the live rosters) so a mid-run drop cannot make
  // its player instantly claimable — see RunContext.rosteredAtStart.
  if (ctx.rosteredAtStart.has(claim.addPlayerId) || ctx.awardedBid.has(claim.addPlayerId)) {
    return reject(reasonForTaken(ctx, claim));
  }
  const post = postRosterFor(ctx, claim);
  if (!validateRosterCounts(ctx.settings, post).ok) {
    return reject('roster_full');
  }
  commitAward(ctx, claim, post);
  return { transactionId: claim.transactionId, outcome: 'awarded' };
}

// ---- context construction & output --------------------------------------

function buildContext(input: ResolveWaiverRunInput): RunContext {
  const { waivers, standings } = input;
  const isRolling =
    (waivers.mode === 'faab' && waivers.tiebreaker === 'rolling') ||
    (waivers.mode === 'priority' && waivers.order === 'rolling');
  const configOrder = waivers.mode === 'faab' ? waivers.tiebreaker : waivers.order;
  const tiebreakByPriority =
    isRolling || (configOrder === 'reverse_standings' && standings.length === 0);

  invariant(input.rosters.size <= MAX_TEAMS, `roster map has ${input.rosters.size} teams, over ${MAX_TEAMS}`);
  const rosters = new Map<string, RosterMemberShape[]>();
  const rosteredAtStart = new Set<string>();
  for (const [teamId, members] of input.rosters) {
    rosters.set(teamId, [...members]);
    for (const m of members) rosteredAtStart.add(m.playerId);
  }

  const priorityQueue = [...input.waiverPriority.keys()].sort((a, b) => {
    const pa = input.waiverPriority.get(a);
    const pb = input.waiverPriority.get(b);
    invariant(pa !== undefined && pb !== undefined, 'priority key vanished during sort');
    if (pa !== pb) return pa - pb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return {
    mode: waivers.mode,
    isRolling,
    tiebreakByPriority,
    settings: input.settings,
    standingsRank: new Map(standings.map((s) => [s.teamId, s])),
    rosters,
    rosteredAtStart,
    awardedBid: new Map<string, number | null>(),
    faab: new Map(input.faabRemaining),
    priorityQueue,
  };
}

// newPriority: in rolling mode, renumber 1..N by the FINAL (rotated) queue order;
// otherwise no rotation happened, so echo the input untouched. Both cover every
// team present in the input priority map.
function buildNewPriority(input: ResolveWaiverRunInput, ctx: RunContext): Map<string, number> {
  if (!ctx.isRolling) return new Map(input.waiverPriority);
  const out = new Map<string, number>();
  ctx.priorityQueue.forEach((teamId, idx) => out.set(teamId, idx + 1));
  return out;
}

/**
 * Deterministically resolves one waiver run: decides which claims are awarded,
 * charges FAAB / rotates rolling priority, and returns the post-run budget and
 * priority maps for the caller (Task 6) to persist. Pure — no I/O, no clock, no
 * randomness. Every claim yields exactly one decision. A player rostered
 * anywhere at run start stays unclaimable for the whole run even if dropped
 * mid-run (drops free the dropping team's capacity only; the player hits
 * waivers for the NEXT run).
 *
 * Returns an error result only for a boundary violation the DB schema permits
 * (a null bid on a FAAB claim — the `bid` column is nullable). Genuinely
 * impossible states (duplicate ids, a claiming team missing a consulted
 * budget/priority entry) are invariant violations, not error results.
 */
export function resolveWaiverRun(input: ResolveWaiverRunInput): ResolveWaiverRunResult {
  const { claims, waivers } = input;
  invariant(claims.length <= MAX_CLAIMS, `waiver run has ${claims.length} claims, over ${MAX_CLAIMS}`);
  invariant(
    new Set(claims.map((c) => c.transactionId)).size === claims.length,
    'waiver claims contain duplicate transactionIds',
  );

  if (waivers.mode === 'faab') {
    const badBid = claims.find((c) => c.bid === null || !Number.isInteger(c.bid) || c.bid < 0);
    if (badBid !== undefined) {
      return { ok: false, error: `FAAB claim ${badBid.transactionId} has a null or invalid bid` };
    }
  }

  const ctx = buildContext(input);
  const decisions: WaiverDecision[] = [];
  const remaining = new Set(claims);
  for (let processed = 0; processed < claims.length; processed += 1) {
    const next = selectNextClaim(remaining, ctx);
    invariant(next !== null, 'selection returned null while claims remained');
    remaining.delete(next);
    decisions.push(processClaim(ctx, next));
  }

  invariant(decisions.length === claims.length, 'every claim must yield exactly one decision');
  // No player awarded twice: map awarded decisions back to their claims'
  // addPlayerIds; the set must be as large as the award count. Unreachable
  // through the availability gate above — this is defense against a future
  // weakening of that gate, not a live code path.
  const claimById = new Map(claims.map((c) => [c.transactionId, c]));
  const awarded = decisions.filter((d) => d.outcome === 'awarded');
  const awardedPlayers = new Set<string>();
  for (const d of awarded) {
    const c = claimById.get(d.transactionId);
    invariant(c !== undefined, `awarded decision ${d.transactionId} has no matching claim`);
    awardedPlayers.add(c.addPlayerId);
  }
  invariant(awardedPlayers.size === awarded.length, 'a player was awarded to more than one claim');

  const newFaab = new Map(ctx.faab);
  invariant([...newFaab.values()].every((v) => v >= 0), 'a FAAB balance ended below zero');
  return { ok: true, value: { decisions, newFaab, newPriority: buildNewPriority(input, ctx) } };
}
