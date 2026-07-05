import { describe, expect, it } from 'vitest';
import { buildTradeValueMap, calculateTransactionValueChanges } from '../transactionValues';
import { SleeperTransaction, TeamReportCard } from '../types';

function makeTransaction(overrides: Partial<SleeperTransaction>): SleeperTransaction {
  return {
    transaction_id: 'tx1',
    type: 'free_agent',
    status: 'complete',
    roster_ids: [1],
    adds: null,
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    settings: null,
    created: Date.now(),
    creator: 'u1',
    consenter_ids: [1],
    leg: 1,
    metadata: null,
    ...overrides,
  } as SleeperTransaction;
}

function makeReportCard(rosterId: number): TeamReportCard {
  return {
    rosterId,
    ownerId: `u${rosterId}`,
    teamName: `Team ${rosterId}`,
    avatar: null,
    grade: 'C',
    gradeScore: 50,
    totalTrades: 1,
    wins: 0,
    losses: 0,
    pushes: 0,
    totalValueGained: 0,
    bestTrade: null,
    worstTrade: null,
    tradePartners: [],
    positionBreakdown: [],
    trades: [
      {
        tradeId: 'trade-1',
        date: 1000,
        partnerId: rosterId === 1 ? 2 : 1,
        partnerIds: [rosterId === 1 ? 2 : 1],
        received: {
          players: [],
          picks: [],
          totalValue: { historical: 0, current: 0, average: 0 },
        },
        given: {
          players: [],
          picks: [],
          totalValue: { historical: 0, current: 0, average: 0 },
        },
        netValue: {
          historical: rosterId === 1 ? 100 : -100,
          current: rosterId === 1 ? 300 : -300,
          average: rosterId === 1 ? 200 : -200,
        },
        result: rosterId === 1 ? 'win' : 'loss',
      },
    ],
  };
}

describe('buildTradeValueMap', () => {
  it('groups trade value swings by transaction id', () => {
    const values = buildTradeValueMap([makeReportCard(1), makeReportCard(2)]);

    expect(values['trade-1']).toEqual([
      { rosterId: 1, netAtTrade: 100, netCurrent: 300, netAverage: 200 },
      { rosterId: 2, netAtTrade: -100, netCurrent: -300, netAverage: -200 },
    ]);
  });
});

describe('calculateTransactionValueChanges', () => {
  it('calculates free agent value gained from adds minus drops', () => {
    const transaction = makeTransaction({
      adds: { p1: 1, p2: 1 },
      drops: { p3: 1 },
    });

    expect(calculateTransactionValueChanges(transaction, { p1: 1000, p2: 250, p3: 400 })).toEqual([
      { rosterId: 1, addedValue: 1250, droppedValue: 400, netValue: 850 },
    ]);
  });

  it('calculates waiver value lost when drops outweigh adds', () => {
    const transaction = makeTransaction({
      type: 'waiver',
      adds: { p1: 2 },
      drops: { p2: 2, p3: 2 },
      roster_ids: [2],
    });

    expect(calculateTransactionValueChanges(transaction, { p1: 300, p2: 500, p3: 250 })).toEqual([
      { rosterId: 2, addedValue: 300, droppedValue: 750, netValue: -450 },
    ]);
  });

  it('does not calculate free agency values for trades', () => {
    const transaction = makeTransaction({
      type: 'trade',
      roster_ids: [1, 2],
      adds: { p1: 1, p2: 2 },
    });

    expect(calculateTransactionValueChanges(transaction, { p1: 1000, p2: 500 })).toEqual([]);
  });
});
