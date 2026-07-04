'use client';

import { useState, useMemo, useCallback } from 'react';
import { SleeperPlayersMap, SleeperRoster, SleeperUser, DraftPickSelection } from '@/lib/types';
import { getPlayerAvatarUrl } from '@/lib/sleeper';
import { getPositionTextColor, getTeamName, pickRoundLabel } from '@/lib/utils';
import { getDraftPickOptions, getPickKey, calculateTradeValue } from '@/lib/rankings';
import Image from 'next/image';

interface TradeAnalyzerProps {
  players: SleeperPlayersMap;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  playerValues: Record<string, number>;
  pickValues: Record<string, number>;
}

interface SelectedPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  value: number;
}

interface SelectedPick {
  pick: DraftPickSelection;
  value: number;
}

interface TradeSideState {
  players: SelectedPlayer[];
  picks: SelectedPick[];
  search: string;
  showSearch: boolean;
  showPickSelector: boolean;
  selectedTeam: number | null;
}

const createEmptySide = (): TradeSideState => ({
  players: [],
  picks: [],
  search: '',
  showSearch: false,
  showPickSelector: false,
  selectedTeam: null,
});

const TEAM_LABELS = ['A', 'B', 'C'];
const TEAM_COLORS = ['sleeper-accent', 'sleeper-green', 'purple-500'];

export default function TradeAnalyzer({
  players,
  rosters,
  users,
  playerValues,
  pickValues,
}: TradeAnalyzerProps) {
  const [sides, setSides] = useState<TradeSideState[]>([
    createEmptySide(),
    createEmptySide(),
  ]);

  const pickOptions = getDraftPickOptions();

  // Build team list for dropdowns
  const teamOptions = useMemo(() => {
    return rosters.map(roster => {
      const user = users.find(u => u.user_id === roster.owner_id);
      const teamName = getTeamName(user, roster.roster_id);
      return {
        rosterId: roster.roster_id,
        teamName,
        user,
      };
    }).sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [rosters, users]);

  const playersList = useMemo(() => {
    return Object.entries(players)
      .filter(([, p]) => p.fantasy_positions?.length > 0 && p.team && p.full_name)
      .map(([id, p]) => ({
        id,
        name: p.full_name || '',
        position: p.position || '',
        team: p.team || 'FA',
        searchRank: p.search_rank || 9999,
        value: playerValues[id] || 0,
      }))
      .sort((a, b) => a.searchRank - b.searchRank);
  }, [players, playerValues]);

  // Get all selected player IDs across all sides
  const allSelectedPlayerIds = useMemo(() => {
    return sides.flatMap(s => s.players.map(p => p.id));
  }, [sides]);

  // Get all selected team IDs
  const allSelectedTeamIds = useMemo(() => {
    return sides.map(s => s.selectedTeam).filter((id): id is number => id !== null);
  }, [sides]);

  // Get filtered players for a specific side
  const getFilteredPlayers = useCallback((sideIndex: number) => {
    const searchTerm = sides[sideIndex].search.toLowerCase();
    if (!searchTerm.trim()) return [];

    return playersList
      .filter(p =>
        p.name.toLowerCase().includes(searchTerm) &&
        !allSelectedPlayerIds.includes(p.id)
      )
      .slice(0, 10);
  }, [sides, playersList, allSelectedPlayerIds]);

  // Calculate totals for each side
  const sideTotals = useMemo(() => {
    return sides.map(side => {
      const playerTotal = side.players.reduce((sum, p) => sum + p.value, 0);
      const pickTotal = side.picks.reduce((sum, p) => sum + p.value, 0);
      return playerTotal + pickTotal;
    });
  }, [sides]);

  // Determine which sides have assets (for partial population handling)
  const populatedSideIndices = useMemo(() => {
    return sides
      .map((side, idx) => ({ idx, hasAssets: side.players.length > 0 || side.picks.length > 0 }))
      .filter(s => s.hasAssets)
      .map(s => s.idx);
  }, [sides]);

  // Calculate trade for populated sides
  const tradeCalc = useMemo(() => {
    if (populatedSideIndices.length < 2) return null;

    // For 2 populated teams, use existing calculation
    if (populatedSideIndices.length === 2) {
      const [idx1, idx2] = populatedSideIndices;
      return calculateTradeValue(
        {
          players: sides[idx1].players,
          picks: sides[idx1].picks,
          totalValue: sideTotals[idx1],
        },
        {
          players: sides[idx2].players,
          picks: sides[idx2].picks,
          totalValue: sideTotals[idx2],
        }
      );
    }

    // For 3 populated teams, custom calculation
    const total = populatedSideIndices.reduce((sum, idx) => sum + sideTotals[idx], 0);
    const average = total / populatedSideIndices.length;
    const maxDeviation = Math.max(...populatedSideIndices.map(idx => Math.abs(sideTotals[idx] - average)));
    const deviationPercent = average > 0 ? (maxDeviation / average) * 100 : 0;

    // Balanced if within 10% of average
    const isBalanced = deviationPercent <= 10;

    return {
      isThreeTeam: true,
      isBalanced,
      deviationPercent,
      average,
      total,
      sideValues: populatedSideIndices.map(idx => ({
        index: idx,
        value: sideTotals[idx],
        deviation: sideTotals[idx] - average,
        deviationPercent: average > 0 ? ((sideTotals[idx] - average) / average) * 100 : 0,
      })),
    };
  }, [sides, sideTotals, populatedSideIndices]);

  // Calculate power rankings impact
  const powerRankingsImpact = useMemo(() => {
    // Need at least 2 teams selected with assets
    const teamsWithAssets = populatedSideIndices
      .filter(idx => sides[idx].selectedTeam !== null)
      .map(idx => ({ sideIndex: idx, teamId: sides[idx].selectedTeam! }));

    if (teamsWithAssets.length < 2) return null;

    // Check for duplicate teams
    const uniqueTeamIds = new Set(teamsWithAssets.map(t => t.teamId));
    if (uniqueTeamIds.size !== teamsWithAssets.length) return null;

    // Calculate current team values
    const teamValues = new Map<number, number>();
    for (const roster of rosters) {
      let total = 0;
      for (const playerId of roster.players || []) {
        total += playerValues[playerId] || 0;
      }
      teamValues.set(roster.roster_id, total);
    }

    // Get current rankings
    const getCurrentRank = (rosterId: number) => {
      const sortedTeams = [...teamValues.entries()].sort((a, b) => b[1] - a[1]);
      return sortedTeams.findIndex(([id]) => id === rosterId) + 1;
    };

    // For each team, calculate what they gain and lose
    // In a multi-team trade, each team receives the assets on their side
    // and gives up assets to be distributed to other teams

    // Calculate net value change for each team
    // Team at sideIndex receives sideTotals[sideIndex] and gives up sum of other sides' totals / (numTeams - 1)
    // Actually, in multi-team trades it's simpler: each team receives what's in their column
    // The total value coming to them minus total value going from them

    // Simpler model: assume the trade is balanced where each team ends up with their side's value
    // The value change is: what they receive (their side total) - their proportional contribution to other sides
    // For simplicity, we'll calculate based on the idea that the "give" side is distributed

    // Actually, let's think about this differently:
    // In a 2-team trade: Team A receives side1 and gives up side2, Team B receives side2 and gives up side1
    // In a 3-team trade: Each team receives their side's assets
    // The value change for each team is: sideTotal[their side] - (sum of other sides / numOtherTeams * their share)
    // This gets complicated. Let's use a simpler model:
    // Value change = their side's total - average of all sides (what a "fair" contribution would be)

    const numTeams = teamsWithAssets.length;
    const totalValue = teamsWithAssets.reduce((sum, t) => sum + sideTotals[t.sideIndex], 0);
    const avgValue = totalValue / numTeams;

    // Create new values map with trade impact
    const newTeamValues = new Map(teamValues);
    for (const { sideIndex, teamId } of teamsWithAssets) {
      const currentValue = teamValues.get(teamId) || 0;
      const valueChange = sideTotals[sideIndex] - avgValue;
      newTeamValues.set(teamId, currentValue + valueChange);
    }

    // Get new rankings
    const getNewRank = (rosterId: number) => {
      const sortedTeams = [...newTeamValues.entries()].sort((a, b) => b[1] - a[1]);
      return sortedTeams.findIndex(([id]) => id === rosterId) + 1;
    };

    return teamsWithAssets.map(({ sideIndex, teamId }) => {
      const oldRank = getCurrentRank(teamId);
      const newRank = getNewRank(teamId);
      return {
        sideIndex,
        rosterId: teamId,
        name: teamOptions.find(t => t.rosterId === teamId)?.teamName || `Team ${teamId}`,
        oldRank,
        newRank,
        rankChange: oldRank - newRank,
        valueChange: sideTotals[sideIndex] - avgValue,
      };
    });
  }, [sides, sideTotals, populatedSideIndices, rosters, playerValues, teamOptions]);

  // Handler functions
  const updateSide = useCallback((sideIndex: number, updates: Partial<TradeSideState>) => {
    setSides(prev => prev.map((side, idx) =>
      idx === sideIndex ? { ...side, ...updates } : side
    ));
  }, []);

  const addPlayer = useCallback((sideIndex: number, player: SelectedPlayer) => {
    setSides(prev => prev.map((side, idx) =>
      idx === sideIndex
        ? { ...side, players: [...side.players, player], search: '', showSearch: false }
        : side
    ));
  }, []);

  const removePlayer = useCallback((sideIndex: number, playerId: string) => {
    setSides(prev => prev.map((side, idx) =>
      idx === sideIndex
        ? { ...side, players: side.players.filter(p => p.id !== playerId) }
        : side
    ));
  }, []);

  const addPick = useCallback((sideIndex: number, season: string, round: number) => {
    const pick: DraftPickSelection = {
      season,
      round,
      key: getPickKey({ season, round, key: '' }),
    };
    const value = pickValues[pick.key] || 0;

    setSides(prev => prev.map((side, idx) =>
      idx === sideIndex
        ? { ...side, picks: [...side.picks, { pick, value }], showPickSelector: false }
        : side
    ));
  }, [pickValues]);

  const removePick = useCallback((sideIndex: number, pickIndex: number) => {
    setSides(prev => prev.map((side, idx) =>
      idx === sideIndex
        ? { ...side, picks: side.picks.filter((_, i) => i !== pickIndex) }
        : side
    ));
  }, []);

  const addTeamC = useCallback(() => {
    if (sides.length < 3) {
      setSides(prev => [...prev, createEmptySide()]);
    }
  }, [sides.length]);

  const removeTeamC = useCallback(() => {
    if (sides.length === 3) {
      setSides(prev => prev.slice(0, 2));
    }
  }, [sides.length]);

  const clearAll = useCallback(() => {
    setSides([createEmptySide(), createEmptySide()]);
  }, []);

  // Format value for display
  const formatValue = (value: number) => {
    return value.toLocaleString();
  };

  // Check if there are any assets
  const hasAnyAssets = sides.some(s => s.players.length > 0 || s.picks.length > 0);

  // Calculate percentages for bar display
  const totalValue = sideTotals.reduce((sum, val) => sum + val, 0);
  const sidePercents = totalValue > 0
    ? sideTotals.map(val => (val / totalValue) * 100)
    : sides.map(() => 100 / sides.length);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Trade Calculator</h2>
        <div className="flex items-center gap-3">
          {sides.length === 2 && (
            <button
              onClick={addTeamC}
              className="text-sm text-sleeper-accent hover:text-sleeper-accent/80 transition-colors"
            >
              + Add Team C
            </button>
          )}
          {hasAnyAssets && (
            <button
              onClick={clearAll}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Team Selection */}
      <div className={`grid gap-4 mb-4 ${sides.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {sides.map((side, idx) => (
          <div key={idx}>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">
                Select Team {TEAM_LABELS[idx]}
              </label>
              {idx === 2 && (
                <button
                  onClick={removeTeamC}
                  className="text-xs text-gray-500 hover:text-sleeper-red transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <select
              value={side.selectedTeam ?? ''}
              onChange={(e) => updateSide(idx, { selectedTeam: e.target.value ? Number(e.target.value) : null })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-sleeper-accent"
            >
              <option value="">-- Select Team --</option>
              {teamOptions.map(team => (
                <option
                  key={team.rosterId}
                  value={team.rosterId}
                  disabled={allSelectedTeamIds.includes(team.rosterId) && side.selectedTeam !== team.rosterId}
                >
                  {team.teamName}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className={`grid gap-4 ${sides.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {sides.map((side, sideIndex) => (
          <TradeSide
            key={sideIndex}
            sideIndex={sideIndex}
            side={side}
            sideTotal={sideTotals[sideIndex]}
            teamLabel={TEAM_LABELS[sideIndex]}
            teamOptions={teamOptions}
            filteredPlayers={getFilteredPlayers(sideIndex)}
            pickOptions={pickOptions}
            pickValues={pickValues}
            onUpdateSide={updateSide}
            onAddPlayer={addPlayer}
            onRemovePlayer={removePlayer}
            onAddPick={addPick}
            onRemovePick={removePick}
            formatValue={formatValue}
          />
        ))}
      </div>

      {/* Trade comparison bar and verdict */}
      {(totalValue > 0 || populatedSideIndices.length >= 2) && (
        <div className="mt-6 space-y-4">
          {/* Visual comparison bar */}
          {totalValue > 0 && (
            <div className="space-y-2">
              <div className="h-6 rounded-full overflow-hidden flex bg-gray-800">
                {sides.map((_, idx) => {
                  const percent = sidePercents[idx];
                  const bgColor = idx === 0 ? 'bg-sleeper-accent' : idx === 1 ? 'bg-sleeper-green' : 'bg-purple-500';
                  return (
                    <div
                      key={idx}
                      className={`${bgColor} transition-all duration-300 flex items-center justify-center`}
                      style={{ width: `${percent}%` }}
                    >
                      {percent >= 15 && (
                        <span className="text-xs font-medium text-black">
                          {percent.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {sides.length === 3 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-sleeper-accent"></span> Team A
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-sleeper-green"></span> Team B
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500"></span> Team C
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Trade verdict */}
          {tradeCalc && (
            <div className={`text-center py-3 rounded-lg ${
              'isThreeTeam' in tradeCalc
                ? tradeCalc.isBalanced ? 'bg-gray-800' : 'bg-yellow-500/10'
                : tradeCalc.verdict === 'fair'
                  ? 'bg-gray-800'
                  : tradeCalc.verdict === 'side1_wins'
                    ? 'bg-sleeper-accent/10'
                    : 'bg-sleeper-green/10'
            }`}>
              {'isThreeTeam' in tradeCalc ? (
                <>
                  <p className={`text-lg font-semibold ${
                    tradeCalc.isBalanced ? 'text-white' : 'text-yellow-400'
                  }`}>
                    {tradeCalc.isBalanced ? 'Balanced Trade' : 'Imbalanced Trade'}
                  </p>
                  {!tradeCalc.isBalanced && (
                    <div className="text-sm text-gray-400 mt-1">
                      {tradeCalc.sideValues.map(sv => {
                        const label = TEAM_LABELS[sv.index];
                        const teamName = sides[sv.index].selectedTeam !== null
                          ? teamOptions.find(t => t.rosterId === sides[sv.index].selectedTeam)?.teamName
                          : `Team ${label}`;
                        const diff = sv.deviation;
                        if (Math.abs(diff) < tradeCalc.average * 0.05) return null;
                        return (
                          <span key={sv.index} className="block">
                            {teamName}: {diff > 0 ? '+' : ''}{formatValue(Math.round(diff))} ({diff > 0 ? 'over' : 'under'} average)
                          </span>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className={`text-lg font-semibold ${
                    tradeCalc.verdict === 'fair'
                      ? 'text-white'
                      : tradeCalc.verdict === 'side1_wins'
                        ? 'text-sleeper-accent'
                        : 'text-sleeper-green'
                  }`}>
                    {tradeCalc.verdictText}
                  </p>
                  {tradeCalc.verdict !== 'fair' && (
                    <p className="text-sm text-gray-400">
                      {formatValue(tradeCalc.valueDiff)} value difference
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Power Rankings Impact */}
          {powerRankingsImpact && powerRankingsImpact.length >= 2 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Power Rankings Impact</h3>
              <div className={`grid gap-4 ${powerRankingsImpact.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                {powerRankingsImpact.map((team) => (
                  <div key={team.rosterId} className="flex items-center justify-between">
                    <span className="text-white truncate mr-2">{team.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-gray-400">#{team.oldRank}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-white">#{team.newRank}</span>
                      {team.rankChange !== 0 && (
                        <span className={`text-sm ${
                          team.rankChange > 0
                            ? 'text-sleeper-green'
                            : 'text-sleeper-red'
                        }`}>
                          ({team.rankChange > 0 ? '↑' : '↓'}
                          {Math.abs(team.rankChange)})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Trade Side Component
interface TradeSideProps {
  sideIndex: number;
  side: TradeSideState;
  sideTotal: number;
  teamLabel: string;
  teamOptions: { rosterId: number; teamName: string }[];
  filteredPlayers: { id: string; name: string; position: string; team: string; value: number }[];
  pickOptions: ReturnType<typeof getDraftPickOptions>;
  pickValues: Record<string, number>;
  onUpdateSide: (sideIndex: number, updates: Partial<TradeSideState>) => void;
  onAddPlayer: (sideIndex: number, player: SelectedPlayer) => void;
  onRemovePlayer: (sideIndex: number, playerId: string) => void;
  onAddPick: (sideIndex: number, season: string, round: number) => void;
  onRemovePick: (sideIndex: number, pickIndex: number) => void;
  formatValue: (value: number) => string;
}

function TradeSide({
  sideIndex,
  side,
  sideTotal,
  teamLabel,
  teamOptions,
  filteredPlayers,
  pickOptions,
  pickValues,
  onUpdateSide,
  onAddPlayer,
  onRemovePlayer,
  onAddPick,
  onRemovePick,
  formatValue,
}: TradeSideProps) {
  const teamName = side.selectedTeam !== null
    ? teamOptions.find(t => t.rosterId === side.selectedTeam)?.teamName
    : null;

  const hasNoAssets = side.players.length === 0 && side.picks.length === 0;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-400">
        {teamName ? `${teamName} Receives` : `Team ${teamLabel} Receives`}
      </h3>

      {/* Selected players and picks */}
      <div className="space-y-2">
        {side.players.map(player => (
          <div
            key={player.id}
            className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg"
          >
            <Image
              src={getPlayerAvatarUrl(player.id)}
              alt={player.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{player.name}</p>
              <p className={`text-xs ${getPositionTextColor(player.position)}`}>
                {player.position} - {player.team}
              </p>
            </div>
            <span className="text-sm text-sleeper-accent font-medium">
              {formatValue(player.value)}
            </span>
            <button
              onClick={() => onRemovePlayer(sideIndex, player.id)}
              className="text-gray-500 hover:text-sleeper-red transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Selected picks */}
        {side.picks.map((pickItem, idx) => (
          <div
            key={`pick-${idx}`}
            className="flex items-center gap-2 p-2 bg-gray-800/50 rounded-lg"
          >
            <div className="w-8 h-8 rounded-full bg-sleeper-accent/20 flex items-center justify-center">
              <span className="text-sleeper-accent text-xs font-bold">
                {pickItem.pick.round}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">{pickItem.pick.key}</p>
              <p className="text-xs text-gray-400">Draft Pick</p>
            </div>
            <span className="text-sm text-sleeper-accent font-medium">
              {formatValue(pickItem.value)}
            </span>
            <button
              onClick={() => onRemovePick(sideIndex, idx)}
              className="text-gray-500 hover:text-sleeper-red transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}

        {/* Empty state placeholder for 3-team mode */}
        {hasNoAssets && (
          <div className="p-4 bg-gray-800/30 rounded-lg border border-dashed border-gray-700">
            <p className="text-xs text-gray-500 text-center">
              Add players or picks to include in trade
            </p>
          </div>
        )}
      </div>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="+ Add Player"
          value={side.search}
          onChange={(e) => {
            onUpdateSide(sideIndex, { search: e.target.value, showSearch: true });
          }}
          onFocus={() => onUpdateSide(sideIndex, { showSearch: true })}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-sleeper-accent"
        />

        {side.showSearch && filteredPlayers.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filteredPlayers.map(player => (
              <button
                key={player.id}
                onClick={() => onAddPlayer(sideIndex, player)}
                className="w-full flex items-center gap-2 p-2 hover:bg-gray-700 transition-colors text-left"
              >
                <Image
                  src={getPlayerAvatarUrl(player.id)}
                  alt={player.name}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span className="text-sm text-white flex-1">{player.name}</span>
                <span className={`text-xs ${getPositionTextColor(player.position)}`}>
                  {player.position}
                </span>
                <span className="text-xs text-gray-500">{player.team}</span>
                <span className="text-xs text-sleeper-accent">{formatValue(player.value)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pick selector */}
      <PickSelector
        show={side.showPickSelector}
        onToggle={() => onUpdateSide(sideIndex, { showPickSelector: !side.showPickSelector })}
        onAdd={(season, round) => onAddPick(sideIndex, season, round)}
        pickOptions={pickOptions}
        pickValues={pickValues}
      />

      {/* Side Total */}
      <div className="pt-2 border-t border-gray-700">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">Total:</span>
          <span className="text-lg font-bold text-white">{formatValue(sideTotal)}</span>
        </div>
      </div>
    </div>
  );
}

// Pick Selector Component
interface PickSelectorProps {
  show: boolean;
  onToggle: () => void;
  onAdd: (season: string, round: number) => void;
  pickOptions: ReturnType<typeof getDraftPickOptions>;
  pickValues: Record<string, number>;
}

function PickSelector({ show, onToggle, onAdd, pickOptions, pickValues }: PickSelectorProps) {
  const [season, setSeason] = useState(pickOptions.seasons[0]);
  const [round, setRound] = useState(1);

  const currentKey = `${season} ${pickRoundLabel(round)}`;
  const currentValue = pickValues[currentKey] || 0;

  const handleAdd = () => {
    onAdd(season, round);
  };

  if (!show) {
    return (
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 border-dashed rounded-lg text-gray-500 text-sm hover:border-sleeper-accent hover:text-sleeper-accent transition-colors"
      >
        + Add Pick
      </button>
    );
  }

  return (
    <div className="p-3 bg-gray-800 border border-gray-700 rounded-lg space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Year</label>
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-sleeper-accent"
          >
            {pickOptions.seasons.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Round</label>
          <select
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
            className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-sleeper-accent"
          >
            {pickOptions.rounds.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          {currentKey}: <span className="text-sleeper-accent">{currentValue.toLocaleString()}</span>
        </span>
        <div className="flex gap-2">
          <button
            onClick={onToggle}
            className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            className="px-3 py-1 bg-sleeper-accent text-black text-sm font-medium rounded hover:bg-sleeper-accent/80 transition-colors"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
