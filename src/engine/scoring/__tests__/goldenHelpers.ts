import { translateSettings } from '../../import/translateSettings';
import { scoreStatLine, scoreLineup, roundPoints } from '../score';
import type { LeagueSettings } from '../../settings';

// Sleeper's empty-lineup-slot sentinel inside a `starters` array.
export const EMPTY_SLOT_SENTINEL = '0';

// The comparison tolerance mandated by the golden-file task. Sleeper stores
// points at 2dp, so any correct reproduction lands well inside this.
export const TOLERANCE = 0.01;

// Shape of one entry in the matchups-*.json fixtures (12 per week).
export interface MatchupEntry {
  readonly roster_id: number;
  readonly points: number;
  readonly starters: readonly string[];
  readonly starters_points: readonly number[];
  readonly players_points: Readonly<Record<string, number>>;
}

// Raw Sleeper week stat map: player id -> stat line (arbitrary numeric keys).
export type StatFixture = Readonly<Record<string, Readonly<Record<string, number>>>>;

type Rules = LeagueSettings['scoring']['rules'];

/**
 * Translates the golden league JSON and returns the scoring rules plus any
 * warnings. Throws (failing the test loudly) if translation is not ok — a
 * golden file cannot proceed on un-translatable settings.
 */
export function loadGoldenSettings(leagueJson: unknown): {
  settings: LeagueSettings;
  warnings: readonly string[];
} {
  const result = translateSettings(leagueJson);
  if (!result.ok) {
    throw new Error(`translateSettings failed on the golden league: ${result.error}`);
  }
  return { settings: result.value.settings, warnings: result.value.warnings };
}

/**
 * A scoring warning is one that would silently alter native scoring — i.e. a
 * dropped/unsupported scoring stat key. Roster-position warnings are out of
 * scope for the golden scoring check.
 */
export function scoringWarnings(warnings: readonly string[]): readonly string[] {
  const MAX = 200;
  return warnings.filter((w) => w.includes('scoring stat')).slice(0, MAX);
}

/**
 * Builds the statsByPlayer map the lineup scorer consumes, straight from a
 * week's raw stat fixture — entries pass through untouched.
 */
export function buildStatsByPlayer(
  fixture: StatFixture,
): Map<string, Readonly<Record<string, number>>> {
  const MAX_PLAYERS = 10_000;
  const ids = Object.keys(fixture);
  const map = new Map<string, Readonly<Record<string, number>>>();
  const limit = Math.min(ids.length, MAX_PLAYERS);
  for (let i = 0; i < limit; i++) {
    const id = ids[i];
    map.set(id, fixture[id]);
  }
  return map;
}

// One computed comparison: our engine's value vs Sleeper's published value.
export interface Comparison {
  readonly kind: 'player' | 'slot' | 'total';
  readonly label: string;
  readonly ours: number;
  readonly sleeper: number;
  readonly delta: number;
}

// The full set of comparisons for one roster's week, at all three granularities.
export interface RosterWeekResult {
  readonly week: string;
  readonly rosterId: number;
  readonly comparisons: readonly Comparison[];
}

function mkComparison(
  kind: Comparison['kind'],
  label: string,
  ours: number,
  sleeper: number,
): Comparison {
  return { kind, label, ours, sleeper, delta: Math.abs(ours - sleeper) };
}

/**
 * Computes every golden comparison for a single roster entry in a week:
 * per-starter (isolated), per-slot (whole-lineup), and team total. Pure — no
 * assertions, no shared state — so callers can both assert and aggregate.
 */
export function computeRosterWeek(
  week: string,
  rules: Rules,
  entry: MatchupEntry,
  statsByPlayer: ReadonlyMap<string, Readonly<Record<string, number>>>,
): RosterWeekResult {
  const tag = `${week} roster ${entry.roster_id}`;
  const comparisons: Comparison[] = [];

  // Per-player: each starter (excluding sentinels) scored in isolation.
  for (const starterId of entry.starters) {
    if (starterId === EMPTY_SLOT_SENTINEL) continue;
    const line = statsByPlayer.get(starterId);
    const ours = line === undefined ? 0 : roundPoints(scoreStatLine(rules, [], line));
    const sleeper = entry.players_points[starterId] ?? 0;
    comparisons.push(mkComparison('player', `${tag} player ${starterId}`, ours, sleeper));
  }

  // Per-slot: whole-lineup scorer, element-wise vs starters_points.
  const lineup = scoreLineup(rules, [], entry.starters, statsByPlayer);
  const limit = Math.min(entry.starters.length, lineup.perStarter.length);
  for (let i = 0; i < limit; i++) {
    const ours = roundPoints(lineup.perStarter[i]);
    comparisons.push(
      mkComparison('slot', `${tag} slot ${i} (${entry.starters[i]})`, ours, entry.starters_points[i]),
    );
  }

  // Team total.
  comparisons.push(mkComparison('total', `${tag} TOTAL`, roundPoints(lineup.total), entry.points));

  return { week, rosterId: entry.roster_id, comparisons };
}

/** Flattens every comparison across all roster-weeks into one list. */
export function flattenComparisons(results: readonly RosterWeekResult[]): readonly Comparison[] {
  const MAX = 100_000;
  const all: Comparison[] = [];
  for (const result of results) {
    for (const cmp of result.comparisons) {
      if (all.length >= MAX) break;
      all.push(cmp);
    }
  }
  return all;
}

/** The single largest deviation across a comparison list (0 / '(none)' if empty). */
export function maxDeviation(comparisons: readonly Comparison[]): {
  delta: number;
  label: string;
} {
  let worst = { delta: 0, label: '(none)' };
  for (const cmp of comparisons) {
    if (cmp.delta > worst.delta) worst = { delta: cmp.delta, label: cmp.label };
  }
  return worst;
}
