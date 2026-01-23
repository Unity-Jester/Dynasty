'use client';

import { useState, useMemo, useCallback } from 'react';
import { SleeperPlayersMap, SleeperRoster, SleeperUser, DraftPickSelection } from '@/lib/types';
import { getPlayerAvatarUrl } from '@/lib/sleeper';
import { getPositionTextColor } from '@/lib/utils';
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

export default function TradeAnalyzer({
  players,
  rosters,
  users,
  playerValues,
  pickValues,
}: TradeAnalyzerProps) {
  const [side1Players, setSide1Players] = useState<SelectedPlayer[]>([]);
  const [side2Players, setSide2Players] = useState<SelectedPlayer[]>([]);
  const [side1Picks, setSide1Picks] = useState<SelectedPick[]>([]);
  const [side2Picks, setSide2Picks] = useState<SelectedPick[]>([]);
  const [search1, setSearch1] = useState('');
  const [search2, setSearch2] = useState('');
  const [showSearch1, setShowSearch1] = useState(false);
  const [showSearch2, setShowSearch2] = useState(false);
  const [showPickSelector1, setShowPickSelector1] = useState(false);
  const [showPickSelector2, setShowPickSelector2] = useState(false);
  const [selectedTeam1, setSelectedTeam1] = useState<number | null>(null);
  const [selectedTeam2, setSelectedTeam2] = useState<number | null>(null);

  const pickOptions = getDraftPickOptions();

  // Build team list for dropdowns
  const teamOptions = useMemo(() => {
    return rosters.map(roster => {
      const user = users.find(u => u.user_id === roster.owner_id);
      const teamName = user?.metadata?.team_name || user?.display_name || user?.username || `Team ${roster.roster_id}`;
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

  const filteredPlayers1 = useMemo(() => {
    if (!search1.trim()) return [];
    const term = search1.toLowerCase();
    return playersList
      .filter(p =>
        p.name.toLowerCase().includes(term) &&
        !side1Players.some(sp => sp.id === p.id) &&
        !side2Players.some(sp => sp.id === p.id)
      )
      .slice(0, 10);
  }, [search1, playersList, side1Players, side2Players]);

  const filteredPlayers2 = useMemo(() => {
    if (!search2.trim()) return [];
    const term = search2.toLowerCase();
    return playersList
      .filter(p =>
        p.name.toLowerCase().includes(term) &&
        !side1Players.some(sp => sp.id === p.id) &&
        !side2Players.some(sp => sp.id === p.id)
      )
      .slice(0, 10);
  }, [search2, playersList, side1Players, side2Players]);

  // Calculate totals
  const side1Total = useMemo(() => {
    const playerTotal = side1Players.reduce((sum, p) => sum + p.value, 0);
    const pickTotal = side1Picks.reduce((sum, p) => sum + p.value, 0);
    return playerTotal + pickTotal;
  }, [side1Players, side1Picks]);

  const side2Total = useMemo(() => {
    const playerTotal = side2Players.reduce((sum, p) => sum + p.value, 0);
    const pickTotal = side2Picks.reduce((sum, p) => sum + p.value, 0);
    return playerTotal + pickTotal;
  }, [side2Players, side2Picks]);

  // Calculate trade
  const tradeCalc = useMemo(() => {
    if (side1Total === 0 && side2Total === 0) return null;

    return calculateTradeValue(
      {
        players: side1Players,
        picks: side1Picks,
        totalValue: side1Total,
      },
      {
        players: side2Players,
        picks: side2Picks,
        totalValue: side2Total,
      }
    );
  }, [side1Players, side2Players, side1Picks, side2Picks, side1Total, side2Total]);

  // Calculate power rankings impact
  const powerRankingsImpact = useMemo(() => {
    if (selectedTeam1 === null || selectedTeam2 === null) return null;
    if (selectedTeam1 === selectedTeam2) return null;

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

    const team1CurrentRank = getCurrentRank(selectedTeam1);
    const team2CurrentRank = getCurrentRank(selectedTeam2);
    const team1CurrentValue = teamValues.get(selectedTeam1) || 0;
    const team2CurrentValue = teamValues.get(selectedTeam2) || 0;

    // Simulate trade
    // Team 1 receives side1 assets and gives side2 assets
    // Team 2 receives side2 assets and gives side1 assets
    const team1NewValue = team1CurrentValue + side1Total - side2Total;
    const team2NewValue = team2CurrentValue + side2Total - side1Total;

    // Create new values map
    const newTeamValues = new Map(teamValues);
    newTeamValues.set(selectedTeam1, team1NewValue);
    newTeamValues.set(selectedTeam2, team2NewValue);

    // Get new rankings
    const getNewRank = (rosterId: number) => {
      const sortedTeams = [...newTeamValues.entries()].sort((a, b) => b[1] - a[1]);
      return sortedTeams.findIndex(([id]) => id === rosterId) + 1;
    };

    const team1NewRank = getNewRank(selectedTeam1);
    const team2NewRank = getNewRank(selectedTeam2);

    return {
      team1: {
        rosterId: selectedTeam1,
        name: teamOptions.find(t => t.rosterId === selectedTeam1)?.teamName || `Team ${selectedTeam1}`,
        oldRank: team1CurrentRank,
        newRank: team1NewRank,
        rankChange: team1CurrentRank - team1NewRank,
        valueChange: side1Total - side2Total,
      },
      team2: {
        rosterId: selectedTeam2,
        name: teamOptions.find(t => t.rosterId === selectedTeam2)?.teamName || `Team ${selectedTeam2}`,
        oldRank: team2CurrentRank,
        newRank: team2NewRank,
        rankChange: team2CurrentRank - team2NewRank,
        valueChange: side2Total - side1Total,
      },
    };
  }, [selectedTeam1, selectedTeam2, rosters, playerValues, side1Total, side2Total, teamOptions]);

  const addPlayer = (side: 1 | 2, player: SelectedPlayer) => {
    if (side === 1) {
      setSide1Players([...side1Players, player]);
      setSearch1('');
      setShowSearch1(false);
    } else {
      setSide2Players([...side2Players, player]);
      setSearch2('');
      setShowSearch2(false);
    }
  };

  const removePlayer = (side: 1 | 2, playerId: string) => {
    if (side === 1) {
      setSide1Players(side1Players.filter(p => p.id !== playerId));
    } else {
      setSide2Players(side2Players.filter(p => p.id !== playerId));
    }
  };

  const addPick = (side: 1 | 2, season: string, round: number) => {
    const pick: DraftPickSelection = {
      season,
      round,
      key: getPickKey({ season, round, key: '' }),
    };
    const value = pickValues[pick.key] || 0;

    if (side === 1) {
      setSide1Picks([...side1Picks, { pick, value }]);
      setShowPickSelector1(false);
    } else {
      setSide2Picks([...side2Picks, { pick, value }]);
      setShowPickSelector2(false);
    }
  };

  const removePick = (side: 1 | 2, index: number) => {
    if (side === 1) {
      setSide1Picks(side1Picks.filter((_, i) => i !== index));
    } else {
      setSide2Picks(side2Picks.filter((_, i) => i !== index));
    }
  };

  const clearAll = () => {
    setSide1Players([]);
    setSide2Players([]);
    setSide1Picks([]);
    setSide2Picks([]);
    setSearch1('');
    setSearch2('');
    setSelectedTeam1(null);
    setSelectedTeam2(null);
  };

  // Format value for display
  const formatValue = (value: number) => {
    return value.toLocaleString();
  };

  // Calculate percentage for bar
  const total = side1Total + side2Total;
  const side1Percent = total > 0 ? (side1Total / total) * 100 : 50;

  return (
    <div className="bg-sleeper-darker rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Trade Calculator</h2>
        {(side1Players.length > 0 || side2Players.length > 0 || side1Picks.length > 0 || side2Picks.length > 0) && (
          <button
            onClick={clearAll}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Team Selection */}
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Select Team A</label>
          <select
            value={selectedTeam1 ?? ''}
            onChange={(e) => setSelectedTeam1(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-sleeper-accent"
          >
            <option value="">-- Select Team --</option>
            {teamOptions.map(team => (
              <option key={team.rosterId} value={team.rosterId} disabled={team.rosterId === selectedTeam2}>
                {team.teamName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Select Team B</label>
          <select
            value={selectedTeam2 ?? ''}
            onChange={(e) => setSelectedTeam2(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-sleeper-accent"
          >
            <option value="">-- Select Team --</option>
            {teamOptions.map(team => (
              <option key={team.rosterId} value={team.rosterId} disabled={team.rosterId === selectedTeam1}>
                {team.teamName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Side 1 - Team A Receives */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">
            {selectedTeam1 !== null
              ? `${teamOptions.find(t => t.rosterId === selectedTeam1)?.teamName} Receives`
              : 'Team A Receives'}
          </h3>

          {/* Selected players */}
          <div className="space-y-2">
            {side1Players.map(player => (
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
                  onClick={() => removePlayer(1, player.id)}
                  className="text-gray-500 hover:text-sleeper-red transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Selected picks */}
            {side1Picks.map((pickItem, idx) => (
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
                  onClick={() => removePick(1, idx)}
                  className="text-gray-500 hover:text-sleeper-red transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Search input */}
          <div className="relative">
            <input
              type="text"
              placeholder="+ Add Player"
              value={search1}
              onChange={(e) => {
                setSearch1(e.target.value);
                setShowSearch1(true);
              }}
              onFocus={() => setShowSearch1(true)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-sleeper-accent"
            />

            {showSearch1 && filteredPlayers1.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredPlayers1.map(player => (
                  <button
                    key={player.id}
                    onClick={() => addPlayer(1, player)}
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
            show={showPickSelector1}
            onToggle={() => setShowPickSelector1(!showPickSelector1)}
            onAdd={(season, round) => addPick(1, season, round)}
            pickOptions={pickOptions}
            pickValues={pickValues}
          />

          {/* Side 1 Total */}
          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Total:</span>
              <span className="text-lg font-bold text-white">{formatValue(side1Total)}</span>
            </div>
          </div>
        </div>

        {/* Side 2 - Team B Receives */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-400">
            {selectedTeam2 !== null
              ? `${teamOptions.find(t => t.rosterId === selectedTeam2)?.teamName} Receives`
              : 'Team B Receives'}
          </h3>

          {/* Selected players */}
          <div className="space-y-2">
            {side2Players.map(player => (
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
                  onClick={() => removePlayer(2, player.id)}
                  className="text-gray-500 hover:text-sleeper-red transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Selected picks */}
            {side2Picks.map((pickItem, idx) => (
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
                  onClick={() => removePick(2, idx)}
                  className="text-gray-500 hover:text-sleeper-red transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Search input */}
          <div className="relative">
            <input
              type="text"
              placeholder="+ Add Player"
              value={search2}
              onChange={(e) => {
                setSearch2(e.target.value);
                setShowSearch2(true);
              }}
              onFocus={() => setShowSearch2(true)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-sleeper-accent"
            />

            {showSearch2 && filteredPlayers2.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {filteredPlayers2.map(player => (
                  <button
                    key={player.id}
                    onClick={() => addPlayer(2, player)}
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
            show={showPickSelector2}
            onToggle={() => setShowPickSelector2(!showPickSelector2)}
            onAdd={(season, round) => addPick(2, season, round)}
            pickOptions={pickOptions}
            pickValues={pickValues}
          />

          {/* Side 2 Total */}
          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Total:</span>
              <span className="text-lg font-bold text-white">{formatValue(side2Total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trade comparison bar and verdict */}
      {(side1Total > 0 || side2Total > 0) && (
        <div className="mt-6 space-y-4">
          {/* Visual comparison bar */}
          <div className="space-y-2">
            <div className="h-6 rounded-full overflow-hidden flex bg-gray-800">
              <div
                className="bg-sleeper-accent transition-all duration-300 flex items-center justify-end pr-2"
                style={{ width: `${side1Percent}%` }}
              >
                {side1Percent >= 15 && (
                  <span className="text-xs font-medium text-black">
                    {side1Percent.toFixed(1)}%
                  </span>
                )}
              </div>
              <div
                className="bg-sleeper-green transition-all duration-300 flex items-center justify-start pl-2"
                style={{ width: `${100 - side1Percent}%` }}
              >
                {(100 - side1Percent) >= 15 && (
                  <span className="text-xs font-medium text-black">
                    {(100 - side1Percent).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Trade verdict */}
          {tradeCalc && (
            <div className={`text-center py-3 rounded-lg ${
              tradeCalc.verdict === 'fair'
                ? 'bg-gray-800'
                : tradeCalc.verdict === 'side1_wins'
                ? 'bg-sleeper-accent/10'
                : 'bg-sleeper-green/10'
            }`}>
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
            </div>
          )}

          {/* Power Rankings Impact */}
          {powerRankingsImpact && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">Power Rankings Impact</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-white">{powerRankingsImpact.team1.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">#{powerRankingsImpact.team1.oldRank}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-white">#{powerRankingsImpact.team1.newRank}</span>
                    {powerRankingsImpact.team1.rankChange !== 0 && (
                      <span className={`text-sm ${
                        powerRankingsImpact.team1.rankChange > 0
                          ? 'text-sleeper-green'
                          : 'text-sleeper-red'
                      }`}>
                        ({powerRankingsImpact.team1.rankChange > 0 ? '↑' : '↓'}
                        {Math.abs(powerRankingsImpact.team1.rankChange)})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white">{powerRankingsImpact.team2.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">#{powerRankingsImpact.team2.oldRank}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-white">#{powerRankingsImpact.team2.newRank}</span>
                    {powerRankingsImpact.team2.rankChange !== 0 && (
                      <span className={`text-sm ${
                        powerRankingsImpact.team2.rankChange > 0
                          ? 'text-sleeper-green'
                          : 'text-sleeper-red'
                      }`}>
                        ({powerRankingsImpact.team2.rankChange > 0 ? '↑' : '↓'}
                        {Math.abs(powerRankingsImpact.team2.rankChange)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
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

  const roundLabel = round === 1 ? '1st' : round === 2 ? '2nd' : round === 3 ? '3rd' : '4th';
  const currentKey = `${season} ${roundLabel}`;
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
