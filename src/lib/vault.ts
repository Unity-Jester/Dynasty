import { SleeperTransaction } from './types';
import { HistoricalValueData } from './historicalValues';
import { DraftedPlayer } from './sleeper';
import { pickRoundLabel } from './utils';

// ---------------------------------------------------------------------------
// The Vault: value time series for trades and franchises, built from the
// historical values sheet (daily snapshots) and the league's own
// transaction log. Everything here stays on the sheet's value scale -
// no mixing with other sources.
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface TradeSideSeries {
  rosterId: number;
  points: SeriesPoint[];
  trackedAssets: number;
  totalAssets: number;
}

export interface VaultTrade {
  tradeId: string;
  date: number; // trade timestamp
  sides: TradeSideSeries[];
  // Gap dynamics between the two largest sides (by final value):
  gapStart: number; // leader's margin at the first sampled date
  gapNow: number; // leader's margin today (negative = flipped)
  swing: number; // gapNow - gapStart from the eventual leader's view
  leaderRosterId: number | null;
}

interface PickAsset {
  kind: 'pick';
  season: string;
  round: number;
  becamePlayerId: string | null;
}

interface PlayerAsset {
  kind: 'player';
  playerId: string;
}

type Asset = PickAsset | PlayerAsset;

// Evenly sample the sheet's date axis (stored newest-first) from a start
// timestamp to the most recent date, ascending, capped to maxPoints.
export function sampleDates(
  datesDesc: string[],
  fromTs: number,
  maxPoints: number = 60
): string[] {
  if (datesDesc.length === 0) return [];
  const fromStr = new Date(fromTs).toISOString().split('T')[0];
  const asc = [...datesDesc].reverse().filter(d => d >= fromStr);
  if (asc.length === 0) {
    // Trade newer than the sheet's last snapshot: use the newest date only
    return [datesDesc[0]];
  }
  if (asc.length <= maxPoints) return asc;
  const step = (asc.length - 1) / (maxPoints - 1);
  const sampled: string[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(asc[Math.round(i * step)]);
  }
  return [...new Set(sampled)];
}

// Value of one asset on one date. Picks value as the drafted player once
// the sheet tracks them, else as the generic pick column, else null.
function assetValueAt(
  dateValues: Map<string, number> | undefined,
  asset: Asset,
  playerMapping: Map<string, string>
): number | null {
  if (!dateValues) return null;

  if (asset.kind === 'player') {
    const col = playerMapping.get(asset.playerId);
    return col ? dateValues.get(col) ?? null : null;
  }

  if (asset.becamePlayerId) {
    const col = playerMapping.get(asset.becamePlayerId);
    const v = col ? dateValues.get(col) : undefined;
    if (v !== undefined) return v;
  }
  // Tier unknown for generic picks; Mid is the neutral bucket
  const pickCol = `${asset.season} Mid ${pickRoundLabel(asset.round)}`;
  return dateValues.get(pickCol) ?? null;
}

function sideAssets(
  trade: SleeperTransaction,
  rosterId: number,
  draftMap: Map<string, DraftedPlayer> | null
): Asset[] {
  const assets: Asset[] = [];
  if (trade.adds) {
    for (const [playerId, addRosterId] of Object.entries(trade.adds)) {
      if (addRosterId === rosterId) assets.push({ kind: 'player', playerId });
    }
  }
  for (const pick of trade.draft_picks || []) {
    if (pick.owner_id === rosterId && pick.previous_owner_id !== rosterId) {
      const drafted = draftMap?.get(`${pick.season}_${pick.round}_${pick.roster_id}`) || null;
      assets.push({
        kind: 'pick',
        season: pick.season,
        round: pick.round,
        becamePlayerId: drafted?.playerId ?? null,
      });
    }
  }
  return assets;
}

// Build the aging series for every trade: one line per side, sampled
// along the sheet's date axis from trade day to today.
export function buildVaultTrades(
  trades: SleeperTransaction[],
  draftMap: Map<string, DraftedPlayer> | null,
  historicalData: HistoricalValueData,
  playerMapping: Map<string, string>,
  maxPoints: number = 60
): VaultTrade[] {
  const result: VaultTrade[] = [];

  for (const trade of trades) {
    if (trade.type !== 'trade') continue;
    const dates = sampleDates(historicalData.dates, trade.created, maxPoints);
    if (dates.length === 0) continue;

    const sides: TradeSideSeries[] = trade.roster_ids.map(rosterId => {
      const assets = sideAssets(trade, rosterId, draftMap);
      let tracked = 0;
      // An asset counts as tracked if it produces a value on any sampled date
      const points = dates.map(date => {
        const dateValues = historicalData.values.get(date);
        let total = 0;
        for (const asset of assets) {
          const v = assetValueAt(dateValues, asset, playerMapping);
          if (v !== null) total += v;
        }
        return { date, value: Math.round(total) };
      });
      for (const asset of assets) {
        const anyValue = dates.some(
          d => assetValueAt(historicalData.values.get(d), asset, playerMapping) !== null
        );
        if (anyValue) tracked++;
      }
      return { rosterId, points, trackedAssets: tracked, totalAssets: assets.length };
    });

    // Gap dynamics between the two most valuable sides at the end
    const ranked = [...sides]
      .filter(s => s.points.length > 0)
      .sort(
        (a, b) => b.points[b.points.length - 1].value - a.points[a.points.length - 1].value
      );
    let gapStart = 0;
    let gapNow = 0;
    let leaderRosterId: number | null = null;
    if (ranked.length >= 2) {
      const [lead, trail] = ranked;
      gapNow = lead.points[lead.points.length - 1].value - trail.points[trail.points.length - 1].value;
      gapStart = lead.points[0].value - trail.points[0].value;
      leaderRosterId = lead.rosterId;
    }

    result.push({
      tradeId: trade.transaction_id,
      date: trade.created,
      sides,
      gapStart,
      gapNow,
      swing: gapNow - gapStart,
      leaderRosterId,
    });
  }

  result.sort((a, b) => b.date - a.date);
  return result;
}

// ---------------------------------------------------------------------------
// Franchise value timelines via backward roster reconstruction
// ---------------------------------------------------------------------------

export interface RosterEvent {
  ts: number;
  playerId: string;
  type: 'add' | 'drop';
}

// Reconstruct a roster's player set at each sample date by walking
// backward from the known current roster, inverting add/drop events.
// Players acquired before recorded history simply persist, which is
// exactly right for imported/startup rosters.
export function reconstructFranchiseSeries(
  currentRoster: string[],
  events: RosterEvent[],
  historicalData: HistoricalValueData,
  playerMapping: Map<string, string>,
  sampleDatesAsc: string[]
): SeriesPoint[] {
  const sorted = [...events].sort((a, b) => b.ts - a.ts); // newest first
  const roster = new Set(currentRoster);

  const valueOf = (date: string): number => {
    const dateValues = historicalData.values.get(date);
    if (!dateValues) return 0;
    let total = 0;
    roster.forEach(playerId => {
      const col = playerMapping.get(playerId);
      if (col) total += dateValues.get(col) || 0;
    });
    return Math.round(total);
  };

  const points: SeriesPoint[] = [];
  let eventIdx = 0;

  // Walk sample dates newest -> oldest, undoing events as we pass them
  for (let i = sampleDatesAsc.length - 1; i >= 0; i--) {
    const date = sampleDatesAsc[i];
    const dateTs = new Date(`${date}T23:59:59Z`).getTime();
    while (eventIdx < sorted.length && sorted[eventIdx].ts > dateTs) {
      const ev = sorted[eventIdx];
      if (ev.type === 'add') roster.delete(ev.playerId);
      else roster.add(ev.playerId);
      eventIdx++;
    }
    points.push({ date, value: valueOf(date) });
  }

  points.reverse();
  return points;
}

// Turn the transaction log + draft results into roster events
export function buildRosterEvents(
  transactions: SleeperTransaction[],
  draftedPlayers: { playerId: string; rosterId: number; ts: number }[]
): Map<number, RosterEvent[]> {
  const events = new Map<number, RosterEvent[]>();
  const push = (rosterId: number, ev: RosterEvent) => {
    const list = events.get(rosterId) || [];
    list.push(ev);
    events.set(rosterId, list);
  };

  for (const tx of transactions) {
    if (tx.status && tx.status !== 'complete') continue;
    if (tx.adds) {
      for (const [playerId, rosterId] of Object.entries(tx.adds)) {
        push(rosterId, { ts: tx.created, playerId, type: 'add' });
      }
    }
    if (tx.drops) {
      for (const [playerId, rosterId] of Object.entries(tx.drops)) {
        push(rosterId, { ts: tx.created, playerId, type: 'drop' });
      }
    }
  }

  for (const d of draftedPlayers) {
    push(d.rosterId, { ts: d.ts, playerId: d.playerId, type: 'add' });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Superlatives
// ---------------------------------------------------------------------------

export interface VaultSuperlatives {
  heist: VaultTrade | null; // biggest swing toward one side since trade day
  photoFinish: VaultTrade | null; // tightest gap today among aged trades
}

export function findSuperlatives(
  trades: VaultTrade[],
  now: number = Date.now(),
  minAgeDays: number = 180
): VaultSuperlatives {
  const chartable = trades.filter(
    t =>
      t.leaderRosterId !== null &&
      t.sides.every(s => s.totalAssets > 0 && s.trackedAssets / s.totalAssets >= 0.5)
  );

  let heist: VaultTrade | null = null;
  for (const t of chartable) {
    if (!heist || Math.abs(t.swing) > Math.abs(heist.swing)) heist = t;
  }

  const aged = chartable.filter(t => now - t.date >= minAgeDays * 24 * 60 * 60 * 1000);
  let photoFinish: VaultTrade | null = null;
  for (const t of aged) {
    if (!photoFinish || Math.abs(t.gapNow) < Math.abs(photoFinish.gapNow)) photoFinish = t;
  }
  // The same trade shouldn't win both plaques
  if (photoFinish && heist && photoFinish.tradeId === heist.tradeId) photoFinish = null;

  return { heist, photoFinish };
}
