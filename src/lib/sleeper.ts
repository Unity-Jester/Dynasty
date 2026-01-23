import {
  SleeperLeague,
  SleeperUser,
  SleeperRoster,
  SleeperMatchup,
  SleeperTransaction,
  SleeperPlayersMap,
  SleeperNFLState,
  SleeperDraft,
  SleeperDraftPick,
  PlayoffMatchup,
  TeamInfo,
  MatchupPair,
} from './types';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

// Cache for player data (large ~5MB file)
let playersCache: SleeperPlayersMap | null = null;
let playersCacheTime: number = 0;
const PLAYERS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Generic fetch helper
async function fetchSleeper<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${SLEEPER_API_BASE}${endpoint}`, {
    next: { revalidate: 60 }, // Cache for 60 seconds
  });

  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// NFL State
export async function getNFLState(): Promise<SleeperNFLState> {
  return fetchSleeper<SleeperNFLState>('/state/nfl');
}

// League endpoints
export async function getLeague(leagueId: string): Promise<SleeperLeague> {
  return fetchSleeper<SleeperLeague>(`/league/${leagueId}`);
}

export async function getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
  return fetchSleeper<SleeperUser[]>(`/league/${leagueId}/users`);
}

export async function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return fetchSleeper<SleeperRoster[]>(`/league/${leagueId}/rosters`);
}

export async function getLeagueMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  return fetchSleeper<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`);
}

export async function getLeagueTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
  return fetchSleeper<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`);
}

export async function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  return fetchSleeper<SleeperDraft[]>(`/league/${leagueId}/drafts`);
}

export async function getPlayoffBracket(leagueId: string, bracket: 'winners' | 'losers' = 'winners'): Promise<PlayoffMatchup[]> {
  return fetchSleeper<PlayoffMatchup[]>(`/league/${leagueId}/${bracket}_bracket`);
}

// Draft endpoints
export async function getDraft(draftId: string): Promise<SleeperDraft> {
  return fetchSleeper<SleeperDraft>(`/draft/${draftId}`);
}

export async function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  return fetchSleeper<SleeperDraftPick[]>(`/draft/${draftId}/picks`);
}

// Player data (cached)
export async function getAllPlayers(): Promise<SleeperPlayersMap> {
  const now = Date.now();

  if (playersCache && (now - playersCacheTime) < PLAYERS_CACHE_DURATION) {
    return playersCache;
  }

  const players = await fetchSleeper<SleeperPlayersMap>('/players/nfl');
  playersCache = players;
  playersCacheTime = now;

  return players;
}

// Helper function to get user by ID
export function getUserByOwnerId(users: SleeperUser[], ownerId: string): SleeperUser | null {
  return users.find(u => u.user_id === ownerId) || null;
}

// Helper function to build team info
export function buildTeamInfo(
  roster: SleeperRoster,
  users: SleeperUser[]
): TeamInfo {
  const user = getUserByOwnerId(users, roster.owner_id);
  return {
    rosterId: roster.roster_id,
    ownerId: roster.owner_id,
    user,
    roster,
    teamName: user?.metadata?.team_name || user?.display_name || user?.username || `Team ${roster.roster_id}`,
  };
}

// Helper function to pair matchups
export function pairMatchups(
  matchups: SleeperMatchup[],
  rosters: SleeperRoster[],
  users: SleeperUser[]
): MatchupPair[] {
  const matchupMap = new Map<number, SleeperMatchup[]>();

  // Group matchups by matchup_id
  matchups.forEach(m => {
    const existing = matchupMap.get(m.matchup_id) || [];
    existing.push(m);
    matchupMap.set(m.matchup_id, existing);
  });

  const pairs: MatchupPair[] = [];

  matchupMap.forEach((pair, matchupId) => {
    if (pair.length === 2) {
      const roster1 = rosters.find(r => r.roster_id === pair[0].roster_id);
      const roster2 = rosters.find(r => r.roster_id === pair[1].roster_id);

      if (roster1 && roster2) {
        const user1 = getUserByOwnerId(users, roster1.owner_id);
        const user2 = getUserByOwnerId(users, roster2.owner_id);

        pairs.push({
          matchupId,
          team1: {
            roster: roster1,
            user: user1,
            teamName: user1?.display_name || user1?.username || `Team ${roster1.roster_id}`,
            points: pair[0].points || 0,
            starters: pair[0].starters || [],
            startersPoints: pair[0].starters_points || [],
          },
          team2: {
            roster: roster2,
            user: user2,
            teamName: user2?.display_name || user2?.username || `Team ${roster2.roster_id}`,
            points: pair[1].points || 0,
            starters: pair[1].starters || [],
            startersPoints: pair[1].starters_points || [],
          },
        });
      }
    }
  });

  return pairs;
}

// Get all transactions for a season
export async function getAllSeasonTransactions(leagueId: string, maxWeek: number = 18): Promise<SleeperTransaction[]> {
  const allTransactions: SleeperTransaction[] = [];

  for (let week = 1; week <= maxWeek; week++) {
    try {
      const weekTransactions = await getLeagueTransactions(leagueId, week);
      allTransactions.push(...weekTransactions);
    } catch {
      // Week might not exist yet
      break;
    }
  }

  return allTransactions;
}

// Get trades only
export async function getLeagueTrades(leagueId: string, maxWeek: number = 18): Promise<SleeperTransaction[]> {
  const transactions = await getAllSeasonTransactions(leagueId, maxWeek);
  return transactions.filter(t => t.type === 'trade');
}

// Trade history by season
export interface SeasonTrades {
  season: string;
  leagueId: string;
  trades: SleeperTransaction[];
  users: SleeperUser[];
  rosters: SleeperRoster[];
}

// Get all trades from all historical seasons
export async function getAllHistoricalTrades(currentLeagueId: string): Promise<SeasonTrades[]> {
  const allSeasonTrades: SeasonTrades[] = [];
  let currentId: string | null = currentLeagueId;

  while (currentId) {
    try {
      const leagueData = await getLeague(currentId);
      const [users, rosters, trades] = await Promise.all([
        getLeagueUsers(currentId),
        getLeagueRosters(currentId),
        getLeagueTrades(currentId),
      ]);

      allSeasonTrades.push({
        season: leagueData.season,
        leagueId: leagueData.league_id,
        trades: trades.sort((a, b) => b.created - a.created),
        users,
        rosters,
      });

      currentId = leagueData.previous_league_id;
    } catch {
      break;
    }
  }

  return allSeasonTrades;
}

// Get previous league IDs (for history)
export async function getLeagueHistory(leagueId: string): Promise<SleeperLeague[]> {
  const history: SleeperLeague[] = [];
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId) {
    const league = await getLeague(currentLeagueId);
    history.push(league);
    currentLeagueId = league.previous_league_id;
  }

  return history;
}

// Player avatar URL
export function getPlayerAvatarUrl(playerId: string): string {
  return `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;
}

// User avatar URL
export function getUserAvatarUrl(avatarId: string | null): string {
  if (!avatarId) {
    return 'https://sleepercdn.com/images/v2/icons/player_default.webp';
  }
  return `https://sleepercdn.com/avatars/${avatarId}`;
}

// Team logo URL
export function getTeamLogoUrl(team: string): string {
  return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
}

// Sort rosters by standings
export function sortRostersByStandings(rosters: SleeperRoster[]): SleeperRoster[] {
  return [...rosters].sort((a, b) => {
    // First by wins
    const winsDiff = (b.settings.wins || 0) - (a.settings.wins || 0);
    if (winsDiff !== 0) return winsDiff;

    // Then by points for
    const aPoints = (a.settings.fpts || 0) + (a.settings.fpts_decimal || 0) / 100;
    const bPoints = (b.settings.fpts || 0) + (b.settings.fpts_decimal || 0) / 100;
    return bPoints - aPoints;
  });
}

// Format points with decimals
export function formatPoints(fpts: number, fptsDecimal?: number): string {
  const total = fpts + (fptsDecimal || 0) / 100;
  return total.toFixed(2);
}

// Head-to-head record interface
export interface HeadToHeadRecord {
  owner1Wins: number;
  owner2Wins: number;
  ties: number;
  owner1Points: number;
  owner2Points: number;
  matchups: number;
}

// Calculate head-to-head records across all seasons
export async function getHeadToHeadRecords(
  currentLeagueId: string
): Promise<Map<string, HeadToHeadRecord>> {
  const h2hMap = new Map<string, HeadToHeadRecord>();

  // Get all historical league IDs
  const leagueIds: string[] = [];
  let leagueId: string | null = currentLeagueId;

  while (leagueId) {
    leagueIds.push(leagueId);
    try {
      const league = await getLeague(leagueId);
      leagueId = league.previous_league_id;
    } catch {
      break;
    }
  }

  // For each league, get all matchups
  for (const lid of leagueIds) {
    try {
      const [league, rosters] = await Promise.all([
        getLeague(lid),
        getLeagueRosters(lid),
      ]);

      // Build roster_id to owner_id map
      const rosterToOwner = new Map<number, string>();
      rosters.forEach(r => {
        if (r.owner_id) {
          rosterToOwner.set(r.roster_id, r.owner_id);
        }
      });

      // Get matchups for all weeks (regular season + playoffs)
      const totalWeeks = league.settings.playoff_week_start + 2;

      for (let week = 1; week <= totalWeeks; week++) {
        try {
          const matchups = await getLeagueMatchups(lid, week);

          // Group matchups by matchup_id
          const matchupGroups = new Map<number, typeof matchups>();
          matchups.forEach(m => {
            if (m.matchup_id) {
              const group = matchupGroups.get(m.matchup_id) || [];
              group.push(m);
              matchupGroups.set(m.matchup_id, group);
            }
          });

          // Process each matchup
          matchupGroups.forEach(group => {
            if (group.length === 2) {
              const [m1, m2] = group;
              const owner1 = rosterToOwner.get(m1.roster_id);
              const owner2 = rosterToOwner.get(m2.roster_id);

              if (owner1 && owner2 && owner1 !== owner2) {
                // Create consistent key (alphabetically sorted)
                const key = [owner1, owner2].sort().join('_');
                const record = h2hMap.get(key) || {
                  owner1Wins: 0,
                  owner2Wins: 0,
                  ties: 0,
                  owner1Points: 0,
                  owner2Points: 0,
                  matchups: 0,
                };

                const points1 = m1.points || 0;
                const points2 = m2.points || 0;

                // Only count if there are actual points (game was played)
                if (points1 > 0 || points2 > 0) {
                  record.matchups++;

                  // Determine which owner is "owner1" in the sorted key
                  const isOwner1First = [owner1, owner2].sort()[0] === owner1;

                  if (isOwner1First) {
                    record.owner1Points += points1;
                    record.owner2Points += points2;
                    if (points1 > points2) record.owner1Wins++;
                    else if (points2 > points1) record.owner2Wins++;
                    else record.ties++;
                  } else {
                    record.owner1Points += points2;
                    record.owner2Points += points1;
                    if (points2 > points1) record.owner1Wins++;
                    else if (points1 > points2) record.owner2Wins++;
                    else record.ties++;
                  }

                  h2hMap.set(key, record);
                }
              }
            }
          });
        } catch {
          // Week might not exist
          break;
        }
      }
    } catch {
      // League might not be accessible
      continue;
    }
  }

  return h2hMap;
}

// Get H2H record for two specific owners
export function getH2HForOwners(
  h2hMap: Map<string, HeadToHeadRecord>,
  owner1Id: string,
  owner2Id: string
): { wins: number; losses: number; ties: number; isOwner1: boolean } | null {
  const key = [owner1Id, owner2Id].sort().join('_');
  const record = h2hMap.get(key);

  if (!record || record.matchups === 0) {
    return null;
  }

  const isOwner1First = [owner1Id, owner2Id].sort()[0] === owner1Id;

  if (isOwner1First) {
    return {
      wins: record.owner1Wins,
      losses: record.owner2Wins,
      ties: record.ties,
      isOwner1: true,
    };
  } else {
    return {
      wins: record.owner2Wins,
      losses: record.owner1Wins,
      ties: record.ties,
      isOwner1: false,
    };
  }
}
