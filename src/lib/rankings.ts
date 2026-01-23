// Power Rankings from external sources
import { FantasyCalcSettings, DraftPickSelection, TradeCalculation, TradeSide } from './types';

export interface TeamPowerRanking {
  rank: number;
  rosterId: number;
  teamName: string;
  totalValue: number;
  topPlayers: { name: string; value: number }[];
}

export interface FantasyCalcPlayer {
  player: {
    id: number;
    name: string;
    sleeperId: string;
    position: string;
    maybeTeam: string;
  };
  value: number;
  overallRank: number;
  positionRank: number;
}

export interface FantasyCalcValues {
  playerValues: Map<string, number>;
  pickValues: Map<string, number>;  // Key format: "2025 Mid 1st"
}

// Fetch FantasyCalc dynasty player values with configurable settings
export async function fetchFantasyCalcValues(
  settings?: Partial<FantasyCalcSettings>
): Promise<FantasyCalcValues> {
  const numQbs = settings?.numQbs || 1;
  const numTeams = settings?.numTeams || 12;
  const ppr = settings?.ppr ?? 1;

  try {
    const response = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=${numTeams}&ppr=${ppr}`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch FantasyCalc values');
    }

    const data: FantasyCalcPlayer[] = await response.json();
    const playerValues = new Map<string, number>();
    const pickValues = new Map<string, number>();

    for (const item of data) {
      // Check if it's a draft pick first (by name pattern or position)
      if (item.player?.name && isPickName(item.player.name)) {
        // Draft picks - stored by their FantasyCalc name format
        pickValues.set(item.player.name, item.value || 0);
      } else if (item.player?.sleeperId) {
        // Regular players
        playerValues.set(item.player.sleeperId, item.value || 0);
      }
    }

    return { playerValues, pickValues };
  } catch (error) {
    console.error('Error fetching FantasyCalc values:', error);
    return { playerValues: new Map(), pickValues: new Map() };
  }
}

// Check if a name is a draft pick (e.g., "2026 1st" or "2026 Pick 1.01")
function isPickName(name: string): boolean {
  return /^\d{4}\s+(1st|2nd|3rd|4th|Pick\s+\d+\.\d+)$/i.test(name);
}

// Generate a pick key that matches FantasyCalc format (e.g., "2026 1st")
export function getPickKey(pick: DraftPickSelection): string {
  const roundSuffix = pick.round === 1 ? '1st' : pick.round === 2 ? '2nd' : pick.round === 3 ? '3rd' : '4th';
  return `${pick.season} ${roundSuffix}`;
}

// Get available draft pick options
export function getDraftPickOptions(): {
  seasons: string[];
  rounds: { value: number; label: string }[];
} {
  const currentYear = new Date().getFullYear();
  return {
    seasons: [
      currentYear.toString(),
      (currentYear + 1).toString(),
      (currentYear + 2).toString(),
    ],
    rounds: [
      { value: 1, label: '1st' },
      { value: 2, label: '2nd' },
      { value: 3, label: '3rd' },
      { value: 4, label: '4th' },
    ],
  };
}

// Calculate trade value and verdict
export function calculateTradeValue(
  side1: TradeSide,
  side2: TradeSide
): TradeCalculation {
  const total1 = side1.totalValue;
  const total2 = side2.totalValue;
  const maxValue = Math.max(total1, total2);
  const valueDiff = Math.abs(total1 - total2);
  const percentDiff = maxValue > 0 ? (valueDiff / maxValue) * 100 : 0;

  let verdict: 'fair' | 'side1_wins' | 'side2_wins';
  let verdictText: string;

  if (percentDiff <= 5) {
    verdict = 'fair';
    verdictText = 'Fair Trade';
  } else if (total1 > total2) {
    verdict = 'side1_wins';
    verdictText = `Team A wins by ~${Math.round(percentDiff)}%`;
  } else {
    verdict = 'side2_wins';
    verdictText = `Team B wins by ~${Math.round(percentDiff)}%`;
  }

  return {
    side1,
    side2,
    percentDiff,
    verdict,
    verdictText,
    valueDiff,
  };
}

// Fetch DynastyProcess values (aggregated from multiple sources)
export async function fetchDynastyProcessValues(): Promise<Map<string, number>> {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv',
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch DynastyProcess values');
    }

    const csvText = await response.text();
    const lines = csvText.split('\n');

    // Parse CSV - format: "player","pos","team","age","draft_year","ecr_1qb","ecr_2qb","ecr_pos","value_1qb","value_2qb","scrape_date","fp_id"
    const valueMap = new Map<string, number>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Parse CSV with quoted fields
      const fields = parseCSVLine(line);
      if (fields.length >= 9) {
        const playerName = fields[0];
        const value = parseInt(fields[8]) || 0; // value_1qb column

        if (playerName && value > 0) {
          // Store by normalized player name for matching
          valueMap.set(normalizePlayerName(playerName), value);
        }
      }
    }

    return valueMap;
  } catch (error) {
    console.error('Error fetching DynastyProcess values:', error);
    return new Map();
  }
}

// Parse a CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);

  return fields;
}

// Normalize player name for matching
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, '') // Remove non-letters
    .replace(/iii$/g, '')   // Remove III suffix
    .replace(/ii$/g, '')    // Remove II suffix
    .replace(/jr$/g, '')    // Remove Jr suffix
    .replace(/sr$/g, '');   // Remove Sr suffix
}

// Calculate team power rankings
export function calculatePowerRankings(
  rosters: { roster_id: number; owner_id: string; players: string[] | null }[],
  users: { user_id: string; display_name: string; username: string }[],
  playerValues: Map<string, number> | null | undefined,
  playerNames: Map<string, string>,
  matchByName: boolean = false
): TeamPowerRanking[] {
  const rankings: TeamPowerRanking[] = [];
  const safePlayerValues = playerValues || new Map<string, number>();

  for (const roster of rosters) {
    const user = users.find(u => u.user_id === roster.owner_id);
    const teamName = user?.display_name || user?.username || `Team ${roster.roster_id}`;

    let totalValue = 0;
    const playerValueList: { id: string; name: string; value: number }[] = [];

    for (const playerId of roster.players || []) {
      const fullName = playerNames.get(playerId) || '';

      let value = 0;
      if (matchByName && fullName) {
        // Match by normalized player name
        value = safePlayerValues.get(normalizePlayerName(fullName)) || 0;
      } else {
        // Match by Sleeper ID
        value = safePlayerValues.get(playerId) || 0;
      }

      totalValue += value;
      if (value > 0) {
        playerValueList.push({
          id: playerId,
          name: fullName || playerId,
          value,
        });
      }
    }

    // Sort by value and get top 3
    playerValueList.sort((a, b) => b.value - a.value);
    const topPlayers = playerValueList.slice(0, 3).map(p => ({
      name: p.name,
      value: p.value,
    }));

    rankings.push({
      rank: 0,
      rosterId: roster.roster_id,
      teamName,
      totalValue,
      topPlayers,
    });
  }

  // Sort by total value and assign rankings
  rankings.sort((a, b) => b.totalValue - a.totalValue);
  rankings.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  return rankings;
}
