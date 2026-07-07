import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { easternToUtcIso, parseNflSchedule } from '../parseNflSchedule';

const fixtureText = readFileSync(
  join(__dirname, '../__fixtures__/nflverse-schedule-sample.csv'),
  'utf8',
);

describe('easternToUtcIso', () => {
  it('converts an EDT (September, DST) wall-clock time to UTC (+4h)', () => {
    // 2026 week 1 opener: 2026-09-09 20:20 US/Eastern -> 2026-09-10T00:20:00.000Z
    expect(easternToUtcIso('2026-09-09', '20:20')).toBe('2026-09-10T00:20:00.000Z');
  });

  it('converts an EST (January, standard time) wall-clock time to UTC (+5h)', () => {
    // 2026-01-04 13:00 US/Eastern -> 2026-01-04T18:00:00.000Z
    expect(easternToUtcIso('2026-01-04', '13:00')).toBe('2026-01-04T18:00:00.000Z');
  });

  it('converts a second EDT time (Thursday nighter) correctly', () => {
    expect(easternToUtcIso('2026-09-10', '20:35')).toBe('2026-09-11T00:35:00.000Z');
  });

  it('converts a second EST time (late afternoon window) correctly', () => {
    expect(easternToUtcIso('2026-01-04', '16:25')).toBe('2026-01-04T21:25:00.000Z');
  });
});

describe('parseNflSchedule', () => {
  it('emits two entries per row (home + away), same kickoff', () => {
    const result = parseNflSchedule(fixtureText, 2026);
    expect(result.games.length).toBeGreaterThan(0);
    const opener = result.games.filter((g) => g.week === 1 && g.kickoffIso === '2026-09-10T00:20:00.000Z');
    expect(opener).toHaveLength(2);
    const teams = opener.map((g) => g.nflTeam).sort();
    expect(teams).toEqual(['NE', 'SEA']);
  });

  it('matches the documented week 1 opener kickoff exactly', () => {
    const result = parseNflSchedule(fixtureText, 2026);
    const sea = result.games.find((g) => g.nflTeam === 'SEA' && g.week === 1);
    expect(sea?.kickoffIso).toBe('2026-09-10T00:20:00.000Z');
  });

  it('filters strictly to the requested season', () => {
    const result = parseNflSchedule(fixtureText, 2026);
    // Fixture also contains 2025 week 18 rows; none should leak into 2026 output.
    expect(result.games.every((g) => g.season === 2026)).toBe(true);
  });

  it('parses a January (EST) season correctly when requested', () => {
    const result = parseNflSchedule(fixtureText, 2025);
    const atl = result.games.find((g) => g.nflTeam === 'ATL' && g.week === 18);
    expect(atl?.kickoffIso).toBe('2026-01-04T18:00:00.000Z');
    expect(result.games.every((g) => g.season === 2025)).toBe(true);
  });

  it('skips rows with a missing/blank gametime and counts them', () => {
    const result = parseNflSchedule(fixtureText, 2026);
    // The fixture includes one 2026 week-1 row with a blank gametime (TBD game).
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const tbd = result.games.filter((g) => g.nflTeam === 'MIA' || g.nflTeam === 'NYJ');
    expect(tbd).toHaveLength(0);
  });

  it('returns an empty result for a season with no matching rows', () => {
    const result = parseNflSchedule(fixtureText, 1999);
    expect(result.games).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it('every emitted game carries the requested season and a valid ISO kickoff', () => {
    const result = parseNflSchedule(fixtureText, 2026);
    for (const g of result.games) {
      expect(g.season).toBe(2026);
      expect(() => new Date(g.kickoffIso)).not.toThrow();
      expect(Number.isNaN(new Date(g.kickoffIso).getTime())).toBe(false);
    }
  });
});
