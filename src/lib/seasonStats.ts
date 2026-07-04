import { SleeperMatchup } from './types';

// A week counts as played once anyone has scored
function isPlayedWeek(matchups: SleeperMatchup[]): boolean {
  return matchups.some(m => (m.points || 0) > 0);
}

export interface LuckRow {
  rosterId: number;
  actualWins: number;
  actualLosses: number;
  actualTies: number;
  expectedWins: number;
  luck: number; // actual wins - expected wins; positive = lucky
  weeksPlayed: number;
}

// "All-play" luck index: expected wins are how many games a team would have
// won each week if it played every other team. Beating the median while
// losing your matchup shows up as bad luck, not bad football.
// Actual record is derived from the same matchup data so live weeks stay
// internally consistent.
export function calculateLuckIndex(weeklyMatchups: SleeperMatchup[][]): LuckRow[] {
  const rows = new Map<number, LuckRow>();

  const getRow = (rosterId: number): LuckRow => {
    let row = rows.get(rosterId);
    if (!row) {
      row = {
        rosterId,
        actualWins: 0,
        actualLosses: 0,
        actualTies: 0,
        expectedWins: 0,
        luck: 0,
        weeksPlayed: 0,
      };
      rows.set(rosterId, row);
    }
    return row;
  };

  for (const matchups of weeklyMatchups) {
    if (!isPlayedWeek(matchups)) continue;

    const scores = matchups.map(m => ({ rosterId: m.roster_id, points: m.points || 0 }));
    const n = scores.length;
    if (n < 2) continue;

    // All-play expected wins for the week
    for (const { rosterId, points } of scores) {
      const row = getRow(rosterId);
      let beaten = 0;
      let tied = 0;
      for (const other of scores) {
        if (other.rosterId === rosterId) continue;
        if (points > other.points) beaten++;
        else if (points === other.points) tied++;
      }
      row.expectedWins += (beaten + tied / 2) / (n - 1);
      row.weeksPlayed++;
    }

    // Actual head-to-head result for the week
    const byMatchup = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (!m.matchup_id) continue;
      const group = byMatchup.get(m.matchup_id) || [];
      group.push(m);
      byMatchup.set(m.matchup_id, group);
    }

    byMatchup.forEach(group => {
      if (group.length !== 2) return;
      const [m1, m2] = group;
      const p1 = m1.points || 0;
      const p2 = m2.points || 0;
      if (p1 === 0 && p2 === 0) return;

      if (p1 > p2) {
        getRow(m1.roster_id).actualWins++;
        getRow(m2.roster_id).actualLosses++;
      } else if (p2 > p1) {
        getRow(m2.roster_id).actualWins++;
        getRow(m1.roster_id).actualLosses++;
      } else {
        getRow(m1.roster_id).actualTies++;
        getRow(m2.roster_id).actualTies++;
      }
    });
  }

  const result = Array.from(rows.values());
  for (const row of result) {
    row.luck = row.actualWins + row.actualTies / 2 - row.expectedWins;
  }
  result.sort((a, b) => b.luck - a.luck);
  return result;
}

export interface AwardGame {
  winnerId: number;
  loserId: number;
  winnerPoints: number;
  loserPoints: number;
  margin: number;
}

export interface WeeklyAwards {
  week: number; // 1-indexed week the awards are for
  topScore: { rosterId: number; points: number } | null;
  biggestBlowout: AwardGame | null;
  closestGame: AwardGame | null;
}

// Awards for the most recent week with any scoring.
export function calculateWeeklyAwards(weeklyMatchups: SleeperMatchup[][]): WeeklyAwards | null {
  let weekIdx = -1;
  for (let i = weeklyMatchups.length - 1; i >= 0; i--) {
    if (isPlayedWeek(weeklyMatchups[i])) {
      weekIdx = i;
      break;
    }
  }
  if (weekIdx === -1) return null;

  const matchups = weeklyMatchups[weekIdx];

  let topScore: WeeklyAwards['topScore'] = null;
  for (const m of matchups) {
    const points = m.points || 0;
    if (points > 0 && (!topScore || points > topScore.points)) {
      topScore = { rosterId: m.roster_id, points };
    }
  }

  const byMatchup = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (!m.matchup_id) continue;
    const group = byMatchup.get(m.matchup_id) || [];
    group.push(m);
    byMatchup.set(m.matchup_id, group);
  }

  let biggestBlowout: AwardGame | null = null;
  let closestGame: AwardGame | null = null;

  byMatchup.forEach(group => {
    if (group.length !== 2) return;
    const [m1, m2] = group;
    const p1 = m1.points || 0;
    const p2 = m2.points || 0;
    // Skip games that haven't actually been played on both sides
    if (p1 === 0 || p2 === 0) return;

    const winnerFirst = p1 >= p2;
    const game: AwardGame = {
      winnerId: winnerFirst ? m1.roster_id : m2.roster_id,
      loserId: winnerFirst ? m2.roster_id : m1.roster_id,
      winnerPoints: Math.max(p1, p2),
      loserPoints: Math.min(p1, p2),
      margin: Math.abs(p1 - p2),
    };

    if (!biggestBlowout || game.margin > biggestBlowout.margin) {
      biggestBlowout = game;
    }
    if (!closestGame || game.margin < closestGame.margin) {
      closestGame = game;
    }
  });

  return {
    week: weekIdx + 1,
    topScore,
    biggestBlowout,
    closestGame,
  };
}
