import { invariant } from '@/lib/invariant';

// Fixed upper bounds (CODING_STANDARDS.md Rule 2/3). No real league config
// approaches these; they exist purely to bound iteration over external data.
const MAX_RULE_KEYS = 200;
const MAX_BONUSES = 50;
const MAX_STARTERS = 30;

// Sleeper's convention for an empty lineup slot inside a `starters` array.
// A sentinel slot (or a starter id with no stat line — bye/DNP) scores 0,
// never throws.
const EMPTY_SLOT_SENTINEL = '0';

export interface ScoringBonus {
  readonly stat: string;
  readonly threshold: number;
  readonly points: number;
}

/**
 * Dot product of league scoring `rules` over a single player's raw `stats`,
 * plus any threshold `bonuses` that fire. Pure and total: absent stat keys
 * contribute 0 and never throw; stats keys with no matching rule are ignored.
 *
 * Rule values are consumed EXACTLY as given — no rounding/normalization — so
 * that downstream golden-file comparison reproduces Sleeper's own arithmetic
 * (Sleeper's stored rule values carry float imprecision, e.g.
 * 0.03999999910593033 for a displayed 0.04). Rounding lives only in
 * `roundPoints`, applied by callers at display/storage time.
 */
export function scoreStatLine(
  rules: Readonly<Record<string, number>>,
  bonuses: readonly ScoringBonus[],
  stats: Readonly<Record<string, number>>,
): number {
  const ruleKeys = Object.keys(rules);
  invariant(
    ruleKeys.length <= MAX_RULE_KEYS,
    `scoring rules (${ruleKeys.length} keys) exceeds the sanity bound of ${MAX_RULE_KEYS}`,
  );
  invariant(
    bonuses.length <= MAX_BONUSES,
    `scoring bonuses (${bonuses.length}) exceeds the sanity bound of ${MAX_BONUSES}`,
  );

  let total = 0;
  for (const key of ruleKeys) {
    const ruleValue = rules[key];
    // Impossible-state assert: settings are zod-gated upstream, so a NaN/Infinity
    // rule value here indicates a bug in that gate, not malformed user input.
    invariant(Number.isFinite(ruleValue), `scoring rule "${key}" is not finite (${ruleValue})`);
    const statValue = stats[key];
    if (statValue === undefined) continue; // absent stat = 0 contribution, never an error
    total += ruleValue * statValue;
  }

  for (const bonus of bonuses) {
    const statValue = stats[bonus.stat];
    if (statValue !== undefined && statValue >= bonus.threshold) {
      total += bonus.points;
    }
  }

  invariant(Number.isFinite(total), `scoreStatLine produced a non-finite result (${total})`);
  return total;
}

/**
 * Rounds to 2 decimal places, half-up (ties away from zero). Naive
 * `Math.round(n * 100) / 100` misrounds values like 1.005 due to binary
 * float representation (1.005 * 100 === 100.49999999999999); nudging by
 * Number.EPSILON before rounding corrects that without touching the
 * already-exact cases.
 *
 * Negative half-cent ties (-0.005) round away from zero (-0.01) here — a
 * symmetric choice made without yet knowing Sleeper's own tie-breaking rule.
 * Task 3's golden-file test may reveal Sleeper rounds negatives differently,
 * in which case this should be revisited.
 */
export function roundPoints(n: number): number {
  invariant(Number.isFinite(n), `roundPoints received a non-finite value (${n})`);
  const nudged = n + Number.EPSILON * Math.sign(n);
  return Math.round(nudged * 100) / 100;
}

/**
 * Scores every starter slot in a lineup. A sentinel slot (Sleeper's "0") or a
 * starter id absent from `statsByPlayer` scores 0 — never an error, since
 * both are routine (empty slot; bye/DNP week). `perStarter[i]` corresponds
 * to `starters[i]` exactly.
 */
export function scoreLineup(
  rules: Readonly<Record<string, number>>,
  bonuses: readonly ScoringBonus[],
  starters: readonly string[],
  statsByPlayer: ReadonlyMap<string, Readonly<Record<string, number>>>,
): { total: number; perStarter: number[] } {
  invariant(
    starters.length <= MAX_STARTERS,
    `lineup starters (${starters.length}) exceeds the sanity bound of ${MAX_STARTERS}`,
  );

  const perStarter: number[] = [];
  for (const starterId of starters) {
    if (starterId === EMPTY_SLOT_SENTINEL) {
      perStarter.push(0);
      continue;
    }
    const stats = statsByPlayer.get(starterId);
    if (stats === undefined) {
      perStarter.push(0);
      continue;
    }
    perStarter.push(scoreStatLine(rules, bonuses, stats));
  }

  invariant(
    perStarter.length === starters.length,
    'perStarter length diverged from starters length',
  );

  let total = 0;
  for (const points of perStarter) {
    total += points;
  }
  invariant(Number.isFinite(total), `scoreLineup produced a non-finite total (${total})`);

  return { total, perStarter };
}
