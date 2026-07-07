import { describe, it, expect } from 'vitest';
import leagueJson from '../__fixtures__/league-2025.json';
import matchupsWk1 from '../__fixtures__/matchups-2025-wk1.json';
import matchupsWk17 from '../__fixtures__/matchups-2025-wk17.json';
import statsWk1 from '../../stats/__fixtures__/sleeper-2025-wk1.json';
import statsWk17 from '../../stats/__fixtures__/sleeper-2025-wk17.json';
import {
  TOLERANCE,
  loadGoldenSettings,
  scoringWarnings,
  buildStatsByPlayer,
  computeRosterWeek,
  flattenComparisons,
  maxDeviation,
  type MatchupEntry,
  type StatFixture,
  type RosterWeekResult,
} from './goldenHelpers';

/**
 * THE GOLDEN FILE — replays the user's real 2025 Sleeper season (weeks 1 and 17,
 * all 12 rosters each) through Dynasty's native scoring engine and asserts it
 * reproduces Sleeper's own published numbers to within 0.01 at three
 * granularities: per starter (isolated), per lineup slot (whole-lineup), and
 * per team total.
 *
 * A single translated rule set (raw Sleeper float values, no normalization)
 * drives every comparison. Every comparison is computed once, at module load,
 * into an immutable result set; the specs below assert against it and name the
 * exact week / roster / player / slot on any failure.
 */

const { settings, warnings } = loadGoldenSettings(leagueJson);
const rules = settings.scoring.rules;

interface Week {
  readonly name: string;
  readonly matchups: readonly MatchupEntry[];
  readonly stats: StatFixture;
}

// The JSON fixtures are imported for their runtime data; TypeScript infers
// exact literal object types that don't structurally overlap our interfaces
// (optional `?: undefined` props on the wide players_points maps), so we route
// each cast through `unknown`. This is a controlled read of trusted, committed
// test fixtures — not an external trust boundary.
const WEEKS: readonly Week[] = [
  {
    name: 'wk1',
    matchups: matchupsWk1 as unknown as readonly MatchupEntry[],
    stats: statsWk1 as unknown as StatFixture,
  },
  {
    name: 'wk17',
    matchups: matchupsWk17 as unknown as readonly MatchupEntry[],
    stats: statsWk17 as unknown as StatFixture,
  },
];

// Precompute every roster-week's comparisons once (pure). 12 rosters x 2 weeks
// = 24 team-weeks; used both for the per-roster specs and the aggregate report.
const RESULTS: readonly RosterWeekResult[] = WEEKS.flatMap((week) => {
  const statsByPlayer = buildStatsByPlayer(week.stats);
  return week.matchups.map((entry) => computeRosterWeek(week.name, rules, entry, statsByPlayer));
});

const ALL_COMPARISONS = flattenComparisons(RESULTS);

describe('golden-file: 2025 season reproduces Sleeper exactly', () => {
  it('translateSettings is ok and reports no scoring-relevant warnings', () => {
    const relevant = scoringWarnings(warnings);
    expect(relevant, `scoring warnings present: ${JSON.stringify(relevant)}`).toEqual([]);
    // 41 nonzero scoring keys in the golden league, all supported — the rules
    // record must be non-empty or every comparison below is trivially wrong.
    expect(Object.keys(rules).length).toBeGreaterThan(0);
  });

  // One spec per roster-week; a failure names week + roster + player/slot.
  describe.each(RESULTS.map((r) => [`${r.week} roster ${r.rosterId}`, r] as const))(
    '%s',
    (_label, result) => {
      it('every starter, slot, and the team total match Sleeper within 0.01', () => {
        for (const cmp of result.comparisons) {
          expect(
            cmp.delta,
            `${cmp.label}: ours=${cmp.ours} sleeper=${cmp.sleeper} (Δ=${cmp.delta})`,
          ).toBeLessThanOrEqual(TOLERANCE);
        }
      });
    },
  );

  it('validates exactly 24 team-weeks and reports the max deviation', () => {
    expect(RESULTS.length, 'expected exactly 24 team-weeks').toBe(24);

    const worst = maxDeviation(ALL_COMPARISONS);
    const players = ALL_COMPARISONS.filter((c) => c.kind === 'player').length;
    const slots = ALL_COMPARISONS.filter((c) => c.kind === 'slot').length;
    const totals = ALL_COMPARISONS.filter((c) => c.kind === 'total').length;

    // Coverage is pinned, not just logged: a regression that silently drops
    // comparisons must fail here, or a perfect score proves nothing.
    expect(players, 'per-player comparison count').toBe(238);
    expect(slots, 'per-slot comparison count').toBe(240);
    expect(totals, 'team-total comparison count').toBe(24);
    expect(ALL_COMPARISONS.length, 'total comparison count').toBe(502);

    // eslint-disable-next-line no-console -- required aggregate report per task spec
    console.log(
      `[golden2025] team-weeks=${RESULTS.length} comparisons=${ALL_COMPARISONS.length} ` +
        `(players=${players} slots=${slots} totals=${totals}) ` +
        `maxDeviation=${worst.delta} @ ${worst.label}`,
    );

    expect(
      worst.delta,
      `max deviation ${worst.delta} @ ${worst.label} exceeds tolerance`,
    ).toBeLessThanOrEqual(TOLERANCE);
  });
});
