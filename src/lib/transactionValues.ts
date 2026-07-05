import {
  SleeperTransaction,
  TeamReportCard,
  TradeValueMap,
  TransactionValueChange,
  TransactionValueChangeMap,
} from './types';

export function buildTradeValueMap(reportCards: TeamReportCard[]): TradeValueMap {
  const tradeValues: TradeValueMap = {};

  for (const card of reportCards) {
    for (const trade of card.trades) {
      (tradeValues[trade.tradeId] ??= []).push({
        rosterId: card.rosterId,
        netAtTrade: trade.netValue.historical,
        netCurrent: trade.netValue.current,
        netAverage: trade.netValue.average,
      });
    }
  }

  return tradeValues;
}

function addValueByRoster(
  totals: Map<number, number>,
  playersByRoster: Record<string, number> | null,
  playerValues: Record<string, number>
) {
  for (const [playerId, rosterId] of Object.entries(playersByRoster || {})) {
    totals.set(rosterId, (totals.get(rosterId) || 0) + (playerValues[playerId] || 0));
  }
}

export function calculateTransactionValueChanges(
  transaction: SleeperTransaction,
  playerValues: Record<string, number>
): TransactionValueChange[] {
  if (transaction.type === 'trade') {
    return [];
  }

  const addedByRoster = new Map<number, number>();
  const droppedByRoster = new Map<number, number>();
  addValueByRoster(addedByRoster, transaction.adds, playerValues);
  addValueByRoster(droppedByRoster, transaction.drops, playerValues);

  const rosterIds = new Set<number>([
    ...transaction.roster_ids,
    ...addedByRoster.keys(),
    ...droppedByRoster.keys(),
  ]);

  return [...rosterIds]
    .map((rosterId) => {
      const addedValue = addedByRoster.get(rosterId) || 0;
      const droppedValue = droppedByRoster.get(rosterId) || 0;
      return {
        rosterId,
        addedValue,
        droppedValue,
        netValue: addedValue - droppedValue,
      };
    })
    .filter(change => change.addedValue !== 0 || change.droppedValue !== 0);
}

export function buildTransactionValueChangeMap(
  transactions: SleeperTransaction[],
  playerValues: Record<string, number>
): TransactionValueChangeMap {
  const values: TransactionValueChangeMap = {};

  for (const transaction of transactions) {
    const changes = calculateTransactionValueChanges(transaction, playerValues);
    if (changes.length > 0) {
      values[transaction.transaction_id] = changes;
    }
  }

  return values;
}
