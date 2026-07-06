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
  SleeperTradedPick,
  PlayoffMatchup,
  TeamInfo,
  MatchupPair,
} from './types';
import { getTeamName } from './utils';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

// Single-entry TTL cache for player data (large ~5MB file)
const playersCache: { value: SleeperPlayersMap | null; time: number } = {
  value: null,
  time: 0,
};
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

export async function getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return fetchSleeper<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`);
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

  if (playersCache.value && (now - playersCache.time) < PLAYERS_CACHE_DURATION) {
    return playersCache.value;
  }

  const players = await fetchSleeper<SleeperPlayersMap>('/players/nfl');
  playersCache.value = players;
  playersCache.time = now;

  return players;
}

// Sleeper user profile (accepts username or user id)
export interface SleeperUserProfile {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
}

export async function getUser(usernameOrId: string): Promise<SleeperUserProfile> {
  return fetchSleeper<SleeperUserProfile>(`/user/${encodeURIComponent(usernameOrId)}`);
}

// All of a user's NFL leagues for a season
export async function getUserLeagues(userId: string, season: string): Promise<SleeperLeague[]> {
  return fetchSleeper<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`);
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
    teamName: getTeamName(user, roster.roster_id),
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
            teamName: getTeamName(user1, roster1.roster_id),
            points: pair[0].points || 0,
            starters: pair[0].starters || [],
            startersPoints: pair[0].starters_points || [],
          },
          team2: {
            roster: roster2,
            user: user2,
            teamName: getTeamName(user2, roster2.roster_id),
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

// Get all transactions for a season (all weeks fetched concurrently)
export async function getAllSeasonTransactions(leagueId: string, maxWeek: number = 18): Promise<SleeperTransaction[]> {
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  const results = await Promise.all(
    weeks.map(week => getLeagueTransactions(leagueId, week).catch(() => [] as SleeperTransaction[]))
  );
  return results.flat();
}

// Build a slimmed players map that is safe to serialize into client
// components. The full Sleeper players payload is ~5MB; client UIs only
// need a handful of fields for active players plus any explicitly
// referenced IDs (rostered players, trade participants, drafted players).
export function buildClientPlayersMap(
  players: SleeperPlayersMap,
  extraIds: Iterable<string> = []
): SleeperPlayersMap {
  const slim: SleeperPlayersMap = {};

  const addPlayer = (id: string) => {
    const p = players[id];
    if (!p || slim[id]) return;
    slim[id] = {
      player_id: id,
      full_name: p.full_name,
      position: p.position,
      team: p.team,
      fantasy_positions: p.fantasy_positions,
      search_rank: p.search_rank,
      age: p.age,
    } as SleeperPlayersMap[string];
  };

  for (const [id, p] of Object.entries(players)) {
    if (p.full_name && p.team && p.fantasy_positions?.length > 0) {
      addPlayer(id);
    }
  }
  for (const id of extraIds) {
    addPlayer(id);
  }

  return slim;
}

// All weeks of matchups for one season, fetched concurrently.
// Index 0 = week 1; failed/missing weeks come back empty.
export async function getSeasonWeeklyMatchups(
  leagueId: string,
  maxWeek: number
): Promise<SleeperMatchup[][]> {
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  return Promise.all(
    weeks.map(week => getLeagueMatchups(leagueId, week).catch(() => [] as SleeperMatchup[]))
  );
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

// Get all trades from all historical seasons. The league chain must be
// walked serially, but each season's data is fetched concurrently.
export async function getAllHistoricalTrades(currentLeagueId: string): Promise<SeasonTrades[]> {
  const leagueChain = await getLeagueHistory(currentLeagueId);

  const seasons = await Promise.all(
    leagueChain.map(async (leagueData): Promise<SeasonTrades | null> => {
      try {
        const [users, rosters, trades] = await Promise.all([
          getLeagueUsers(leagueData.league_id),
          getLeagueRosters(leagueData.league_id),
          getLeagueTrades(leagueData.league_id),
        ]);

        return {
          season: leagueData.season,
          leagueId: leagueData.league_id,
          trades: trades.sort((a, b) => b.created - a.created),
          users,
          rosters,
        };
      } catch {
        return null;
      }
    })
  );

  return seasons.filter((s): s is SeasonTrades => s !== null);
}

// Draft pick to player mapping (what picks became)
export interface DraftedPlayer {
  season: string;
  round: number;
  pick: number;
  rosterId: number;
  playerId: string;
  playerName: string;
}

// Get all draft picks from all historical seasons
export async function getAllHistoricalDrafts(currentLeagueId: string): Promise<Map<string, DraftedPlayer>> {
  // Map key format: "season_round_rosterId" -> DraftedPlayer
  const draftMap = new Map<string, DraftedPlayer>();
  const leagueChain = await getLeagueHistory(currentLeagueId);

  const allDrafts = (
    await Promise.all(
      leagueChain.map(league => getLeagueDrafts(league.league_id).catch(() => [] as SleeperDraft[]))
    )
  ).flat();

  // The league drafts list omits slot_to_roster_id; the draft detail
  // endpoint includes it, and we need it to attribute traded picks.
  const draftsWithPicks = await Promise.all(
    allDrafts.map(async listed => {
      const [draft, picks] = await Promise.all([
        getDraft(listed.draft_id).catch(() => listed),
        getDraftPicks(listed.draft_id).catch(() => [] as SleeperDraftPick[]),
      ]);
      return { draft, picks };
    })
  );

  for (const { draft, picks } of draftsWithPicks) {
    for (const pick of picks) {
      // Trade records reference a pick by its ORIGINAL slot owner, but in
      // draft results roster_id is whoever actually made the pick (the
      // acquirer, when the pick was traded). Resolve the original owner
      // through the draft's slot map so traded picks match up.
      const originalOwner =
        draft.slot_to_roster_id?.[String(pick.draft_slot)] ?? pick.roster_id;
      const key = `${draft.season}_${pick.round}_${originalOwner}`;
      draftMap.set(key, {
        season: draft.season,
        round: pick.round,
        pick: pick.pick_no,
        rosterId: pick.roster_id,
        playerId: pick.player_id,
        playerName: pick.metadata?.first_name && pick.metadata?.last_name
          ? `${pick.metadata.first_name} ${pick.metadata.last_name}`
          : pick.player_id,
      });
    }
  }

  return draftMap;
}

// Get previous league IDs (for history). Ancestor leagues can be deleted
// or inaccessible; the chain extends as far back as Sleeper still serves.
// Only a failure on the requested league itself is an error.
export async function getLeagueHistory(leagueId: string): Promise<SleeperLeague[]> {
  const history: SleeperLeague[] = [];
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId) {
    try {
      const league = await getLeague(currentLeagueId);
      history.push(league);
      currentLeagueId = league.previous_league_id;
    } catch (error) {
      if (history.length === 0) throw error;
      break;
    }
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

  // Walk the league chain once, then fetch each season's rosters and
  // matchup weeks concurrently instead of one request at a time.
  const leagueChain = await getLeagueHistory(currentLeagueId).catch(() => [] as SleeperLeague[]);

  const seasons = await Promise.all(
    leagueChain.map(async league => {
      try {
        const totalWeeks = league.settings.playoff_week_start + 2;
        const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);
        const [rosters, weeklyMatchups] = await Promise.all([
          getLeagueRosters(league.league_id),
          Promise.all(
            weeks.map(week =>
              getLeagueMatchups(league.league_id, week).catch(() => [] as SleeperMatchup[])
            )
          ),
        ]);
        return { rosters, weeklyMatchups };
      } catch {
        return null;
      }
    })
  );

  for (const season of seasons) {
    if (!season) continue;

    // Build roster_id to owner_id map
    const rosterToOwner = new Map<number, string>();
    season.rosters.forEach(r => {
      if (r.owner_id) {
        rosterToOwner.set(r.roster_id, r.owner_id);
      }
    });

    for (const matchups of season.weeklyMatchups) {
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
