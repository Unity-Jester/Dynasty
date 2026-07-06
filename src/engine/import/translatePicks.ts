import { z } from 'zod';
import { invariant } from '../../lib/invariant';
import { firstZodIssueMessage } from '../zodIssue';

// Fixed upper bounds for loops over external (Sleeper API) data — Rule 2.
const MAX_ROSTERS = 32;
const MAX_TRADED_PICKS = 2000;
const MAX_ROUND = 10;

const FUTURE_PICK_YEARS = 3;
const DEFAULT_ROOKIE_ROUNDS = 4;
const MAX_PICK_BASE = MAX_ROSTERS * FUTURE_PICK_YEARS * 6;

const RawTradedPick = z.object({
  season: z.string().regex(/^\d+$/, 'season must be numeric'),
  round: z.number().int().min(1).max(MAX_ROUND),
  roster_id: z.number().int(),
  owner_id: z.number().int(),
});

const RawPicksInput = z.object({
  tradedPicks: z.array(RawTradedPick).max(MAX_TRADED_PICKS),
});

type RawTradedPickT = z.infer<typeof RawTradedPick>;

export interface PickPlan {
  readonly season: number;
  readonly round: number;
  readonly originalRosterId: number;
  currentRosterId: number;
}

export type TranslatePicksResult =
  | { ok: true; value: { picks: PickPlan[]; warnings: string[] } }
  | { ok: false; error: string };

export interface TranslatePicksOpts {
  readonly rosterIds: readonly number[];
  readonly currentSeason: number;
}

// Builds the default N-year rookie-pick base: every rosterId x future season
// x round 1..DEFAULT_ROOKIE_ROUNDS, with currentRosterId starting equal to
// originalRosterId (untraded).
function buildBase(rosterIds: readonly number[], currentSeason: number): PickPlan[] {
  invariant(rosterIds.length <= MAX_ROSTERS, 'rosterIds exceeds the parsed bound');

  const base: PickPlan[] = [];
  for (const rosterId of rosterIds) {
    for (let yearOffset = 1; yearOffset <= FUTURE_PICK_YEARS; yearOffset += 1) {
      for (let round = 1; round <= DEFAULT_ROOKIE_ROUNDS; round += 1) {
        base.push({
          season: currentSeason + yearOffset,
          round,
          originalRosterId: rosterId,
          currentRosterId: rosterId,
        });
      }
    }
  }
  invariant(base.length <= MAX_PICK_BASE, 'materialized pick base exceeds the sanity bound');
  return base;
}

// Partitions traded-pick entries into: in-window (season within the
// materialized base's range), too-early (already drafted), and too-far
// (beyond the future pick window). Each excluded bucket becomes ONE summary
// warning rather than one per entry — Rule 3 bound on warning volume.
function partitionByWindow(
  tradedPicks: readonly RawTradedPickT[],
  currentSeason: number,
  warnings: string[],
): RawTradedPickT[] {
  const maxSeason = currentSeason + FUTURE_PICK_YEARS;
  const inWindow: RawTradedPickT[] = [];
  let tooEarly = 0;
  let tooFar = 0;

  for (const entry of tradedPicks) {
    const season = Number.parseInt(entry.season, 10);
    invariant(Number.isFinite(season), `traded pick season "${entry.season}" failed to parse as an integer`);
    if (season <= currentSeason) {
      tooEarly += 1;
    } else if (season > maxSeason) {
      tooFar += 1;
    } else {
      inWindow.push(entry);
    }
  }

  if (tooEarly > 0) {
    warnings.push(`${tooEarly} traded picks for already-drafted seasons ignored`);
  }
  if (tooFar > 0) {
    warnings.push(`${tooFar} traded picks beyond the future pick window ignored`);
  }
  return inWindow;
}

// Widens the base to include any round beyond DEFAULT_ROOKIE_ROUNDS that an
// in-window trade references, adding that round for ALL rosterIds but only
// for the specific season(s) that need it — other seasons keep the default
// round count. No fixture trade exercises this path; it exists for leagues
// with extended rookie draft rounds.
function widenBaseForExtraRounds(
  base: PickPlan[],
  inWindowTrades: readonly RawTradedPickT[],
  rosterIds: readonly number[],
  warnings: string[],
): void {
  const extraRoundsBySeason = new Map<number, Set<number>>();
  for (const trade of inWindowTrades) {
    if (trade.round <= DEFAULT_ROOKIE_ROUNDS) continue;
    const season = Number.parseInt(trade.season, 10);
    const rounds = extraRoundsBySeason.get(season) ?? new Set<number>();
    rounds.add(trade.round);
    extraRoundsBySeason.set(season, rounds);
  }

  for (const [season, rounds] of extraRoundsBySeason) {
    for (const round of rounds) {
      for (const rosterId of rosterIds) {
        base.push({ season, round, originalRosterId: rosterId, currentRosterId: rosterId });
      }
      warnings.push(`Round ${round} traded pick found for season ${season} — widened base to include it for all teams`);
    }
  }
  invariant(base.length <= MAX_PICK_BASE, 'widened pick base exceeds the sanity bound');
}

// Applies one in-window trade to its matching base entry. Unknown roster_id
// or owner_id (not in rosterIds) is skipped with a warning. A trade that
// matches no base entry after widening is an impossible state — the base is
// guaranteed (by construction) to contain every season/round/rosterId
// combination any in-window trade could reference.
function applyTrade(
  base: PickPlan[],
  trade: RawTradedPickT,
  rosterIds: ReadonlySet<number>,
  warnings: string[],
): boolean {
  if (!rosterIds.has(trade.roster_id) || !rosterIds.has(trade.owner_id)) {
    warnings.push(
      `Traded pick references unknown roster (roster_id=${trade.roster_id}, owner_id=${trade.owner_id}) — skipped`,
    );
    return false;
  }

  const season = Number.parseInt(trade.season, 10);
  const match = base.find(
    (pick) => pick.season === season && pick.round === trade.round && pick.originalRosterId === trade.roster_id,
  );
  invariant(match !== undefined, 'in-window traded pick matched no base entry after widening');
  match.currentRosterId = trade.owner_id;
  return true;
}

/**
 * Materializes the default future rookie-pick base for a league and applies
 * traded-pick reassignments on top of it. zod-parses only the traded picks
 * array (trust boundary) — rosterIds/currentSeason are trusted caller input
 * derived from already-validated league state.
 */
export function translatePicks(input: unknown, opts: TranslatePicksOpts): TranslatePicksResult {
  const parsed = RawPicksInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstZodIssueMessage(parsed.error) };
  }
  invariant(opts.rosterIds.length <= MAX_ROSTERS, 'rosterIds exceeds the sanity bound');

  const warnings: string[] = [];
  const base = buildBase(opts.rosterIds, opts.currentSeason);
  const inWindowTrades = partitionByWindow(parsed.data.tradedPicks, opts.currentSeason, warnings);
  widenBaseForExtraRounds(base, inWindowTrades, opts.rosterIds, warnings);

  const rosterIdSet = new Set(opts.rosterIds);
  let appliedCount = 0;
  let skippedCount = 0;
  for (const trade of inWindowTrades) {
    const applied = applyTrade(base, trade, rosterIdSet, warnings);
    if (applied) appliedCount += 1;
    else skippedCount += 1;
  }
  invariant(
    appliedCount + skippedCount === inWindowTrades.length,
    'applied + skipped trade counts must reconcile with in-window input length',
  );

  return { ok: true, value: { picks: base, warnings } };
}
