import { describe, it, expect } from 'vitest';
import { generateRoundRobin } from '../schedule';

function teamIds(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    ids.push(`team-${String(i).padStart(2, '0')}`);
  }
  return ids;
}

function unorderedPair(home: string, away: string): string {
  return [home, away].sort().join('|');
}

describe('generateRoundRobin', () => {
  it('produces a full round robin for 4 teams over 3 weeks (every unordered pair once)', () => {
    const ids = teamIds(4);
    const result = generateRoundRobin(ids, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seen = new Set<string>();
    for (const week of result.value.weeks) {
      for (const { home, away } of week.pairings) {
        seen.add(unorderedPair(home, away));
      }
    }

    // 4 teams => C(4,2) = 6 unordered pairs, all should occur exactly once
    // across a full rotation (n-1 = 3 weeks).
    expect(seen.size).toBe(6);
  });

  it('never repeats a team twice in the same week (12 teams x 13 weeks)', () => {
    const ids = teamIds(12);
    const result = generateRoundRobin(ids, 13);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.weeks.length).toBe(13);
    for (const week of result.value.weeks) {
      expect(week.pairings.length).toBe(6);
      const appearances = new Set<string>();
      for (const { home, away } of week.pairings) {
        expect(appearances.has(home)).toBe(false);
        expect(appearances.has(away)).toBe(false);
        appearances.add(home);
        appearances.add(away);
      }
      expect(appearances.size).toBe(12);
    }
  });

  it('is deterministic regardless of input order (sorts a copy lexicographically)', () => {
    const ids = teamIds(8);
    const shuffled = [ids[5], ids[1], ids[7], ids[0], ids[3], ids[2], ids[6], ids[4]];

    const a = generateRoundRobin(ids, 7);
    const b = generateRoundRobin(shuffled, 7);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value).toEqual(a.value);
  });

  it('repeats the rotation cycle structurally: week 12 == week 1 as unordered pairs (12 teams)', () => {
    const ids = teamIds(12);
    const result = generateRoundRobin(ids, 13);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const week1 = result.value.weeks[0];
    const week12 = result.value.weeks[11];
    expect(week1).toBeDefined();
    expect(week12).toBeDefined();
    if (!week1 || !week12) return;

    const pairsOf = (pairings: readonly { home: string; away: string }[]): Set<string> =>
      new Set(pairings.map((p) => unorderedPair(p.home, p.away)));

    expect(pairsOf(week12.pairings)).toEqual(pairsOf(week1.pairings));
  });

  it('rejects an odd team count, mentioning byes', () => {
    const result = generateRoundRobin(teamIds(5), 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('bye');
  });

  it('enforces team count and week bounds', () => {
    expect(generateRoundRobin(teamIds(2), 1).ok).toBe(false);
    expect(generateRoundRobin(teamIds(34), 1).ok).toBe(false);
    expect(generateRoundRobin(teamIds(12), 0).ok).toBe(false);
    expect(generateRoundRobin(teamIds(12), 26).ok).toBe(false);
  });

  it('handles a short season fine (12 teams x 2 weeks, no full rotation required)', () => {
    const result = generateRoundRobin(teamIds(12), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.weeks.length).toBe(2);
    for (const week of result.value.weeks) {
      expect(week.pairings.length).toBe(6);
    }
  });

  it('keeps home/away balance within the documented rule: |homeCount - homeCount| <= 2 across teams, and each team within [floor(weeks/2)-1, ceil(weeks/2)+1]', () => {
    const ids = teamIds(12);
    const weeks = 11;
    const result = generateRoundRobin(ids, weeks);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const homeCount = new Map<string, number>();
    for (const id of ids) homeCount.set(id, 0);
    for (const week of result.value.weeks) {
      for (const { home } of week.pairings) {
        homeCount.set(home, (homeCount.get(home) ?? 0) + 1);
      }
    }

    const lo = Math.floor(weeks / 2) - 1;
    const hi = Math.ceil(weeks / 2) + 1;
    for (const [team, count] of homeCount) {
      expect(count, `team ${team} home count`).toBeGreaterThanOrEqual(lo);
      expect(count, `team ${team} home count`).toBeLessThanOrEqual(hi);
    }

    const counts = [...homeCount.values()];
    const spread = Math.max(...counts) - Math.min(...counts);
    expect(spread).toBeLessThanOrEqual(2);
  });

  it('does not mutate the input array (frozen array accepted; original order preserved)', () => {
    const ids = Object.freeze(teamIds(6));
    const original = [...ids];

    expect(() => generateRoundRobin(ids, 5)).not.toThrow();
    const result = generateRoundRobin(ids, 5);
    expect(result.ok).toBe(true);

    expect(ids).toEqual(original);
  });
});
