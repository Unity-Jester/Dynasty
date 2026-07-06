import { describe, it, expect } from 'vitest';
import {
  LeagueSettingsSchema,
  DEFAULT_SUPERFLEX_PPR,
  starterSlotCount,
} from '../settings';

describe('LeagueSettingsSchema', () => {
  it('accepts the default 12-team Superflex PPR preset', () => {
    const parsed = LeagueSettingsSchema.safeParse(DEFAULT_SUPERFLEX_PPR);
    expect(parsed.success).toBe(true);
  });

  it('rejects a roster with zero starter slots', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      rosterSlots: [{ slot: 'BENCH', count: 20 }],
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown scoring stat keys', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      scoring: { rules: { not_a_stat: 1 }, bonuses: [] },
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects future pick trading beyond 3 years', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      trades: { ...DEFAULT_SUPERFLEX_PPR.trades, futurePickYears: 4 },
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('counts starter slots (excludes BENCH/TAXI/IR)', () => {
    expect(starterSlotCount(DEFAULT_SUPERFLEX_PPR.rosterSlots)).toBe(10);
  });

  it('rejects duplicate roster-slot entries', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      rosterSlots: [
        ...DEFAULT_SUPERFLEX_PPR.rosterSlots,
        { slot: 'QB', count: 1 },
      ],
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects explicit count: 0 entries (omission is the canonical form)', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      rosterSlots: [
        ...DEFAULT_SUPERFLEX_PPR.rosterSlots,
        { slot: 'K', count: 0 },
      ],
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a valid bonus entry', () => {
    const good = {
      ...DEFAULT_SUPERFLEX_PPR,
      scoring: {
        ...DEFAULT_SUPERFLEX_PPR.scoring,
        bonuses: [{ stat: 'rec_yd', threshold: 100, points: 3 }],
      },
    };
    expect(LeagueSettingsSchema.safeParse(good).success).toBe(true);
  });

  it('rejects a bonus with a zero or negative threshold', () => {
    const withThreshold = (threshold: number) => ({
      ...DEFAULT_SUPERFLEX_PPR,
      scoring: {
        ...DEFAULT_SUPERFLEX_PPR.scoring,
        bonuses: [{ stat: 'rec_yd', threshold, points: 3 }],
      },
    });
    expect(LeagueSettingsSchema.safeParse(withThreshold(0)).success).toBe(false);
    expect(LeagueSettingsSchema.safeParse(withThreshold(-100)).success).toBe(false);
  });
});
