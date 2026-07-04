import { describe, it, expect } from 'vitest';
import { calculateLuckIndex, calculateWeeklyAwards } from '../seasonStats';
import { SleeperMatchup } from '../types';

function m(rosterId: number, matchupId: number, points: number): SleeperMatchup {
  return { roster_id: rosterId, matchup_id: matchupId, points } as SleeperMatchup;
}

// Week: 4 teams, two games. Team 1 scores highest and wins; team 3 scores
// second-highest but loses to team 1? No - pairings: (1 vs 2), (3 vs 4).
const week1 = [m(1, 1, 150), m(2, 1, 100), m(3, 2, 140), m(4, 2, 90)];
// Week 2: team 2 posts the week's 2nd-best score but plays team 1 (best) - unlucky loss
const week2 = [m(1, 1, 160), m(2, 1, 150), m(3, 2, 80), m(4, 2, 70)];

describe('calculateLuckIndex', () => {
  it('computes all-play expected wins and luck', () => {
    const rows = calculateLuckIndex([week1, week2]);
    const byId = new Map(rows.map(r => [r.rosterId, r]));

    // Team 1 beat all 3 teams both weeks: expected 2.0, actual 2 -> luck 0
    expect(byId.get(1)!.expectedWins).toBeCloseTo(2);
    expect(byId.get(1)!.actualWins).toBe(2);
    expect(byId.get(1)!.luck).toBeCloseTo(0);

    // Team 2: week1 beat 1 of 3 (vs 90), week2 beat 2 of 3 -> expected 1.0
    // but actual 0 wins -> luck -1 (unluckiest)
    expect(byId.get(2)!.expectedWins).toBeCloseTo(1 / 3 + 2 / 3);
    expect(byId.get(2)!.actualWins).toBe(0);
    expect(byId.get(2)!.luck).toBeCloseTo(-1);

    // Team 4: worst both weeks except week1 vs nobody... week1 90 beats none,
    // week2 70 beats none -> expected 0, actual 0 -> luck 0
    expect(byId.get(4)!.expectedWins).toBeCloseTo(0);

    // Team 3: week1 beat 2 of 3, week2 beat 1 of 3 -> expected 1.0, actual 2 -> luck +1
    expect(byId.get(3)!.luck).toBeCloseTo(1);

    // Sorted luckiest first
    expect(rows[0].rosterId).toBe(3);
    expect(rows[rows.length - 1].rosterId).toBe(2);
  });

  it('skips unplayed weeks', () => {
    const unplayed = [m(1, 1, 0), m(2, 1, 0)];
    const rows = calculateLuckIndex([unplayed]);
    expect(rows).toHaveLength(0);
  });
});

describe('calculateWeeklyAwards', () => {
  it('returns awards for the most recent played week', () => {
    const unplayed = [m(1, 1, 0), m(2, 1, 0), m(3, 2, 0), m(4, 2, 0)];
    const awards = calculateWeeklyAwards([week1, week2, unplayed]);

    expect(awards).not.toBeNull();
    expect(awards!.week).toBe(2);
    expect(awards!.topScore).toEqual({ rosterId: 1, points: 160 });
    // Blowout: 160-150 margin 10 vs 80-70 margin 10 - equal margins keep first found
    expect(awards!.biggestBlowout!.margin).toBe(10);
    expect(awards!.closestGame!.margin).toBe(10);
  });

  it('distinguishes blowout from nail-biter', () => {
    const week = [m(1, 1, 200), m(2, 1, 100), m(3, 2, 120), m(4, 2, 119)];
    const awards = calculateWeeklyAwards([week]);
    expect(awards!.biggestBlowout).toMatchObject({ winnerId: 1, loserId: 2, margin: 100 });
    expect(awards!.closestGame).toMatchObject({ winnerId: 3, loserId: 4, margin: 1 });
  });

  it('returns null when nothing has been played', () => {
    expect(calculateWeeklyAwards([[m(1, 1, 0), m(2, 1, 0)]])).toBeNull();
    expect(calculateWeeklyAwards([])).toBeNull();
  });

  it('ignores games where one side has not played', () => {
    const week = [m(1, 1, 130), m(2, 1, 0), m(3, 2, 110), m(4, 2, 100)];
    const awards = calculateWeeklyAwards([week]);
    expect(awards!.biggestBlowout).toMatchObject({ winnerId: 3, loserId: 4 });
    expect(awards!.topScore).toEqual({ rosterId: 1, points: 130 });
  });
});
