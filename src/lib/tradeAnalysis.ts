import {
  SleeperTransaction,
  SleeperRoster,
  SleeperUser,
  SleeperPlayersMap,
  TradeAnalysis,
  TradeGrade,
  TeamReportCard,
  PositionBreakdown,
  TradePartner,
  TradeAssetValue,
  TradePlayer,
  AnalyzedPick,
} from './types';
import { DraftedPlayer } from './sleeper';
import {
  HistoricalValueData,
  getHistoricalPlayerValue,
  getHistoricalPickValue,
  getCurrentPlayerValue,
  getCurrentPickValue,
} from './historicalValues';

// Position baseline values for retired/inactive players (fallback when no historical data)
const POSITION_BASELINES: Record<string, number> = {
  QB: 5000,
  RB: 4000,
  WR: 5000,
  TE: 3500,
  K: 500,
  DEF: 500,
  Unknown: 2000,
};

// Age depreciation factors by position (fallback estimation)
const AGE_FACTORS: Record<string, { peakAge: number; decayRate: number }> = {
  QB: { peakAge: 28, decayRate: 0.05 },
  RB: { peakAge: 25, decayRate: 0.15 },
  WR: { peakAge: 27, decayRate: 0.08 },
  TE: { peakAge: 28, decayRate: 0.07 },
  K: { peakAge: 30, decayRate: 0.03 },
  DEF: { peakAge: 30, decayRate: 0.03 },
  Unknown: { peakAge: 27, decayRate: 0.10 },
};

// Calculate raw score based on average trade performance (grade assigned later via curve)
export function calculateRawScore(avgNetValue: number, totalTrades: number): number {
  if (totalTrades === 0) {
    return 50; // Neutral score for no trades
  }

  // Score based on average net value per trade
  // Each 100 value difference moves the score by ~3 points
  let score = 50 + avgNetValue / 33;
  return Math.max(0, Math.min(100, score));
}

// Assign grade based on percentile rank (curve grading)
function getGradeFromPercentile(percentile: number): TradeGrade {
  // Percentile is 0-100, where 100 = best trader
  if (percentile >= 95) return 'A+';
  if (percentile >= 85) return 'A';
  if (percentile >= 75) return 'A-';
  if (percentile >= 65) return 'B+';
  if (percentile >= 55) return 'B';
  if (percentile >= 45) return 'B-';
  if (percentile >= 35) return 'C+';
  if (percentile >= 25) return 'C';
  if (percentile >= 15) return 'C-';
  if (percentile >= 5) return 'D';
  return 'F';
}

// Apply curve grading to all report cards
function applyGradeCurve(reportCards: TeamReportCard[]): void {
  // Only curve teams that have made trades
  const tradingTeams = reportCards.filter(rc => rc.totalTrades > 0);
  const nonTradingTeams = reportCards.filter(rc => rc.totalTrades === 0);

  if (tradingTeams.length === 0) {
    // No trades, everyone gets C
    for (const rc of reportCards) {
      rc.grade = 'C';
      rc.gradeScore = 50;
    }
    return;
  }

  // Sort by raw score (highest first)
  tradingTeams.sort((a, b) => b.gradeScore - a.gradeScore);

  // Assign grades based on percentile rank
  for (let i = 0; i < tradingTeams.length; i++) {
    const rc = tradingTeams[i];
    // Percentile: 100 = best, 0 = worst
    // For rank i out of n, percentile = ((n - 1 - i) / (n - 1)) * 100
    // This gives the top team 100%, bottom team 0%
    const percentile = tradingTeams.length > 1
      ? ((tradingTeams.length - 1 - i) / (tradingTeams.length - 1)) * 100
      : 50; // Only one trading team gets middle grade

    rc.grade = getGradeFromPercentile(percentile);
  }

  // Non-trading teams get C (neutral)
  for (const rc of nonTradingTeams) {
    rc.grade = 'C';
    rc.gradeScore = 50;
  }
}

// Fallback: Estimate historical value when no data available
function estimateHistoricalValue(
  currentValue: number,
  position: string,
  ageAtTrade: number | null,
  tradeDate: number
): number {
  const now = Date.now();
  const yearsSinceTrade = (now - tradeDate) / (365.25 * 24 * 60 * 60 * 1000);

  const posFactors = AGE_FACTORS[position] || AGE_FACTORS.Unknown;
  const baseline = POSITION_BASELINES[position] || POSITION_BASELINES.Unknown;

  if (currentValue < 100) {
    let historicalValue = baseline;
    if (ageAtTrade !== null) {
      const ageFromPeak = ageAtTrade - posFactors.peakAge;
      if (ageFromPeak > 0) {
        historicalValue *= Math.max(0.3, 1 - (ageFromPeak * posFactors.decayRate));
      } else if (ageFromPeak < -3) {
        historicalValue *= 0.6;
      }
    }
    historicalValue *= Math.max(0.5, 1 - (yearsSinceTrade * 0.05));
    return Math.round(historicalValue);
  }

  if (ageAtTrade === null) {
    return Math.round(currentValue * (1 + yearsSinceTrade * 0.03));
  }

  const currentAge = ageAtTrade + yearsSinceTrade;
  const ageAtTradeFromPeak = ageAtTrade - posFactors.peakAge;
  const currentAgeFromPeak = currentAge - posFactors.peakAge;

  let ageAdjustment = 1;
  if (currentAgeFromPeak > ageAtTradeFromPeak) {
    const agingLoss = (currentAgeFromPeak - Math.max(0, ageAtTradeFromPeak)) * posFactors.decayRate;
    ageAdjustment = 1 + agingLoss;
  } else if (ageAtTradeFromPeak < 0 && currentAgeFromPeak >= 0) {
    ageAdjustment = 0.8;
  }

  const marketAdjustment = 1 + (yearsSinceTrade * 0.02);
  return Math.round(currentValue * ageAdjustment / marketAdjustment);
}

function createAssetValue(historical: number, current: number): TradeAssetValue {
  return {
    historical,
    current,
    average: Math.round((historical + current) / 2),
  };
}

// Build pick ownership chain to track what happened to picks after trades
interface PickOwnershipInfo {
  finalOwnerId: number;
  wasUsedInDraft: boolean;
  draftedPlayer: DraftedPlayer | null;
  tradedAgainBeforeDraft: boolean;
}

function buildPickOwnershipMap(
  allTrades: SleeperTransaction[],
  draftMap: Map<string, DraftedPlayer> | null
): Map<string, PickOwnershipInfo> {
  const pickOwnership = new Map<string, PickOwnershipInfo>();
  const sortedTrades = [...allTrades].sort((a, b) => a.created - b.created);
  const currentPickOwners = new Map<string, number>();

  for (const trade of sortedTrades) {
    if (trade.roster_ids.length > 2) continue;

    for (const pick of trade.draft_picks || []) {
      const pickKey = `${pick.season}_${pick.round}_${pick.roster_id}`;
      const tradeKey = `${pickKey}_${trade.transaction_id}`;

      currentPickOwners.set(pickKey, pick.owner_id);

      const draftKey = `${pick.season}_${pick.round}_${pick.roster_id}`;
      const draftedPlayer = draftMap?.get(draftKey) || null;

      pickOwnership.set(tradeKey, {
        finalOwnerId: pick.owner_id,
        wasUsedInDraft: draftedPlayer !== null,
        draftedPlayer,
        tradedAgainBeforeDraft: false,
      });
    }
  }

  for (const trade of sortedTrades) {
    if (trade.roster_ids.length > 2) continue;

    for (const pick of trade.draft_picks || []) {
      const pickKey = `${pick.season}_${pick.round}_${pick.roster_id}`;
      const tradeKey = `${pickKey}_${trade.transaction_id}`;
      const info = pickOwnership.get(tradeKey);

      if (info) {
        const finalOwner = currentPickOwners.get(pickKey);
        if (finalOwner !== undefined && finalOwner !== pick.owner_id) {
          info.tradedAgainBeforeDraft = true;
        }
      }
    }
  }

  return pickOwnership;
}

function didTeamUsePick(
  rosterId: number,
  pick: { season: string; round: number; roster_id: number },
  tradeId: string,
  pickOwnershipMap: Map<string, PickOwnershipInfo>,
  draftMap: Map<string, DraftedPlayer> | null
): { wasUsed: boolean; draftedPlayer: DraftedPlayer | null } {
  const tradeKey = `${pick.season}_${pick.round}_${pick.roster_id}_${tradeId}`;
  const info = pickOwnershipMap.get(tradeKey);

  if (!info) {
    const draftKey = `${pick.season}_${pick.round}_${pick.roster_id}`;
    const draftedPlayer = draftMap?.get(draftKey) || null;
    if (draftedPlayer && draftedPlayer.rosterId === rosterId) {
      return { wasUsed: true, draftedPlayer };
    }
    return { wasUsed: false, draftedPlayer: null };
  }

  if (info.wasUsedInDraft && info.draftedPlayer?.rosterId === rosterId) {
    return { wasUsed: true, draftedPlayer: info.draftedPlayer };
  }

  if (info.tradedAgainBeforeDraft || info.finalOwnerId !== rosterId) {
    return { wasUsed: false, draftedPlayer: null };
  }

  return { wasUsed: false, draftedPlayer: null };
}

// Get player's age at time of trade
function getAgeAtTrade(player: { age: number | null } | undefined, tradeDate: number): number | null {
  if (!player?.age) return null;
  const now = Date.now();
  const yearsSinceTrade = (now - tradeDate) / (365.25 * 24 * 60 * 60 * 1000);
  return player.age - yearsSinceTrade;
}

// Get pick value with historical data support
function getPickValue(
  pick: { season: string; round: number; roster_id: number },
  tradeId: string,
  rosterId: number,
  tradeDate: number,
  pickValues: Record<string, number>,
  playerValues: Record<string, number>,
  pickOwnershipMap: Map<string, PickOwnershipInfo>,
  draftMap: Map<string, DraftedPlayer> | null,
  historicalData: HistoricalValueData | null,
  playerMapping: Map<string, string> | null
): { value: TradeAssetValue; becamePlayer: DraftedPlayer | null; wasUsedByTeam: boolean } {
  const { wasUsed, draftedPlayer } = didTeamUsePick(
    rosterId,
    pick,
    tradeId,
    pickOwnershipMap,
    draftMap
  );

  // Get generic pick value (fallback)
  const roundLabel = pick.round === 1 ? '1st' : pick.round === 2 ? '2nd' : pick.round === 3 ? '3rd' : '4th';
  const genericPickKey = `${pick.season} ${roundLabel}`;
  const fallbackPickValue = pickValues[genericPickKey] || 0;

  if (wasUsed && draftedPlayer) {
    // Team used the pick - use player's value
    let historicalValue: number | null = null;
    let currentValue: number | null = null;

    if (historicalData && playerMapping) {
      historicalValue = getHistoricalPlayerValue(
        draftedPlayer.playerId,
        tradeDate,
        historicalData,
        playerMapping
      );
      currentValue = getCurrentPlayerValue(
        draftedPlayer.playerId,
        historicalData,
        playerMapping
      );
    }

    // For picks that became players, historical value should be the pick value at trade time
    // Current value should be the player's current value
    const histPickValue = historicalData
      ? getHistoricalPickValue(pick.season, pick.round, tradeDate, historicalData)
      : null;

    const finalHistorical = histPickValue ?? fallbackPickValue;
    const finalCurrent = currentValue ?? playerValues[draftedPlayer.playerId] ?? 0;

    return {
      value: createAssetValue(finalHistorical, finalCurrent),
      becamePlayer: draftedPlayer,
      wasUsedByTeam: true,
    };
  }

  // Team traded the pick away or it hasn't been used yet - use pick values
  let historicalPickValue: number | null = null;
  let currentPickValue: number | null = null;

  if (historicalData) {
    historicalPickValue = getHistoricalPickValue(pick.season, pick.round, tradeDate, historicalData);
    currentPickValue = getCurrentPickValue(pick.season, pick.round, historicalData);
  }

  const finalHistorical = historicalPickValue ?? fallbackPickValue;
  const finalCurrent = currentPickValue ?? fallbackPickValue;

  return {
    value: createAssetValue(finalHistorical, finalCurrent),
    becamePlayer: null,
    wasUsedByTeam: false,
  };
}

// Analyze a single trade for a specific roster
export function analyzeTrade(
  trade: SleeperTransaction,
  rosterId: number,
  players: SleeperPlayersMap,
  playerValues: Record<string, number>,
  pickValues: Record<string, number>,
  pickOwnershipMap: Map<string, PickOwnershipInfo>,
  draftMap: Map<string, DraftedPlayer> | null = null,
  historicalData: HistoricalValueData | null = null,
  playerMapping: Map<string, string> | null = null
): TradeAnalysis | null {
  // Filter out 3+ team trades
  if (trade.roster_ids.length > 2) {
    return null;
  }

  if (!trade.roster_ids.includes(rosterId)) {
    return null;
  }

  const partnerId = trade.roster_ids.find(id => id !== rosterId);
  if (partnerId === undefined) {
    return null;
  }

  const receivedPlayers: TradePlayer[] = [];
  const receivedPicks: AnalyzedPick[] = [];
  let receivedHistorical = 0;
  let receivedCurrent = 0;

  // Players received
  if (trade.adds) {
    for (const [playerId, addRosterId] of Object.entries(trade.adds)) {
      if (addRosterId === rosterId) {
        const player = players[playerId];
        const position = player?.position || 'Unknown';
        const ageAtTrade = getAgeAtTrade(player, trade.created);

        // Try to get historical value from data source
        let historicalValue: number | null = null;
        let currentValue: number | null = null;

        if (historicalData && playerMapping) {
          historicalValue = getHistoricalPlayerValue(playerId, trade.created, historicalData, playerMapping);
          currentValue = getCurrentPlayerValue(playerId, historicalData, playerMapping);
        }

        // Fall back to estimation/current values if no historical data
        const fallbackCurrent = playerValues[playerId] || 0;
        const finalCurrent = currentValue ?? fallbackCurrent;
        const finalHistorical = historicalValue ?? estimateHistoricalValue(
          finalCurrent,
          position,
          ageAtTrade,
          trade.created
        );

        const value = createAssetValue(finalHistorical, finalCurrent);

        receivedPlayers.push({
          id: playerId,
          name: player?.full_name || playerId,
          position,
          value,
          ageAtTrade: ageAtTrade !== null ? Math.round(ageAtTrade * 10) / 10 : undefined,
        });

        receivedHistorical += finalHistorical;
        receivedCurrent += finalCurrent;
      }
    }
  }

  // Picks received
  for (const pick of trade.draft_picks || []) {
    if (pick.owner_id === rosterId && pick.previous_owner_id !== rosterId) {
      const { value, becamePlayer, wasUsedByTeam } = getPickValue(
        pick,
        trade.transaction_id,
        rosterId,
        trade.created,
        pickValues,
        playerValues,
        pickOwnershipMap,
        draftMap,
        historicalData,
        playerMapping
      );

      receivedPicks.push({
        season: pick.season,
        round: pick.round,
        value,
        becamePlayer: becamePlayer?.playerName,
        becamePlayerId: becamePlayer?.playerId,
        wasUsedByTeam,
      });

      receivedHistorical += value.historical;
      receivedCurrent += value.current;
    }
  }

  const givenPlayers: TradePlayer[] = [];
  const givenPicks: AnalyzedPick[] = [];
  let givenHistorical = 0;
  let givenCurrent = 0;

  // Players given
  if (trade.adds) {
    for (const [playerId, addRosterId] of Object.entries(trade.adds)) {
      if (addRosterId === partnerId) {
        const player = players[playerId];
        const position = player?.position || 'Unknown';
        const ageAtTrade = getAgeAtTrade(player, trade.created);

        let historicalValue: number | null = null;
        let currentValue: number | null = null;

        if (historicalData && playerMapping) {
          historicalValue = getHistoricalPlayerValue(playerId, trade.created, historicalData, playerMapping);
          currentValue = getCurrentPlayerValue(playerId, historicalData, playerMapping);
        }

        const fallbackCurrent = playerValues[playerId] || 0;
        const finalCurrent = currentValue ?? fallbackCurrent;
        const finalHistorical = historicalValue ?? estimateHistoricalValue(
          finalCurrent,
          position,
          ageAtTrade,
          trade.created
        );

        const value = createAssetValue(finalHistorical, finalCurrent);

        givenPlayers.push({
          id: playerId,
          name: player?.full_name || playerId,
          position,
          value,
          ageAtTrade: ageAtTrade !== null ? Math.round(ageAtTrade * 10) / 10 : undefined,
        });

        givenHistorical += finalHistorical;
        givenCurrent += finalCurrent;
      }
    }
  }

  // Picks given
  for (const pick of trade.draft_picks || []) {
    if (pick.owner_id === partnerId && pick.previous_owner_id === rosterId) {
      const { value, becamePlayer, wasUsedByTeam } = getPickValue(
        pick,
        trade.transaction_id,
        partnerId,
        trade.created,
        pickValues,
        playerValues,
        pickOwnershipMap,
        draftMap,
        historicalData,
        playerMapping
      );

      givenPicks.push({
        season: pick.season,
        round: pick.round,
        value,
        becamePlayer: becamePlayer?.playerName,
        becamePlayerId: becamePlayer?.playerId,
        wasUsedByTeam,
      });

      givenHistorical += value.historical;
      givenCurrent += value.current;
    }
  }

  const receivedTotal = createAssetValue(receivedHistorical, receivedCurrent);
  const givenTotal = createAssetValue(givenHistorical, givenCurrent);
  const netValue = createAssetValue(
    receivedHistorical - givenHistorical,
    receivedCurrent - givenCurrent
  );

  const maxValue = Math.max(receivedTotal.average, givenTotal.average);
  const percentDiff = maxValue > 0 ? Math.abs(netValue.average) / maxValue * 100 : 0;

  let result: 'win' | 'loss' | 'push';
  if (percentDiff <= 5) {
    result = 'push';
  } else if (netValue.average > 0) {
    result = 'win';
  } else {
    result = 'loss';
  }

  return {
    tradeId: trade.transaction_id,
    date: trade.created,
    partnerId,
    received: {
      players: receivedPlayers,
      picks: receivedPicks,
      totalValue: receivedTotal,
    },
    given: {
      players: givenPlayers,
      picks: givenPicks,
      totalValue: givenTotal,
    },
    netValue,
    result,
  };
}

// Calculate position breakdown from trades
function calculatePositionBreakdown(trades: TradeAnalysis[]): PositionBreakdown[] {
  const positionMap = new Map<string, { received: number; given: number }>();

  for (const trade of trades) {
    for (const player of trade.received.players) {
      const pos = player.position || 'Unknown';
      const current = positionMap.get(pos) || { received: 0, given: 0 };
      current.received += player.value.average;
      positionMap.set(pos, current);
    }

    for (const player of trade.given.players) {
      const pos = player.position || 'Unknown';
      const current = positionMap.get(pos) || { received: 0, given: 0 };
      current.given += player.value.average;
      positionMap.set(pos, current);
    }

    if (trade.received.picks.length > 0 || trade.given.picks.length > 0) {
      const current = positionMap.get('PICK') || { received: 0, given: 0 };
      for (const pick of trade.received.picks) {
        current.received += pick.value.average;
      }
      for (const pick of trade.given.picks) {
        current.given += pick.value.average;
      }
      positionMap.set('PICK', current);
    }
  }

  const breakdown: PositionBreakdown[] = [];
  positionMap.forEach((value, position) => {
    breakdown.push({
      position,
      received: Math.round(value.received),
      given: Math.round(value.given),
      net: Math.round(value.received - value.given),
    });
  });

  breakdown.sort((a, b) => (b.received + b.given) - (a.received + a.given));
  return breakdown;
}

// Calculate trade partners
function calculateTradePartners(
  trades: TradeAnalysis[],
  rosters: SleeperRoster[],
  users: SleeperUser[]
): TradePartner[] {
  const partnerMap = new Map<number, { count: number; netValue: number }>();

  for (const trade of trades) {
    const current = partnerMap.get(trade.partnerId) || { count: 0, netValue: 0 };
    current.count++;
    current.netValue += trade.netValue.average;
    partnerMap.set(trade.partnerId, current);
  }

  const partners: TradePartner[] = [];
  partnerMap.forEach((value, partnerId) => {
    const roster = rosters.find(r => r.roster_id === partnerId);
    const user = roster ? users.find(u => u.user_id === roster.owner_id) : null;
    const teamName = user?.metadata?.team_name || user?.display_name || user?.username || `Team ${partnerId}`;

    partners.push({
      rosterId: partnerId,
      teamName,
      tradeCount: value.count,
      netValue: Math.round(value.netValue),
    });
  });

  partners.sort((a, b) => b.netValue - a.netValue);
  return partners;
}

// Generate report card for a single team
export function generateTeamReportCard(
  rosterId: number,
  allTrades: SleeperTransaction[],
  rosters: SleeperRoster[],
  users: SleeperUser[],
  players: SleeperPlayersMap,
  playerValues: Record<string, number>,
  pickValues: Record<string, number>,
  draftMap: Map<string, DraftedPlayer> | null = null,
  historicalData: HistoricalValueData | null = null,
  playerMapping: Map<string, string> | null = null
): TeamReportCard {
  const roster = rosters.find(r => r.roster_id === rosterId);
  const user = roster ? users.find(u => u.user_id === roster.owner_id) : null;
  const teamName = user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rosterId}`;

  const pickOwnershipMap = buildPickOwnershipMap(allTrades, draftMap);

  const trades: TradeAnalysis[] = [];
  for (const trade of allTrades) {
    const analysis = analyzeTrade(
      trade,
      rosterId,
      players,
      playerValues,
      pickValues,
      pickOwnershipMap,
      draftMap,
      historicalData,
      playerMapping
    );
    if (analysis) {
      trades.push(analysis);
    }
  }

  trades.sort((a, b) => b.date - a.date);

  const wins = trades.filter(t => t.result === 'win').length;
  const losses = trades.filter(t => t.result === 'loss').length;
  const pushes = trades.filter(t => t.result === 'push').length;
  const totalValueGained = trades.reduce((sum, t) => sum + t.netValue.average, 0);

  const sortedByValue = [...trades].sort((a, b) => b.netValue.average - a.netValue.average);
  const bestTrade = sortedByValue.length > 0 ? sortedByValue[0] : null;
  const worstTrade = sortedByValue.length > 0 ? sortedByValue[sortedByValue.length - 1] : null;

  const avgNetValue = trades.length > 0 ? totalValueGained / trades.length : 0;
  const rawScore = calculateRawScore(avgNetValue, trades.length);

  const positionBreakdown = calculatePositionBreakdown(trades);
  const tradePartners = calculateTradePartners(trades, rosters, users);

  return {
    rosterId,
    ownerId: roster?.owner_id || '',
    teamName,
    avatar: user?.avatar || null,
    grade: 'C' as TradeGrade, // Placeholder, will be set by curve
    gradeScore: Math.round(rawScore),
    totalTrades: trades.length,
    wins,
    losses,
    pushes,
    totalValueGained: Math.round(totalValueGained),
    bestTrade,
    worstTrade,
    tradePartners,
    positionBreakdown,
    trades,
  };
}

// Generate report cards for all teams
export function generateAllReportCards(
  allTrades: SleeperTransaction[],
  rosters: SleeperRoster[],
  users: SleeperUser[],
  players: SleeperPlayersMap,
  playerValues: Record<string, number>,
  pickValues: Record<string, number>,
  draftMap: Map<string, DraftedPlayer> | null = null,
  historicalData: HistoricalValueData | null = null,
  playerMapping: Map<string, string> | null = null
): TeamReportCard[] {
  const reportCards: TeamReportCard[] = [];

  for (const roster of rosters) {
    const reportCard = generateTeamReportCard(
      roster.roster_id,
      allTrades,
      rosters,
      users,
      players,
      playerValues,
      pickValues,
      draftMap,
      historicalData,
      playerMapping
    );
    reportCards.push(reportCard);
  }

  // Apply curve grading based on relative performance
  applyGradeCurve(reportCards);

  // Sort by grade score (highest first)
  reportCards.sort((a, b) => b.gradeScore - a.gradeScore);
  return reportCards;
}
