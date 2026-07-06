import { describe, it, expect } from 'vitest';
import { translateSettings } from '../translateSettings';
import leagueFixture from '../__fixtures__/league.json';

describe('translateSettings — real league fixture', () => {
  it('translates team count, roster slots, and produces no warnings', () => {
    const result = translateSettings(leagueFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.teamCount).toBe(12);
    expect(result.value.settings.rosterSlots).toEqual(
      expect.arrayContaining([
        { slot: 'QB', count: 1 },
        { slot: 'RB', count: 2 },
        { slot: 'WR', count: 2 },
        { slot: 'TE', count: 1 },
        { slot: 'FLEX', count: 3 },
        { slot: 'SUPER_FLEX', count: 1 },
        { slot: 'BENCH', count: 18 },
        { slot: 'TAXI', count: 3 },
        { slot: 'IR', count: 1 },
      ]),
    );
    expect(result.value.settings.rosterSlots).toHaveLength(9);
    expect(result.value.warnings).toEqual([]);
  });

  it('translates the fixture scoring rules to their exact real-league values with no warnings', () => {
    const result = translateSettings(leagueFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const scoringSettings = leagueFixture.scoring_settings as Record<string, number>;
    const nonzeroEntries = Object.entries(scoringSettings).filter(([, v]) => v !== 0);

    // Every nonzero fixture key ends up in scoring.rules with its exact value.
    for (const [key, value] of nonzeroEntries) {
      expect(result.value.settings.scoring.rules[key as keyof typeof result.value.settings.scoring.rules]).toBe(
        value,
      );
    }
    expect(Object.keys(result.value.settings.scoring.rules)).toHaveLength(nonzeroEntries.length);
    expect(result.value.settings.scoring.bonuses).toEqual([]);
    expect(result.value.warnings).toEqual([]);
  });

  it('translates waivers to FAAB with the real budget and reverse_standings tiebreaker', () => {
    const result = translateSettings(leagueFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.waivers).toEqual({
      mode: 'faab',
      budget: 500,
      tiebreaker: 'reverse_standings',
    });
  });

  it('translates trades to league_vote review with a null deadline (99 is the sentinel)', () => {
    const result = translateSettings(leagueFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.trades).toEqual({
      reviewMode: 'league_vote',
      futurePickYears: 3,
      deadlineWeek: null,
    });
  });

  it('translates playoffs to 6 teams starting week 14, unclamped', () => {
    const result = translateSettings(leagueFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.playoffs).toEqual({ teams: 6, startWeek: 14 });
  });
});

describe('translateSettings — synthetic edge cases', () => {
  const baseInput = () => ({
    total_rosters: 10,
    roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    scoring_settings: { pass_yd: 0.04, pass_td: 4 } as Record<string, number>,
    settings: {
      taxi_slots: 0,
      reserve_slots: 0,
      waiver_type: 2,
      waiver_budget: 200,
      trade_deadline: 10,
      trade_review_days: 1,
      playoff_teams: 4,
      playoff_week_start: 15,
    },
  });

  it('warns and skips unknown roster positions', () => {
    const input = baseInput();
    input.roster_positions = [...input.roster_positions, 'IDP_FLEX'];
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.rosterSlots.find((s) => s.slot === 'BENCH')).toEqual({
      slot: 'BENCH',
      count: 2,
    });
    expect(result.value.warnings.some((w) => w.includes('IDP_FLEX'))).toBe(true);
  });

  it('warns on a nonzero unsupported scoring key and drops it', () => {
    const input = baseInput();
    input.scoring_settings = { ...input.scoring_settings, not_a_real_stat: 3 };
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.scoring.rules).not.toHaveProperty('not_a_real_stat');
    expect(result.value.warnings.some((w) => w.includes('not_a_real_stat'))).toBe(true);
  });

  it('maps waiver_type 0 to rolling waiver priority', () => {
    const input = baseInput();
    input.settings.waiver_type = 0;
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.waivers).toEqual({ mode: 'priority', order: 'rolling' });
  });

  it('maps waiver_type 1 to reverse_standings waiver priority', () => {
    const input = baseInput();
    input.settings.waiver_type = 1;
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.waivers).toEqual({ mode: 'priority', order: 'reverse_standings' });
  });

  it('errs on an unrecognized waiver_type', () => {
    const input = baseInput();
    input.settings.waiver_type = 7;
    const result = translateSettings(input);
    expect(result.ok).toBe(false);
  });

  it('maps trade_deadline 10 to deadlineWeek 10', () => {
    const input = baseInput();
    input.settings.trade_deadline = 10;
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.trades.deadlineWeek).toBe(10);
  });

  it('clamps playoff_week_start 18 to 17 with a warning', () => {
    const input = baseInput();
    input.settings.playoff_week_start = 18;
    const result = translateSettings(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.settings.playoffs.startWeek).toBe(17);
    expect(result.value.warnings.some((w) => w.includes('playoff'))).toBe(true);
  });

  it('errs when total_rosters is below the schema minimum', () => {
    const input = baseInput();
    input.total_rosters = 3;
    const result = translateSettings(input);
    expect(result.ok).toBe(false);
  });

  it('errs on non-object input', () => {
    const result = translateSettings('not an object');
    expect(result.ok).toBe(false);
  });
});
