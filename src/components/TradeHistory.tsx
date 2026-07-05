'use client';

import { useState, useMemo } from 'react';
import { SleeperTransaction, SleeperRoster, SleeperUser, SleeperPlayersMap, TradeValueMap } from '@/lib/types';
import TransactionCard from './TransactionCard';

interface SeasonTradesData {
  season: string;
  leagueId: string;
  trades: SleeperTransaction[];
  users: SleeperUser[];
  rosters: SleeperRoster[];
}

interface TradeHistoryProps {
  seasonTrades: SeasonTradesData[];
  players: SleeperPlayersMap;
  currentSeason: string;
  tradeValues?: TradeValueMap;
}

export default function TradeHistory({ seasonTrades, players, currentSeason, tradeValues }: TradeHistoryProps) {
  // Current season is expanded by default
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set([currentSeason]));
  const [searchTerm, setSearchTerm] = useState('');

  const toggleSeason = (season: string) => {
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(season)) {
        next.delete(season);
      } else {
        next.add(season);
      }
      return next;
    });
  };

  // Check if a trade involves the search term (player name or pick)
  // Filter trades based on search term
  const filteredSeasonTrades = useMemo(() => {
    const tradeMatchesSearch = (trade: SleeperTransaction, term: string): boolean => {
      const lowerTerm = term.toLowerCase();

      // Check players involved (adds and drops)
      const playerIds = [
        ...Object.keys(trade.adds || {}),
        ...Object.keys(trade.drops || {}),
      ];

      for (const playerId of playerIds) {
        const player = players[playerId];
        if (player?.full_name?.toLowerCase().includes(lowerTerm)) {
          return true;
        }
      }

      // Check draft picks
      for (const pick of trade.draft_picks || []) {
        const pickStr = `${pick.season} round ${pick.round}`.toLowerCase();
        const pickStr2 = `${pick.season} ${pick.round}${pick.round === 1 ? 'st' : pick.round === 2 ? 'nd' : pick.round === 3 ? 'rd' : 'th'}`.toLowerCase();
        if (pickStr.includes(lowerTerm) || pickStr2.includes(lowerTerm)) {
          return true;
        }
      }

      return false;
    };

    if (!searchTerm.trim()) {
      return seasonTrades;
    }

    return seasonTrades.map(season => ({
      ...season,
      trades: season.trades.filter(trade => tradeMatchesSearch(trade, searchTerm)),
    })).filter(season => season.trades.length > 0);
  }, [seasonTrades, searchTerm, players]);

  const totalTrades = seasonTrades.reduce((sum, s) => sum + s.trades.length, 0);
  const filteredTotal = filteredSeasonTrades.reduce((sum, s) => sum + s.trades.length, 0);
  const isFiltered = searchTerm.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">
          Trade History {isFiltered ? `(${filteredTotal} of ${totalTrades})` : `(${totalTrades} total)`}
        </h2>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search player or pick..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-64 px-3 py-2 pl-9 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-sleeper-accent"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {isFiltered && filteredSeasonTrades.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="text-gray-400">No trades found matching &ldquo;{searchTerm}&rdquo;</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredSeasonTrades.map(({ season, trades, users, rosters }) => {
          const isExpanded = expandedSeasons.has(season) || isFiltered;
          const isCurrent = season === currentSeason;

          return (
            <div key={season} className="panel overflow-hidden">
              {/* Season Header - Collapsible */}
              <button
                onClick={() => toggleSeason(season)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-lg font-medium text-white">
                    {season} Season
                  </span>
                  {isCurrent && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-sleeper-accent/20 text-sleeper-accent rounded">
                      Current
                    </span>
                  )}
                </div>
                <span className="text-sm text-gray-400">
                  {trades.length} trade{trades.length !== 1 ? 's' : ''}
                </span>
              </button>

              {/* Season Trades - Expandable Content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  {trades.length > 0 ? (
                    trades.map((trade) => (
                      <TransactionCard
                        key={trade.transaction_id}
                        transaction={trade}
                        rosters={rosters}
                        users={users}
                        players={players}
                        tradeValues={tradeValues?.[trade.transaction_id]}
                      />
                    ))
                  ) : (
                    <p className="text-gray-500 text-sm py-4 text-center">
                      No trades this season
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
