import { describe, it, expect } from 'vitest';
import { estimateScoringModels, simulateSeason, TeamScoringModel } from '../simulation';
import { SleeperMatchup } from '../types';

function m(rosterId: number, matchupId: number, points: number): SleeperMatchup {
  return { roster_id: rosterId, matchup_id: matchupId, points } as SleeperMatchup;
}

function model(rosterId: number, mean: number, std = 20): TeamScoringModel {
  return { rosterId, mean, std, weeksObserved: 5 };
}

describe('estimateScoringModels', () => {
  const values = new Map([
    [1, 50000],
    [2, 30000],
    [3, 10000],
  ]);

  it('uses roster-value priors when nothing has been played', () => {
    const models = estimateScoringModels([], values);
    const m1 = models.get(1)!;
    const m3 = models.get(3)!;
    expect(m1.mean).toBeGreaterThan(m3.mean);
    expect(m1.weeksObserved).toBe(0);
  });

  it('blends observed scores toward the data as weeks accumulate', () => {
    const weeks = [
      [m(1, 1, 80), m(2, 1, 120), m(3, 2, 100)],
      [m(1, 1, 82), m(2, 1, 118), m(3, 2, 101)],
      [m(1, 1, 78), m(2, 1, 122), m(3, 2, 99)],
      [m(1, 1, 81), m(2, 1, 119), m(3, 2, 102)],
    ];
    const models = estimateScoringModels(weeks, values);
    // Team 1 has the best roster but scores ~80: blended mean must sit
    // between the prior (~130) and the observation (~80)
    const m1 = models.get(1)!;
    expect(m1.mean).toBeLessThan(110);
    expect(m1.mean).toBeGreaterThan(80);
    // Team 2 outscores team 1 in the blended model despite lower value
    expect(models.get(2)!.mean).toBeGreaterThan(m1.mean);
    expect(m1.weeksObserved).toBe(4);
  });

  it('ignores unplayed weeks', () => {
    const models = estimateScoringModels([[m(1, 1, 0), m(2, 1, 0)]], values);
    expect(models.get(1)!.weeksObserved).toBe(0);
  });
});

describe('simulateSeason', () => {
  const standings = (wins: number[]) =>
    wins.map((w, i) => ({ rosterId: i + 1, wins: w, ties: 0, pointsFor: 1000 + i }));

  it('is deterministic for a fixed seed', () => {
    const models = new Map([1, 2, 3, 4].map(id => [id, model(id, 100 + id * 5)]));
    const input = {
      models,
      standings: standings([2, 2, 1, 1]),
      remainingWeeks: [[[1, 2], [3, 4]] as [number, number][]],
      playoffTeams: 2,
      sims: 500,
      seed: 42,
    };
    const a = simulateSeason(input);
    const b = simulateSeason(input);
    expect(a).toEqual(b);
  });

  it('gives stronger teams better odds', () => {
    const models = new Map([
      [1, model(1, 140, 15)],
      [2, model(2, 115, 15)],
      [3, model(3, 105, 15)],
      [4, model(4, 90, 15)],
    ]);
    const weeks: [number, number][][] = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0 ? [[1, 2], [3, 4]] : [[1, 3], [2, 4]]
    );
    const odds = simulateSeason({
      models,
      standings: standings([0, 0, 0, 0]),
      remainingWeeks: weeks,
      playoffTeams: 2,
      sims: 2000,
      seed: 7,
    });
    const byId = new Map(odds.map(o => [o.rosterId, o]));
    expect(byId.get(1)!.playoffPct).toBeGreaterThan(byId.get(4)!.playoffPct + 40);
    expect(byId.get(1)!.titlePct).toBeGreaterThan(byId.get(4)!.titlePct);
    expect(byId.get(1)!.projectedWins).toBeGreaterThan(byId.get(4)!.projectedWins);
    // Sorted by playoff odds
    expect(odds[0].rosterId).toBe(1);
  });

  it('is deterministic on the regular season when no weeks remain', () => {
    const models = new Map([1, 2, 3, 4].map(id => [id, model(id, 110)]));
    const odds = simulateSeason({
      models,
      standings: standings([10, 8, 4, 2]),
      remainingWeeks: [],
      playoffTeams: 2,
      sims: 200,
      seed: 1,
    });
    const byId = new Map(odds.map(o => [o.rosterId, o]));
    expect(byId.get(1)!.playoffPct).toBe(100);
    expect(byId.get(2)!.playoffPct).toBe(100);
    expect(byId.get(3)!.playoffPct).toBe(0);
    expect(byId.get(4)!.playoffPct).toBe(0);
    // Title decided by simulated bracket, still sums to 100 across teams
    const titleTotal = odds.reduce((s, o) => s + o.titlePct, 0);
    expect(titleTotal).toBeCloseTo(100, 5);
  });

  it('grants byes only in 6-team playoffs and tracks average seed', () => {
    const models = new Map([1, 2, 3, 4, 5, 6, 7, 8].map(id => [id, model(id, 150 - id * 8, 10)]));
    const odds = simulateSeason({
      models,
      standings: standings([0, 0, 0, 0, 0, 0, 0, 0]),
      remainingWeeks: Array.from({ length: 6 }, () => [[1, 2], [3, 4], [5, 6], [7, 8]] as [number, number][]),
      playoffTeams: 6,
      sims: 1000,
      seed: 3,
    });
    const byId = new Map(odds.map(o => [o.rosterId, o]));
    expect(byId.get(1)!.byePct).toBeGreaterThan(byId.get(8)!.byePct);
    expect(byId.get(1)!.avgSeed).not.toBeNull();
    expect(byId.get(1)!.avgSeed!).toBeLessThan(3);
  });
});
