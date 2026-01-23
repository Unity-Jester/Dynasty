import { SleeperPlayersMap } from './types';

const HISTORICAL_VALUES_URL = 'https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs/export?format=csv&gid=991742784';

// Cache for historical values data
let historicalDataCache: HistoricalValueData | null = null;
let historicalDataCacheTime: number = 0;
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

// Parse a single CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

// Fetch and cache historical values
export async function fetchHistoricalValues(): Promise<HistoricalValueData> {
  const now = Date.now();

  if (historicalDataCache && (now - historicalDataCacheTime) < CACHE_DURATION) {
    return historicalDataCache;
  }

  try {
    const response = await fetch(HISTORICAL_VALUES_URL, {
      next: { revalidate: 21600 }, // Cache for 6 hours
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch historical values: ${response.status}`);
    }

    const csvText = await response.text();
    historicalDataCache = parseCSV(csvText);
    historicalDataCacheTime = now;

    return historicalDataCache;
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

// Normalize a name for matching (lowercase, remove punctuation, etc.)
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')  // Remove dots and apostrophes
    .replace(/\s+jr$/i, '') // Remove Jr suffix
    .replace(/\s+sr$/i, '') // Remove Sr suffix
    .replace(/\s+ii$/i, '') // Remove II suffix
    .replace(/\s+iii$/i, '') // Remove III suffix
    .replace(/\s+iv$/i, '')  // Remove IV suffix
    .replace(/\s+/g, ' ')   // Normalize whitespace
    .trim();
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
    normalizedHistorical.set(normalizeName(col), col);
  }

  // Match each Sleeper player to a historical column
  for (const [playerId, player] of Object.entries(players)) {
    if (!player.full_name) continue;

    const normalizedName = normalizeName(player.full_name);

    // Try exact match first
    if (normalizedHistorical.has(normalizedName)) {
      mapping.set(playerId, normalizedHistorical.get(normalizedName)!);
      continue;
    }

    // Try without suffix (some names have Jr./Sr. differences)
    const baseName = normalizedName.replace(/\s+(jr|sr|ii|iii|iv)$/i, '').trim();
    if (normalizedHistorical.has(baseName)) {
      mapping.set(playerId, normalizedHistorical.get(baseName)!);
      continue;
    }

    // Try first initial + last name for common nickname issues
    const nameParts = player.full_name.split(' ');
    if (nameParts.length >= 2) {
      const firstInitialLastName = `${nameParts[0][0]}. ${nameParts[nameParts.length - 1]}`;
      const normalizedInitial = normalizeName(firstInitialLastName);
      for (const [normalized, original] of normalizedHistorical) {
        if (normalized.includes(normalizedInitial) || normalizedInitial.includes(normalized)) {
          mapping.set(playerId, original);
          break;
        }
      }
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
  const roundLabel = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : '4th';
  const columnName = `${season} ${tier} ${roundLabel}`;

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

  const roundLabel = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : '4th';
  const columnName = `${season} ${tier} ${roundLabel}`;

  const dateValues = historicalData.values.get(historicalData.dates[0]);
  if (!dateValues) return null;

  return dateValues.get(columnName) ?? null;
}
