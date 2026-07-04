import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getLeagueDrafts,
  getDraftPicks,
  getAllPlayers,
  getUserByOwnerId,
  getUserAvatarUrl,
  getPlayerAvatarUrl,
  getLeagueHistory,
} from '@/lib/sleeper';
import { fetchFantasyCalcValues } from '@/lib/rankings';
import {
  fetchHistoricalValues,
  buildPlayerNameMapping,
  getHistoricalPickValue,
  getCurrentPlayerValue,
  HistoricalValueData,
} from '@/lib/historicalValues';
import { ordinalSuffix, getPositionTextColor, getTeamName } from '@/lib/utils';
import Image from 'next/image';
import { SleeperDraft, SleeperDraftPick, SleeperUser, SleeperRoster, SleeperPlayersMap } from '@/lib/types';
import CollapsibleSection from '@/components/CollapsibleSection';
import ErrorState from '@/components/ErrorState';

export const revalidate = 300; // Revalidate every 5 minutes

interface DraftPickWithValue extends SleeperDraftPick {
  currentValue: number;
  pickValue: number;
  valueDiff: number;
  playerName: string;
}

interface ManagerDraftStats {
  rosterId: number;
  ownerId: string;
  teamName: string;
  avatar: string | null;
  picks: DraftPickWithValue[];
  totalPickValue: number;
  totalCurrentValue: number;
  totalValueDiff: number;
  bestPick: DraftPickWithValue | null;
  worstPick: DraftPickWithValue | null;
  avgValueDiff: number;
}

interface SeasonDraftData {
  season: string;
  draft: SleeperDraft;
  picks: DraftPickWithValue[];
  managerStats: ManagerDraftStats[];
  users: SleeperUser[];
  rosters: SleeperRoster[];
}

interface OverallPickWithSeason extends DraftPickWithValue {
  season: string;
}

interface OverallManagerStats {
  ownerId: string;
  teamName: string;
  avatar: string | null;
  totalPicks: number;
  totalPickValue: number;
  totalCurrentValue: number;
  totalValueDiff: number;
  draftsParticipated: number;
  avgValueDiffPerDraft: number;
  bestPick: OverallPickWithSeason | null;
  worstPick: OverallPickWithSeason | null;
}

// Determine pick tier (early, mid, late) based on position in round
function getPickTier(pickInRound: number, numTeams: number): 'Early' | 'Mid' | 'Late' {
  const third = numTeams / 3;
  if (pickInRound <= third) {
    return 'Early';
  } else if (pickInRound <= third * 2) {
    return 'Mid';
  } else {
    return 'Late';
  }
}

// Fallback pick value estimation (only used when historical data unavailable)
function estimatePickValue(round: number): number {
  const values: Record<number, number> = {
    1: 7000,
    2: 4000,
    3: 2000,
    4: 1000,
    5: 500,
  };
  return values[round] || 250;
}

async function getAllDraftData(currentLeagueId: string): Promise<SeasonDraftData[]> {
  const allDraftData: SeasonDraftData[] = [];
  const leagueChain = await getLeagueHistory(currentLeagueId);

  // Fetch player values and historical data
  const [{ playerValues: fantasyCalcValues }, players, historicalData] = await Promise.all([
    fetchFantasyCalcValues(),
    getAllPlayers(),
    fetchHistoricalValues(),
  ]);

  // Build player name mapping for historical data lookup
  const playerMapping = buildPlayerNameMapping(players, historicalData.playerColumns);

  for (const league of leagueChain) {
    try {
      const [drafts, users, rosters] = await Promise.all([
        getLeagueDrafts(league.league_id),
        getLeagueUsers(league.league_id),
        getLeagueRosters(league.league_id),
      ]);

      for (const draft of drafts) {
        if (draft.status !== 'complete') continue;

        try {
          const picks = await getDraftPicks(draft.draft_id);
          const numTeams = draft.settings.teams || 12;
          const draftTime = draft.start_time || draft.created;

          // Process picks with values from historical data
          const picksWithValues: DraftPickWithValue[] = picks.map(pick => {
            const player = players[pick.player_id];
            const playerName = pick.metadata?.first_name && pick.metadata?.last_name
              ? `${pick.metadata.first_name} ${pick.metadata.last_name}`
              : player?.full_name || pick.player_id;

            // Calculate pick position within round for tier determination
            const pickInRound = ((pick.pick_no - 1) % numTeams) + 1;
            const tier = getPickTier(pickInRound, numTeams);

            // Get pick value at draft time from historical data
            let pickValue = getHistoricalPickValue(
              draft.season,
              pick.round,
              draftTime,
              historicalData,
              tier
            );

            // Fallback to estimate if no historical data
            if (pickValue === null || pickValue === 0) {
              pickValue = estimatePickValue(pick.round);
            }

            // Get current player value - prefer historical data, fallback to FantasyCalc
            let currentValue = getCurrentPlayerValue(
              pick.player_id,
              historicalData,
              playerMapping
            );

            // Fallback to FantasyCalc if no historical data for this player
            if (currentValue === null || currentValue === 0) {
              currentValue = fantasyCalcValues.get(pick.player_id) || 0;
            }

            return {
              ...pick,
              currentValue,
              pickValue,
              valueDiff: currentValue - pickValue,
              playerName,
            };
          });

          // Calculate manager stats
          const managerStatsMap = new Map<number, ManagerDraftStats>();

          for (const pick of picksWithValues) {
            if (!managerStatsMap.has(pick.roster_id)) {
              const roster = rosters.find(r => r.roster_id === pick.roster_id);
              const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;

              managerStatsMap.set(pick.roster_id, {
                rosterId: pick.roster_id,
                ownerId: roster?.owner_id || '',
                teamName: getTeamName(user, pick.roster_id),
                avatar: user?.avatar || null,
                picks: [],
                totalPickValue: 0,
                totalCurrentValue: 0,
                totalValueDiff: 0,
                bestPick: null,
                worstPick: null,
                avgValueDiff: 0,
              });
            }

            const stats = managerStatsMap.get(pick.roster_id)!;
            stats.picks.push(pick);
            stats.totalPickValue += pick.pickValue;
            stats.totalCurrentValue += pick.currentValue;
            stats.totalValueDiff += pick.valueDiff;

            // Track best and worst picks
            if (!stats.bestPick || pick.valueDiff > stats.bestPick.valueDiff) {
              stats.bestPick = pick;
            }
            if (!stats.worstPick || pick.valueDiff < stats.worstPick.valueDiff) {
              stats.worstPick = pick;
            }
          }

          // Calculate averages
          for (const stats of managerStatsMap.values()) {
            stats.avgValueDiff = stats.picks.length > 0 ? stats.totalValueDiff / stats.picks.length : 0;
          }

          const managerStats = Array.from(managerStatsMap.values())
            .sort((a, b) => b.totalValueDiff - a.totalValueDiff);

          allDraftData.push({
            season: draft.season,
            draft,
            picks: picksWithValues,
            managerStats,
            users,
            rosters,
          });
        } catch {
          // Skip drafts without picks
        }
      }
    } catch {
      // Skip inaccessible leagues
    }
  }

  return allDraftData.sort((a, b) => parseInt(b.season) - parseInt(a.season));
}

// Calculate overall stats across all drafts
function calculateOverallStats(draftData: SeasonDraftData[]): OverallManagerStats[] {
  const overallMap = new Map<string, OverallManagerStats>();

  for (const seasonData of draftData) {
    for (const manager of seasonData.managerStats) {
      const existing = overallMap.get(manager.ownerId);

      // Add season to picks for tracking
      const picksWithSeason: OverallPickWithSeason[] = manager.picks.map(p => ({
        ...p,
        season: seasonData.season,
      }));

      if (existing) {
        existing.totalPicks += manager.picks.length;
        existing.totalPickValue += manager.totalPickValue;
        existing.totalCurrentValue += manager.totalCurrentValue;
        existing.totalValueDiff += manager.totalValueDiff;
        existing.draftsParticipated += 1;

        // Update best pick if this one is better
        if (manager.bestPick) {
          const bestWithSeason: OverallPickWithSeason = { ...manager.bestPick, season: seasonData.season };
          if (!existing.bestPick || bestWithSeason.valueDiff > existing.bestPick.valueDiff) {
            existing.bestPick = bestWithSeason;
          }
        }

        // Update worst pick if this one is worse
        if (manager.worstPick) {
          const worstWithSeason: OverallPickWithSeason = { ...manager.worstPick, season: seasonData.season };
          if (!existing.worstPick || worstWithSeason.valueDiff < existing.worstPick.valueDiff) {
            existing.worstPick = worstWithSeason;
          }
        }
      } else {
        overallMap.set(manager.ownerId, {
          ownerId: manager.ownerId,
          teamName: manager.teamName,
          avatar: manager.avatar,
          totalPicks: manager.picks.length,
          totalPickValue: manager.totalPickValue,
          totalCurrentValue: manager.totalCurrentValue,
          totalValueDiff: manager.totalValueDiff,
          draftsParticipated: 1,
          avgValueDiffPerDraft: 0,
          bestPick: manager.bestPick ? { ...manager.bestPick, season: seasonData.season } : null,
          worstPick: manager.worstPick ? { ...manager.worstPick, season: seasonData.season } : null,
        });
      }
    }
  }

  // Calculate averages
  for (const stats of overallMap.values()) {
    stats.avgValueDiffPerDraft = stats.draftsParticipated > 0
      ? stats.totalValueDiff / stats.draftsParticipated
      : 0;
  }

  return Array.from(overallMap.values())
    .sort((a, b) => b.totalValueDiff - a.totalValueDiff);
}

// Get all picks across all drafts with season info
function getAllPicksWithSeason(draftData: SeasonDraftData[]): OverallPickWithSeason[] {
  const allPicks: OverallPickWithSeason[] = [];

  for (const seasonData of draftData) {
    for (const pick of seasonData.picks) {
      allPicks.push({
        ...pick,
        season: seasonData.season,
      });
    }
  }

  return allPicks.sort((a, b) => b.valueDiff - a.valueDiff);
}

function formatValue(value: number): string {
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toString();
}

function getValueColor(diff: number): string {
  if (diff > 2000) return 'text-sleeper-green';
  if (diff > 0) return 'text-green-400';
  if (diff > -2000) return 'text-yellow-400';
  return 'text-sleeper-red';
}

interface LeaguePageProps {
  params: { leagueId: string };
}

export default async function DraftPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

  try {
    const [league, draftData] = await Promise.all([
      getLeague(leagueId),
      getAllDraftData(leagueId),
    ]);

    const mostRecentDraft = draftData[0];
    const overallStats = calculateOverallStats(draftData);

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl text-white">Draft Center</h1>
          <p className="text-gray-400 mt-1">
            {draftData.length} draft{draftData.length !== 1 ? 's' : ''} analyzed
          </p>
        </div>

        {/* Draft Board - Most Recent */}
        {mostRecentDraft && (
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white">
                {mostRecentDraft.season} Draft Board
              </h2>
              <p className="text-sm text-gray-400">
                {mostRecentDraft.draft.type === 'snake' ? 'Snake' : 'Linear'} Draft
              </p>
            </div>
            <div className="p-4 overflow-x-auto">
              <DraftBoard
                picks={mostRecentDraft.picks}
                numTeams={mostRecentDraft.draft.settings.teams}
                numRounds={mostRecentDraft.draft.settings.rounds}
                users={mostRecentDraft.users}
                rosters={mostRecentDraft.rosters}
                draft={mostRecentDraft.draft}
              />
            </div>
          </div>
        )}

        {/* Overall Draft Rankings */}
        {overallStats.length > 0 && (
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white">Overall Draft Rankings</h2>
              <p className="text-sm text-gray-400">
                Combined performance across all {draftData.length} draft{draftData.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {overallStats.map((manager, idx) => (
                <div key={manager.ownerId} className="p-4">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center gap-2 min-w-[80px]">
                      {idx === 0 ? (
                        <span className="text-yellow-400 text-xl" title="Draft King">
                          👑
                        </span>
                      ) : (
                        <span className={`text-lg font-bold w-7 text-center ${
                          idx === 1 ? 'text-gray-300' :
                          idx === 2 ? 'text-amber-600' :
                          'text-gray-500'
                        }`}>
                          {ordinalSuffix(idx + 1)}
                        </span>
                      )}
                      <Image
                        src={getUserAvatarUrl(manager.avatar)}
                        alt={manager.teamName}
                        width={40}
                        height={40}
                        className="rounded-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white truncate">{manager.teamName}</p>
                        {idx === 0 && (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded font-medium">
                            Draft King
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400">
                        {manager.totalPicks} picks across {manager.draftsParticipated} draft{manager.draftsParticipated !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${getValueColor(manager.totalValueDiff)}`}>
                        {manager.totalValueDiff >= 0 ? '+' : ''}{formatValue(manager.totalValueDiff)}
                      </p>
                      <p className="text-xs text-gray-500">Total Value Gained</p>
                    </div>
                  </div>

                  {/* Best and Worst Picks Across All Drafts */}
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Best Pick */}
                    {manager.bestPick && (
                      <div className="bg-gray-800/30 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-2">Best Pick (All-Time)</p>
                        <div className="flex items-center gap-3">
                          <Image
                            src={getPlayerAvatarUrl(manager.bestPick.player_id)}
                            alt={manager.bestPick.playerName}
                            width={36}
                            height={36}
                            className="rounded-full"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate">
                              {manager.bestPick.playerName}
                            </p>
                            <p className="text-xs text-gray-400">
                              {manager.bestPick.season} - Rd {manager.bestPick.round}, Pick {manager.bestPick.pick_no}
                              <span className={`ml-2 ${getPositionTextColor(manager.bestPick.metadata?.position || '')}`}>
                                {manager.bestPick.metadata?.position}
                              </span>
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sleeper-green font-medium">
                              +{formatValue(manager.bestPick.valueDiff)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Worst Pick */}
                    {manager.worstPick && (
                      <div className="bg-gray-800/30 rounded-lg p-3">
                        <p className="text-xs text-gray-500 mb-2">Worst Pick (All-Time)</p>
                        <div className="flex items-center gap-3">
                          <Image
                            src={getPlayerAvatarUrl(manager.worstPick.player_id)}
                            alt={manager.worstPick.playerName}
                            width={36}
                            height={36}
                            className="rounded-full"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium truncate">
                              {manager.worstPick.playerName}
                            </p>
                            <p className="text-xs text-gray-400">
                              {manager.worstPick.season} - Rd {manager.worstPick.round}, Pick {manager.worstPick.pick_no}
                              <span className={`ml-2 ${getPositionTextColor(manager.worstPick.metadata?.position || '')}`}>
                                {manager.worstPick.metadata?.position}
                              </span>
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-medium ${getValueColor(manager.worstPick.valueDiff)}`}>
                              {manager.worstPick.valueDiff >= 0 ? '+' : ''}{formatValue(manager.worstPick.valueDiff)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Draft Rankings by Year - Collapsible */}
        {draftData.map((seasonData) => (
          <CollapsibleSection
            key={seasonData.draft.draft_id}
            title={`${seasonData.season} Draft Rankings`}
            subtitle="Ranked by total value gained (current value - pick value at time)"
            defaultOpen={false}
          >
            {seasonData.managerStats.map((manager, idx) => (
              <div key={manager.rosterId} className="p-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    {idx === 0 ? (
                      <span className="text-yellow-400 text-xl" title="Draft King">
                        👑
                      </span>
                    ) : (
                      <span className={`text-lg font-bold w-7 text-center ${
                        idx === 1 ? 'text-gray-300' :
                        idx === 2 ? 'text-amber-600' :
                        'text-gray-500'
                      }`}>
                        {ordinalSuffix(idx + 1)}
                      </span>
                    )}
                    <Image
                      src={getUserAvatarUrl(manager.avatar)}
                      alt={manager.teamName}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-white">{manager.teamName}</p>
                      {idx === 0 && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded font-medium">
                          Draft King
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">
                      {manager.picks.length} picks
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${getValueColor(manager.totalValueDiff)}`}>
                      {manager.totalValueDiff >= 0 ? '+' : ''}{formatValue(manager.totalValueDiff)}
                    </p>
                    <p className="text-xs text-gray-500">Total Value Gained</p>
                  </div>
                </div>

                {/* Best and Worst Picks */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Best Pick */}
                  {manager.bestPick && (
                    <div className="bg-gray-800/30 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-2">Best Pick</p>
                      <div className="flex items-center gap-3">
                        <Image
                          src={getPlayerAvatarUrl(manager.bestPick.player_id)}
                          alt={manager.bestPick.playerName}
                          width={36}
                          height={36}
                          className="rounded-full"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">
                            {manager.bestPick.playerName}
                          </p>
                          <p className="text-xs text-gray-400">
                            Round {manager.bestPick.round}, Pick {manager.bestPick.pick_no}
                            <span className={`ml-2 ${getPositionTextColor(manager.bestPick.metadata?.position || '')}`}>
                              {manager.bestPick.metadata?.position}
                            </span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sleeper-green font-medium">
                            +{formatValue(manager.bestPick.valueDiff)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Worst Pick */}
                  {manager.worstPick && (
                    <div className="bg-gray-800/30 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-2">Worst Pick</p>
                      <div className="flex items-center gap-3">
                        <Image
                          src={getPlayerAvatarUrl(manager.worstPick.player_id)}
                          alt={manager.worstPick.playerName}
                          width={36}
                          height={36}
                          className="rounded-full"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">
                            {manager.worstPick.playerName}
                          </p>
                          <p className="text-xs text-gray-400">
                            Round {manager.worstPick.round}, Pick {manager.worstPick.pick_no}
                            <span className={`ml-2 ${getPositionTextColor(manager.worstPick.metadata?.position || '')}`}>
                              {manager.worstPick.metadata?.position}
                            </span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-medium ${getValueColor(manager.worstPick.valueDiff)}`}>
                            {manager.worstPick.valueDiff >= 0 ? '+' : ''}{formatValue(manager.worstPick.valueDiff)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        ))}

        {/* Top 30 Picks Across All Years */}
        {draftData.length > 0 && (
          <div className="panel overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h2 className="text-lg font-semibold text-white">
                Top 30 Draft Picks (All-Time)
              </h2>
              <p className="text-sm text-gray-400">
                Best picks across all {draftData.length} draft{draftData.length !== 1 ? 's' : ''} by value gained
              </p>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {getAllPicksWithSeason(draftData)
                .slice(0, 30)
                .map((pick, idx) => {
                  // Find the season data to get team name
                  const seasonData = draftData.find(d => d.season === pick.season);
                  const roster = seasonData?.rosters.find(r => r.roster_id === pick.roster_id);
                  const user = roster && seasonData ? getUserByOwnerId(seasonData.users, roster.owner_id) : null;
                  const teamName = getTeamName(user, pick.roster_id);

                  return (
                    <div key={`${pick.draft_id}-${pick.pick_no}`} className="px-4 py-3 flex items-center gap-4">
                      <span className={`w-8 text-center font-bold ${
                        idx < 3 ? 'text-sleeper-green' : 'text-gray-500'
                      }`}>
                        {idx + 1}
                      </span>
                      <Image
                        src={getPlayerAvatarUrl(pick.player_id)}
                        alt={pick.playerName}
                        width={40}
                        height={40}
                        className="rounded-full"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{pick.playerName}</p>
                        <p className="text-xs text-gray-400">
                          {teamName} - {pick.season} Rd {pick.round}, Pick {pick.pick_no}
                          <span className={`ml-2 ${getPositionTextColor(pick.metadata?.position || '')}`}>
                            {pick.metadata?.position}
                          </span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${getValueColor(pick.valueDiff)}`}>
                          {pick.valueDiff >= 0 ? '+' : ''}{formatValue(pick.valueDiff)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatValue(pick.pickValue)} → {formatValue(pick.currentValue)}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {draftData.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">No completed drafts found</p>
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error('Error loading draft data:', error);
    return <ErrorState title="Error Loading Draft Data" />;
  }
}

// Draft Board Component
function DraftBoard({
  picks,
  numTeams,
  numRounds,
  users,
  rosters,
  draft,
}: {
  picks: DraftPickWithValue[];
  numTeams: number;
  numRounds: number;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  draft: SleeperDraft;
}) {
  // Build team names by slot
  const slotToTeam = new Map<number, string>();

  for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id || {})) {
    const roster = rosters.find(r => r.roster_id === rosterId);
    const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;
    const teamName = getTeamName(user, rosterId);
    slotToTeam.set(parseInt(slot), teamName);
  }

  // Organize picks into grid
  const grid: (DraftPickWithValue | null)[][] = [];
  for (let round = 0; round < numRounds; round++) {
    grid[round] = new Array(numTeams).fill(null);
  }

  for (const pick of picks) {
    const roundIdx = pick.round - 1;
    const slotIdx = pick.draft_slot - 1;
    if (roundIdx >= 0 && roundIdx < numRounds && slotIdx >= 0 && slotIdx < numTeams) {
      grid[roundIdx][slotIdx] = pick;
    }
  }

  return (
    <div className="min-w-max">
      {/* Header Row - Team Names */}
      <div className="flex gap-1 mb-2">
        <div className="w-16 shrink-0" /> {/* Round label column */}
        {Array.from({ length: numTeams }, (_, i) => (
          <div
            key={i}
            className="w-28 shrink-0 text-center text-xs text-gray-400 font-medium truncate px-1"
            title={slotToTeam.get(i + 1) || `Slot ${i + 1}`}
          >
            {slotToTeam.get(i + 1) || `Slot ${i + 1}`}
          </div>
        ))}
      </div>

      {/* Draft Grid */}
      {grid.map((row, roundIdx) => (
        <div key={roundIdx} className="flex gap-1 mb-1">
          <div className="w-16 shrink-0 flex items-center justify-center text-sm text-gray-500 font-medium">
            Rd {roundIdx + 1}
          </div>
          {row.map((pick, slotIdx) => (
            <div
              key={slotIdx}
              className={`w-28 shrink-0 p-1.5 rounded text-xs ${
                pick ? 'bg-gray-800/50' : 'bg-gray-900/30'
              }`}
            >
              {pick ? (
                <div className="space-y-0.5">
                  <p className="text-white font-medium truncate text-[11px]" title={pick.playerName}>
                    {pick.playerName}
                  </p>
                  <div className="flex justify-between items-center">
                    <span className={`${getPositionTextColor(pick.metadata?.position || '')} text-[10px]`}>
                      {pick.metadata?.position}
                    </span>
                    <span className={`${getValueColor(pick.valueDiff)} text-[10px] font-medium`}>
                      {pick.valueDiff >= 0 ? '+' : ''}{formatValue(pick.valueDiff)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="h-8 flex items-center justify-center text-gray-600">
                  -
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
