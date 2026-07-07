import { describe, it, expect } from 'vitest';
import { scoreStatLine, roundPoints, scoreLineup } from '../score';

describe('scoreStatLine', () => {
  it('computes an exact dot product over multiple rule keys', () => {
    const rules = { pass_yd: 0.04, pass_td: 4 };
    const stats = { pass_yd: 300, pass_td: 2 };
    expect(scoreStatLine(rules, [], stats)).toBe(0.04 * 300 + 4 * 2);
  });

  it('preserves Sleeper float imprecision exactly (no input normalization)', () => {
    const rules = { pass_yd: 0.03999999910593033 };
    const stats = { pass_yd: 317 };
    // Computed from the literal rule value, not a "clean" 0.04 — proves the
    // engine never rounds/normalizes the rule before multiplying.
    expect(scoreStatLine(rules, [], stats)).toBe(0.03999999910593033 * 317);
  });

  it('applies negative rules (fumble-lost penalty)', () => {
    const rules = { fum_lost: -2 };
    const stats = { fum_lost: 1 };
    expect(scoreStatLine(rules, [], stats)).toBe(-2);
  });

  it('treats absent stat keys as 0 and ignores stats keys not present in rules', () => {
    const rules = { rec: 1 };
    const stats = { rec: 5, snp: 62 }; // snp: snap count, not a scoring key
    expect(scoreStatLine(rules, [], stats)).toBe(5);

    const rulesNoMatch = { pass_td: 4 };
    const statsAbsent = { rush_yd: 50 }; // pass_td absent from stats entirely
    expect(scoreStatLine(rulesNoMatch, [], statsAbsent)).toBe(0);
  });

  it('fires a threshold bonus at the threshold but not below, exactly once', () => {
    const bonuses = [{ stat: 'rush_yd', threshold: 100, points: 3 }];
    expect(scoreStatLine({}, bonuses, { rush_yd: 100 })).toBe(3);
    expect(scoreStatLine({}, bonuses, { rush_yd: 99 })).toBe(0);
    expect(scoreStatLine({}, bonuses, { rush_yd: 250 })).toBe(3);
  });

  it('stacks multiple bonuses; a bonus whose stat is absent never fires', () => {
    const bonuses = [
      { stat: 'rush_yd', threshold: 100, points: 3 },
      { stat: 'rec_yd', threshold: 100, points: 2 },
      { stat: 'ret_td', threshold: 1, points: 6 },
    ];
    const stats = { rush_yd: 120, rec_yd: 150 }; // ret_td absent
    expect(scoreStatLine({}, bonuses, stats)).toBe(5);
  });

  it('returns 0 for empty rules and empty stats (bonuses cannot fire)', () => {
    expect(scoreStatLine({}, [], {})).toBe(0);
    const bonuses = [{ stat: 'rush_yd', threshold: 100, points: 3 }];
    expect(scoreStatLine({}, bonuses, {})).toBe(0);
  });

  it('throws when rules exceed MAX_RULE_KEYS (200)', () => {
    const rules: Record<string, number> = {};
    for (let i = 0; i < 201; i++) rules[`k${i}`] = 1;
    expect(() => scoreStatLine(rules, [], {})).toThrow();
  });

  it('throws when bonuses exceed MAX_BONUSES (50)', () => {
    const bonuses: { stat: string; threshold: number; points: number }[] = [];
    for (let i = 0; i < 51; i++) bonuses.push({ stat: `s${i}`, threshold: 1, points: 1 });
    expect(() => scoreStatLine({}, bonuses, {})).toThrow();
  });

  it('throws (impossible state) when a rules value is NaN', () => {
    const rules = { pass_yd: NaN };
    expect(() => scoreStatLine(rules, [], { pass_yd: 300 })).toThrow();
  });
});

describe('roundPoints', () => {
  it('rounds half-up to 2dp for positive values', () => {
    expect(roundPoints(0.005)).toBe(0.01);
    expect(roundPoints(107.915)).toBe(107.92);
  });

  it('rounds half-away-from-zero for negatives (documented choice, may adjust in Task 3)', () => {
    expect(roundPoints(-0.005)).toBe(-0.01);
  });

  it('truncates a sub-half-cent remainder down', () => {
    expect(roundPoints(1.004999)).toBe(1.0);
  });

  it('throws on non-finite input', () => {
    expect(() => roundPoints(NaN)).toThrow();
    expect(() => roundPoints(Infinity)).toThrow();
  });
});

describe('scoreLineup', () => {
  const rules = { pass_td: 4 };

  it('treats the "0" sentinel slot as 0 points', () => {
    const statsByPlayer = new Map<string, Record<string, number>>();
    const result = scoreLineup(rules, [], ['0'], statsByPlayer);
    expect(result.perStarter).toEqual([0]);
    expect(result.total).toBe(0);
  });

  it('treats a starter missing from statsByPlayer as 0 points', () => {
    const statsByPlayer = new Map<string, Record<string, number>>();
    const result = scoreLineup(rules, [], ['p1'], statsByPlayer);
    expect(result.perStarter).toEqual([0]);
    expect(result.total).toBe(0);
  });

  it('aligns perStarter index-for-index with starters, including a missing middle slot', () => {
    const statsByPlayer = new Map<string, Record<string, number>>([
      ['p1', { pass_td: 2 }], // 8
      ['p3', { pass_td: 1 }], // 4
    ]);
    const result = scoreLineup(rules, [], ['p1', 'p2', 'p3'], statsByPlayer);
    expect(result.perStarter).toEqual([8, 0, 4]);
    expect(result.total).toBe(12);
  });

  it('throws when starters exceed MAX_STARTERS (30)', () => {
    const starters = Array.from({ length: 31 }, (_, i) => `p${i}`);
    const statsByPlayer = new Map<string, Record<string, number>>();
    expect(() => scoreLineup(rules, [], starters, statsByPlayer)).toThrow();
  });

  it('throws when rules exceed MAX_RULE_KEYS via the underlying scoreStatLine call', () => {
    const bigRules: Record<string, number> = {};
    for (let i = 0; i < 201; i++) bigRules[`k${i}`] = 1;
    const statsByPlayer = new Map<string, Record<string, number>>([['p1', { k0: 1 }]]);
    expect(() => scoreLineup(bigRules, [], ['p1'], statsByPlayer)).toThrow();
  });
});
