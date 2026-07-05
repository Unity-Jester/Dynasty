import { describe, it, expect } from 'vitest';
import {
  sampleDates,
  buildVaultTrades,
  reconstructFranchiseSeries,
  buildRosterEvents,
  findSuperlatives,
} from '../vault';
import { HistoricalValueData } from '../historicalValues';
import { SleeperTransaction, TradePick } from '../types';
import { DraftedPlayer } from '../sleeper';

// Sheet fixture: 6 monthly snapshots, newest first, where Star rises and
// Fader falls after 2025-03.
const DATES_DESC = ['2025-06-01', '2025-05-01', '2025-04-01', '2025-03-01', '2025-02-01', '2025-01-01'];

function makeSheet(): HistoricalValueData {
  const values = new Map<string, Map<string, number>>();
  const table: Record<string, [number, number, number]> = {
    // date: [Star, Fader, 2025 Mid 1st]
    '2025-01-01': [4000, 4000, 5000],
    '2025-02-01': [4500, 3800, 5000],
    '2025-03-01': [5000, 3500, 5100],
    '2025-04-01': [6500, 3000, 5200],
    '2025-05-01': [8000, 2500, 5200],
    '2025-06-01': [9000, 2000, 5300],
  };
  for (const [date, [star, fader, pick]] of Object.entries(table)) {
    values.set(date, new Map([
      ['Star Player', star],
      ['Fader Player', fader],
      ['2025 Mid 1st', pick],
      ['Rookie Gem', date >= '2025-05-01' ? 3000 : NaN],
    ]));
    if (date < '2025-05-01') values.get(date)!.delete('Rookie Gem');
  }
  return {
    dates: DATES_DESC,
    pickColumns: ['2025 Mid 1st'],
    playerColumns: ['Star Player', 'Fader Player', 'Rookie Gem'],
    values,
  };
}

const mapping = new Map([
  ['star', 'Star Player'],
  ['fader', 'Fader Player'],
  ['gem', 'Rookie Gem'],
]);

function makeTrade(overrides: Partial<SleeperTransaction>): SleeperTransaction {
  return {
    transaction_id: 't1',
    type: 'trade',
    status: 'complete',
    roster_ids: [1, 2],
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: null,
    created: new Date('2025-01-01T12:00:00Z').getTime(),
    creator: 'u',
    consenter_ids: [1, 2],
    leg: 1,
    metadata: null,
    ...overrides,
  } as SleeperTransaction;
}

describe('sampleDates', () => {
  it('returns ascending dates from the trade date onward', () => {
    const from = new Date('2025-03-15').getTime();
    expect(sampleDates(DATES_DESC, from)).toEqual(['2025-04-01', '2025-05-01', '2025-06-01']);
  });

  it('caps the number of points', () => {
    const from = new Date('2024-12-01').getTime();
    const sampled = sampleDates(DATES_DESC, from, 3);
    expect(sampled.length).toBeLessThanOrEqual(3);
    expect(sampled[0]).toBe('2025-01-01');
    expect(sampled[sampled.length - 1]).toBe('2025-06-01');
  });

  it('falls back to the newest snapshot for very fresh trades', () => {
    const from = new Date('2025-07-01').getTime();
    expect(sampleDates(DATES_DESC, from)).toEqual(['2025-06-01']);
  });
});

describe('buildVaultTrades', () => {
  it('charts diverging sides and computes the swing', () => {
    // Roster 1 receives Star, roster 2 receives Fader, dead even on day one
    const trade = makeTrade({ adds: { star: 1, fader: 2 } });
    const [vt] = buildVaultTrades([trade], null, makeSheet(), mapping);

    const side1 = vt.sides.find(s => s.rosterId === 1)!;
    const side2 = vt.sides.find(s => s.rosterId === 2)!;
    expect(side1.points[0]).toEqual({ date: '2025-01-01', value: 4000 });
    expect(side1.points[side1.points.length - 1].value).toBe(9000);
    expect(side2.points[side2.points.length - 1].value).toBe(2000);

    expect(vt.leaderRosterId).toBe(1);
    expect(vt.gapStart).toBe(0);
    expect(vt.gapNow).toBe(7000);
    expect(vt.swing).toBe(7000);
  });

  it('values traded picks as the pick until the drafted player is tracked', () => {
    const pick: TradePick = { season: '2025', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 };
    const draftMap = new Map<string, DraftedPlayer>([
      ['2025_1_2', { season: '2025', round: 1, pick: 3, rosterId: 2, playerId: 'gem', playerName: 'Rookie Gem' }],
    ]);
    const trade = makeTrade({ adds: { fader: 2 }, draft_picks: [pick] });
    const [vt] = buildVaultTrades([trade], draftMap, makeSheet(), mapping);

    const side1 = vt.sides.find(s => s.rosterId === 1)!;
    const byDate = new Map(side1.points.map(p => [p.date, p.value]));
    expect(byDate.get('2025-01-01')).toBe(5000); // generic pick value
    expect(byDate.get('2025-06-01')).toBe(3000); // became Rookie Gem, now tracked
    expect(side1.trackedAssets).toBe(1);
  });

  it('reports untracked assets via coverage counts', () => {
    const trade = makeTrade({ adds: { star: 1, unknown_rookie: 2 } });
    const [vt] = buildVaultTrades([trade], null, makeSheet(), mapping);
    const side2 = vt.sides.find(s => s.rosterId === 2)!;
    expect(side2.totalAssets).toBe(1);
    expect(side2.trackedAssets).toBe(0);
  });
});

describe('franchise reconstruction', () => {
  it('rebuilds past rosters by inverting events', () => {
    // Now: roster holds [star]. It held [fader] until trading it for star on 2025-03-15.
    const events = buildRosterEvents(
      [
        makeTrade({
          transaction_id: 'swap',
          adds: { star: 1, fader: 2 },
          drops: { fader: 1, star: 2 },
          created: new Date('2025-03-15').getTime(),
        }),
      ],
      []
    );
    const series = reconstructFranchiseSeries(
      ['star'],
      events.get(1)!,
      makeSheet(),
      mapping,
      [...DATES_DESC].reverse()
    );
    const byDate = new Map(series.map(p => [p.date, p.value]));
    expect(byDate.get('2025-02-01')).toBe(3800); // held Fader back then
    expect(byDate.get('2025-04-01')).toBe(6500); // holds Star after the swap
    expect(byDate.get('2025-06-01')).toBe(9000);
  });

  it('lets pre-history players persist backward', () => {
    const series = reconstructFranchiseSeries(
      ['star'],
      [],
      makeSheet(),
      mapping,
      [...DATES_DESC].reverse()
    );
    expect(series[0]).toEqual({ date: '2025-01-01', value: 4000 });
  });

  it('includes drafted players from draft events', () => {
    const events = buildRosterEvents([], [
      { playerId: 'gem', rosterId: 1, ts: new Date('2025-05-10').getTime() },
    ]);
    const series = reconstructFranchiseSeries(
      ['star', 'gem'],
      events.get(1)!,
      makeSheet(),
      mapping,
      [...DATES_DESC].reverse()
    );
    const byDate = new Map(series.map(p => [p.date, p.value]));
    expect(byDate.get('2025-04-01')).toBe(6500); // gem not yet drafted
    expect(byDate.get('2025-06-01')).toBe(9000 + 3000);
  });
});

describe('findSuperlatives', () => {
  it('picks the biggest swing as the heist and keeps plaques distinct', () => {
    const heistTrade = makeTrade({ transaction_id: 'heist', adds: { star: 1, fader: 2 } });
    const evenTrade = makeTrade({
      transaction_id: 'even',
      adds: { fader: 1 },
      draft_picks: [{ season: '2025', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 2 } as TradePick],
      created: new Date('2025-01-01').getTime(),
    });
    // evenTrade side 2 has a pick it kept... adjust: give side 2 a pick received
    const evenTrade2 = makeTrade({
      transaction_id: 'even',
      adds: { fader: 1 },
      draft_picks: [{ season: '2025', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 } as TradePick],
    });
    const trades = buildVaultTrades([heistTrade, evenTrade2], null, makeSheet(), mapping);
    const sup = findSuperlatives(trades, new Date('2025-07-01').getTime());
    expect(sup.heist?.tradeId).toBe('heist');
    expect(sup.photoFinish?.tradeId).toBe('even');
  });
});
