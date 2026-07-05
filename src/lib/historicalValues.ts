import { SleeperPlayersMap } from './types';
import { parseCSVLine, normalizePlayerName, pickRoundLabel } from './utils';

// Source spreadsheet for historical player/pick values. Overridable so a
// moved or re-shared sheet doesn't require a code change.
const HISTORICAL_VALUES_URL =
  process.env.HISTORICAL_VALUES_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/export?format=csv&gid=991742784';

// Single-entry TTL cache for historical values data
const historicalDataCache: { value: HistoricalValueData | null; time: number } = {
  value: null,
  time: 0,
};
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

export interface HistoricalValueData {
  dates: string[]; // Array of dates in YYYY-MM-DD format (newest first)
  pickColumns: string[]; // Pick column names like "2025 Mid 1st"
  playerColumns: string[]; // Player name columns
  values: Map<string, Map<string, number>>; // date -> (column name -> value)
}

// Parse CSV data into structured format
function parseCSV(csvText: string): HistoricalValueData {
  const lines = csvText.trim().split('\n');
  const headers = parseCSVLine(lines[0]);

  const dates: string[] = [];
  const pickColumns: string[] = [];
  const playerColumns: string[] = [];
  const values = new Map<string, Map<string, number>>();

  // Separate pick columns from player columns
  // Picks are in format "YYYY (Early|Mid|Late) (1st|2nd|3rd|4th)"
  const pickPattern = /^\d{4}\s+(Early|Mid|Late)\s+(1st|2nd|3rd|4th)$/;

  for (let i = 1; i < headers.length; i++) {
    const header = headers[i].trim();
    if (pickPattern.test(header)) {
      pickColumns.push(header);
    } else if (header) {
      playerColumns.push(header);
    }
  }

  // Parse each data row
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const date = row[0]?.trim();
    if (!date) continue;

    dates.push(date);
    const dateValues = new Map<string, number>();

    for (let j = 1; j < headers.length; j++) {
      const header = headers[j].trim();
      const value = row[j]?.trim();
      if (header && value && !isNaN(Number(value))) {
        dateValues.set(header, Number(value));
      }
    }

    values.set(date, dateValues);
  }

  return { dates, pickColumns, playerColumns, values };
}

// Fetch and cache historical values
export async function fetchHistoricalValues(): Promise<HistoricalValueData> {
  const now = Date.now();

  if (historicalDataCache.value && (now - historicalDataCache.time) < CACHE_DURATION) {
    return historicalDataCache.value;
  }

  try {
    const response = await fetch(HISTORICAL_VALUES_URL, {
      next: { revalidate: 21600 }, // Cache for 6 hours
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch historical values: ${response.status}`);
    }

    const csvText = await response.text();
    historicalDataCache.value = parseCSV(csvText);
    historicalDataCache.time = now;

    return historicalDataCache.value;
  } catch (error) {
    console.error('Error fetching historical values:', error);
    // Return empty data structure if fetch fails
    return {
      dates: [],
      pickColumns: [],
      playerColumns: [],
      values: new Map(),
    };
  }
}

// Build a mapping from Sleeper player IDs to historical data column names
export function buildPlayerNameMapping(
  players: SleeperPlayersMap,
  historicalPlayerColumns: string[]
): Map<string, string> {
  const mapping = new Map<string, string>();

  // Create normalized lookup for historical columns
  const normalizedHistorical = new Map<string, string>();
  for (const col of historicalPlayerColumns) {
    normalizedHistorical.set(normalizePlayerName(col), col);
  }

  // Match each Sleeper player to a historical column
  for (const [playerId, player] of Object.entries(players)) {
    if (!player.full_name) continue;

    // normalizePlayerName already strips punctuation, whitespace, and
    // generational suffixes, so a single exact lookup covers the
    // Jr./Sr./apostrophe variations between sources.
    const normalizedName = normalizePlayerName(player.full_name);
    const match = normalizedHistorical.get(normalizedName);
    if (match) {
      mapping.set(playerId, match);
    }
  }

  return mapping;
}

// Find the closest date in the historical data to a given timestamp
export function findClosestDate(
  targetTimestamp: number,
  dates: string[]
): string | null {
  if (dates.length === 0) return null;

  const targetDate = new Date(targetTimestamp);
  const targetStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Binary search for closest date (dates are in reverse chronological order)
  let left = 0;
  let right = dates.length - 1;

  // Check bounds
  if (targetStr >= dates[0]) return dates[0]; // Target is after newest date
  if (targetStr <= dates[right]) return dates[right]; // Target is before oldest date

  // Binary search
  while (left < right - 1) {
    const mid = Math.floor((left + right) / 2);
    if (dates[mid] === targetStr) {
      return dates[mid];
    } else if (dates[mid] > targetStr) {
      left = mid;
    } else {
      right = mid;
    }
  }

  // Return the closer of the two surrounding dates
  const leftDate = new Date(dates[left]);
  const rightDate = new Date(dates[right]);
  const leftDiff = Math.abs(targetDate.getTime() - leftDate.getTime());
  const rightDiff = Math.abs(targetDate.getTime() - rightDate.getTime());

  return leftDiff <= rightDiff ? dates[left] : dates[right];
}

// Get historical value for a player on a specific date
export function getHistoricalPlayerValue(
  playerId: string,
  tradeDate: number,
  historicalData: HistoricalValueData,
  playerMapping: Map<string, string>
): number | null {
  const columnName = playerMapping.get(playerId);
  if (!columnName) return null;

  const closestDate = findClosestDate(tradeDate, historicalData.dates);
  if (!closestDate) return null;

  const dateValues = historicalData.values.get(closestDate);
  if (!dateValues) return null;

  return dateValues.get(columnName) ?? null;
}

// Get historical value for a pick on a specific date
// pickKey format from Sleeper: just round number (1, 2, 3, 4)
// We need to map to historical format: "2025 Mid 1st"
export function getHistoricalPickValue(
  season: string,
  round: number,
  tradeDate: number,
  historicalData: HistoricalValueData,
  tier: 'Early' | 'Mid' | 'Late' = 'Mid' // Default to mid since we don't know draft position
): number | null {
  const columnName = `${season} ${tier} ${pickRoundLabel(round)}`;

  const closestDate = findClosestDate(tradeDate, historicalData.dates);
  if (!closestDate) return null;

  const dateValues = historicalData.values.get(closestDate);
  if (!dateValues) return null;

  return dateValues.get(columnName) ?? null;
}

// Get current value for a player (most recent date)
export function getCurrentPlayerValue(
  playerId: string,
  historicalData: HistoricalValueData,
  playerMapping: Map<string, string>
): number | null {
  if (historicalData.dates.length === 0) return null;

  const columnName = playerMapping.get(playerId);
  if (!columnName) return null;

  // First date is the most recent
  const dateValues = historicalData.values.get(historicalData.dates[0]);
  if (!dateValues) return null;

  return dateValues.get(columnName) ?? null;
}

// Get current value for a pick (most recent date)
export function getCurrentPickValue(
  season: string,
  round: number,
  historicalData: HistoricalValueData,
  tier: 'Early' | 'Mid' | 'Late' = 'Mid'
): number | null {
  if (historicalData.dates.length === 0) return null;

  const columnName = `${season} ${tier} ${pickRoundLabel(round)}`;

  const dateValues = historicalData.values.get(historicalData.dates[0]);
  if (!dateValues) return null;

  return dateValues.get(columnName) ?? null;
}
