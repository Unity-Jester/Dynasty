import { SleeperMatchup } from './types';

// ---------------------------------------------------------------------------
// Scoring model estimation
// ---------------------------------------------------------------------------

export interface TeamScoringModel {
  rosterId: number;
  mean: number;
  std: number;
  weeksObserved: number;
}

// Baseline weekly scoring assumptions when little has been played.
const PRIOR_BASE_MEAN = 115;
const PRIOR_VALUE_SPREAD = 30; // best-to-worst roster tilt in points
const PRIOR_STD = 26;
const PRIOR_WEIGHT_WEEKS = 4; // observed weeks needed to outweigh the prior

// Estimate each team's weekly scoring distribution: actual results from
// played weeks, blended with a roster-value prior so odds are sane in
// week 1 (pure prior) and increasingly data-driven as the season runs.
export function estimateScoringModels(
  weeklyMatchups: SleeperMatchup[][],
  rosterValues: Map<number, number>
): Map<number, TeamScoringModel> {
  const scores = new Map<number, number[]>();
  for (const week of weeklyMatchups) {
    if (!week.some(m => (m.points || 0) > 0)) continue;
    for (const m of week) {
      const points = m.points || 0;
      if (points > 0) {
        const list = scores.get(m.roster_id) || [];
        list.push(points);
        scores.set(m.roster_id, list);
      }
    }
  }

  // Roster-value percentile → prior mean
  const rosterIds = [...rosterValues.keys()];
  const sortedValues = [...rosterValues.values()].sort((a, b) => a - b);
  const priorMean = (rosterId: number) => {
    if (sortedValues.length < 2) return PRIOR_BASE_MEAN;
    const value = rosterValues.get(rosterId) || 0;
    const pct = sortedValues.filter(v => v < value).length / (sortedValues.length - 1);
    return PRIOR_BASE_MEAN + PRIOR_VALUE_SPREAD * (pct - 0.5);
  };

  const models = new Map<number, TeamScoringModel>();
  for (const rosterId of rosterIds) {
    const observed = scores.get(rosterId) || [];
    const n = observed.length;

    let mean = priorMean(rosterId);
    let std = PRIOR_STD;

    if (n > 0) {
      const obsMean = observed.reduce((s, v) => s + v, 0) / n;
      const w = n / (n + PRIOR_WEIGHT_WEEKS);
      mean = w * obsMean + (1 - w) * mean;

      if (n >= 4) {
        const variance = observed.reduce((s, v) => s + (v - obsMean) ** 2, 0) / (n - 1);
        const obsStd = Math.sqrt(variance);
        std = w * obsStd + (1 - w) * PRIOR_STD;
      }
    }

    models.set(rosterId, { rosterId, mean, std: Math.max(std, 8), weeksObserved: n });
  }

  return models;
}

// ---------------------------------------------------------------------------
// Monte Carlo season simulation
// ---------------------------------------------------------------------------

export interface SimulationInput {
  models: Map<number, TeamScoringModel>;
  // Current actual standing state
  standings: { rosterId: number; wins: number; ties: number; pointsFor: number }[];
  // Remaining regular-season weeks as roster-id pairings
  remainingWeeks: [number, number][][];
  playoffTeams: number;
  sims?: number;
  seed?: number;
}

export interface TeamOdds {
  rosterId: number;
  playoffPct: number;
  byePct: number; // top-2 seed (only meaningful for 6-team playoffs)
  titlePct: number;
  avgSeed: number | null; // average seed in sims where the team made it
  projectedWins: number;
}

// Deterministic PRNG (mulberry32) so simulations are reproducible/testable
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller normal draw
function makeNormal(rand: () => number) {
  return (mean: number, std: number) => {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + std * z;
  };
}

// Single-elimination bracket among seeded teams: extremes pair off
// (1 v N, 2 v N-1, ...), odd counts give the top remaining seed a bye.
// Matches Sleeper's default 4-team bracket and approximates 6-team.
function simulateBracket(
  seeds: number[],
  models: Map<number, TeamScoringModel>,
  normal: (mean: number, std: number) => number
): number {
  let alive = [...seeds];
  while (alive.length > 1) {
    const next: number[] = [];
    let lo = 0;
    let hi = alive.length - 1;
    if (alive.length % 2 === 1) {
      next.push(alive[0]); // bye for top seed
      lo = 1;
    }
    while (lo < hi) {
      const a = alive[lo];
      const b = alive[hi];
      const ma = models.get(a)!;
      const mb = models.get(b)!;
      next.push(normal(ma.mean, ma.std) >= normal(mb.mean, mb.std) ? a : b);
      lo++;
      hi--;
    }
    alive = next;
  }
  return alive[0];
}

export function simulateSeason(input: SimulationInput): TeamOdds[] {
  const sims = input.sims ?? 2000;
  const rand = mulberry32(input.seed ?? 20260704);
  const normal = makeNormal(rand);

  const rosterIds = input.standings.map(s => s.rosterId);
  const playoffCount = new Map<number, number>();
  const byeCount = new Map<number, number>();
  const titleCount = new Map<number, number>();
  const seedSum = new Map<number, number>();
  const winSum = new Map<number, number>();
  for (const id of rosterIds) {
    playoffCount.set(id, 0);
    byeCount.set(id, 0);
    titleCount.set(id, 0);
    seedSum.set(id, 0);
    winSum.set(id, 0);
  }

  for (let s = 0; s < sims; s++) {
    const wins = new Map(input.standings.map(t => [t.rosterId, t.wins + t.ties / 2]));
    const pf = new Map(input.standings.map(t => [t.rosterId, t.pointsFor]));

    for (const week of input.remainingWeeks) {
      for (const [a, b] of week) {
        const ma = input.models.get(a);
        const mb = input.models.get(b);
        if (!ma || !mb) continue;
        const sa = normal(ma.mean, ma.std);
        const sb = normal(mb.mean, mb.std);
        pf.set(a, (pf.get(a) || 0) + sa);
        pf.set(b, (pf.get(b) || 0) + sb);
        if (sa >= sb) wins.set(a, (wins.get(a) || 0) + 1);
        else wins.set(b, (wins.get(b) || 0) + 1);
      }
    }

    const ranked = [...rosterIds].sort(
      (a, b) => (wins.get(b)! - wins.get(a)!) || (pf.get(b)! - pf.get(a)!)
    );
    const seeds = ranked.slice(0, input.playoffTeams);

    seeds.forEach((id, idx) => {
      playoffCount.set(id, playoffCount.get(id)! + 1);
      seedSum.set(id, seedSum.get(id)! + idx + 1);
      if (idx < 2 && input.playoffTeams >= 6) {
        byeCount.set(id, byeCount.get(id)! + 1);
      }
    });

    const champion = simulateBracket(seeds, input.models, normal);
    titleCount.set(champion, titleCount.get(champion)! + 1);

    for (const id of rosterIds) {
      winSum.set(id, winSum.get(id)! + wins.get(id)!);
    }
  }

  return rosterIds
    .map(id => {
      const made = playoffCount.get(id)!;
      return {
        rosterId: id,
        playoffPct: (made / sims) * 100,
        byePct: (byeCount.get(id)! / sims) * 100,
        titlePct: (titleCount.get(id)! / sims) * 100,
        avgSeed: made > 0 ? seedSum.get(id)! / made : null,
        projectedWins: winSum.get(id)! / sims,
      };
    })
    .sort((a, b) => b.playoffPct - a.playoffPct || b.titlePct - a.titlePct);
}
