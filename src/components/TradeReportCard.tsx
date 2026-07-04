'use client';

import { useState } from 'react';
import { TeamReportCard, TradeAnalysis, TradeAssetValue, AnalyzedPick } from '@/lib/types';
import { getUserAvatarUrl } from '@/lib/sleeper';
import Image from 'next/image';

interface TradeReportCardProps {
  reportCards: TeamReportCard[];
}

// Grade color mapping
function getGradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-sleeper-green';
  if (grade.startsWith('B')) return 'text-blue-400';
  if (grade.startsWith('C')) return 'text-yellow-400';
  if (grade === 'D') return 'text-orange-400';
  return 'text-sleeper-red';
}

function getGradeBgColor(grade: string): string {
  if (grade.startsWith('A')) return 'bg-sleeper-green/20';
  if (grade.startsWith('B')) return 'bg-blue-400/20';
  if (grade.startsWith('C')) return 'bg-yellow-400/20';
  if (grade === 'D') return 'bg-orange-400/20';
  return 'bg-sleeper-red/20';
}

// Format value with + or - sign
function formatValue(value: number): string {
  const formatted = Math.abs(value).toLocaleString();
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

// Format combined value display (avg of historical / current)
function formatCombinedValue(value: TradeAssetValue): { main: string; detail: string } {
  const main = formatValue(value.average);
  const histStr = formatValue(value.historical);
  const currStr = formatValue(value.current);
  const detail = `${histStr} trade / ${currStr} current`;
  return { main, detail };
}

// Format date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format pick display with what it became
function formatPick(pick: AnalyzedPick): string {
  const roundLabel = `${pick.season} ${pick.round}${pick.round === 1 ? 'st' : pick.round === 2 ? 'nd' : pick.round === 3 ? 'rd' : 'th'}`;
  if (pick.wasUsedByTeam && pick.becamePlayer) {
    return `${roundLabel} (${pick.becamePlayer})`;
  }
  return roundLabel;
}

// Trade summary component with combined value display
function TradeSummary({ trade, label }: { trade: TradeAnalysis; label: string }) {
  const receivedNames = [
    ...trade.received.players.map(p => p.name),
    ...trade.received.picks.map(p => formatPick(p)),
  ];
  const givenNames = [
    ...trade.given.players.map(p => p.name),
    ...trade.given.picks.map(p => formatPick(p)),
  ];

  const { main, detail } = formatCombinedValue(trade.netValue);

  return (
    <div className="text-xs">
      <p className="text-gray-500 mb-1">{label}</p>
      <div className="bg-gray-800/50 rounded p-2">
        <p className="text-gray-400">
          <span className="text-sleeper-green">Got:</span>{' '}
          <span className="text-white">{receivedNames.join(', ') || 'Nothing'}</span>
        </p>
        <p className="text-gray-400">
          <span className="text-sleeper-red">Gave:</span>{' '}
          <span className="text-white">{givenNames.join(', ') || 'Nothing'}</span>
        </p>
        <div className="mt-1">
          <span className={trade.netValue.average >= 0 ? 'text-sleeper-green' : 'text-sleeper-red'}>
            {main} value
          </span>
          <span className="text-gray-600 ml-2">• {formatDate(trade.date)}</span>
        </div>
        <p className="text-gray-600 text-[10px] mt-0.5">
          ({detail})
        </p>
      </div>
    </div>
  );
}

// Individual report card component
function ReportCard({ card, rank }: { card: TeamReportCard; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  const winRate = card.totalTrades > 0
    ? Math.round((card.wins / card.totalTrades) * 100)
    : 0;

  return (
    <div className="panel overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-4 flex items-center gap-4 hover:bg-gray-800/30 transition-colors"
      >
        {/* Rank */}
        <span className="text-2xl font-bold text-gray-600 w-8">#{rank}</span>

        {/* Avatar */}
        <Image
          src={getUserAvatarUrl(card.avatar)}
          alt={card.teamName}
          width={48}
          height={48}
          className="rounded-full"
        />

        {/* Team Info */}
        <div className="flex-1 text-left">
          <p className="font-semibold text-white">{card.teamName}</p>
          <p className="text-sm text-gray-400">
            {card.totalTrades} trade{card.totalTrades !== 1 ? 's' : ''}
            {card.totalTrades > 0 && (
              <span className="ml-2">
                • {card.wins}W-{card.losses}L-{card.pushes}P
              </span>
            )}
          </p>
        </div>

        {/* Net Value */}
        <div className="text-right mr-4">
          <p className={`text-lg font-semibold ${card.totalValueGained >= 0 ? 'text-sleeper-green' : 'text-sleeper-red'}`}>
            {formatValue(card.totalValueGained)}
          </p>
          <p className="text-xs text-gray-500">avg net value</p>
        </div>

        {/* Grade */}
        <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${getGradeBgColor(card.grade)}`}>
          <span className={`text-3xl font-bold ${getGradeColor(card.grade)}`}>
            {card.grade}
          </span>
        </div>

        {/* Expand indicator */}
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded Details */}
      {expanded && card.totalTrades > 0 && (
        <div className="px-4 pb-4 border-t border-gray-800">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            {/* Win Rate */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Win Rate</p>
              <p className="text-2xl font-bold text-white">{winRate}%</p>
              <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sleeper-green"
                  style={{ width: `${winRate}%` }}
                />
              </div>
            </div>

            {/* Best Trade */}
            {card.bestTrade && card.bestTrade.netValue.average > 0 && (
              <div className="bg-gray-800/50 rounded-lg p-3">
                <TradeSummary trade={card.bestTrade} label="Best Trade" />
              </div>
            )}

            {/* Worst Trade */}
            {card.worstTrade && card.worstTrade.netValue.average < 0 && (
              <div className="bg-gray-800/50 rounded-lg p-3">
                <TradeSummary trade={card.worstTrade} label="Worst Trade" />
              </div>
            )}

            {/* Top Trade Partner */}
            {card.tradePartners.length > 0 && (
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Top Trade Partner</p>
                <p className="text-white font-medium">{card.tradePartners[0].teamName}</p>
                <p className="text-sm text-gray-400">
                  {card.tradePartners[0].tradeCount} trade{card.tradePartners[0].tradeCount !== 1 ? 's' : ''}
                  <span className={`ml-2 ${card.tradePartners[0].netValue >= 0 ? 'text-sleeper-green' : 'text-sleeper-red'}`}>
                    ({formatValue(card.tradePartners[0].netValue)})
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Position Breakdown */}
          {card.positionBreakdown.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-400 mb-2">Position Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                {card.positionBreakdown.map(pos => (
                  <div key={pos.position} className="bg-gray-800/50 rounded p-2 text-center">
                    <p className="text-xs text-gray-500">{pos.position}</p>
                    <p className={`text-sm font-semibold ${pos.net >= 0 ? 'text-sleeper-green' : 'text-sleeper-red'}`}>
                      {formatValue(pos.net)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trade Partners */}
          {card.tradePartners.length > 1 && (
            <div className="mt-4">
              <p className="text-sm text-gray-400 mb-2">All Trade Partners</p>
              <div className="flex flex-wrap gap-2">
                {card.tradePartners.map(partner => (
                  <div
                    key={partner.rosterId}
                    className="bg-gray-800/50 rounded px-3 py-1 text-sm"
                  >
                    <span className="text-white">{partner.teamName}</span>
                    <span className="text-gray-500 ml-1">({partner.tradeCount})</span>
                    <span className={`ml-1 ${partner.netValue >= 0 ? 'text-sleeper-green' : 'text-sleeper-red'}`}>
                      {formatValue(partner.netValue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No trades message */}
      {expanded && card.totalTrades === 0 && (
        <div className="px-4 pb-4 border-t border-gray-800">
          <p className="text-gray-500 text-center py-4">No trades to analyze</p>
        </div>
      )}
    </div>
  );
}

export default function TradeReportCards({ reportCards }: TradeReportCardProps) {
  const [showAll, setShowAll] = useState(false);

  const displayedCards = showAll ? reportCards : reportCards.slice(0, 5);
  const hasMore = reportCards.length > 5;

  // Calculate league-wide stats
  const totalTrades = reportCards.reduce((sum, c) => sum + c.totalTrades, 0) / 2; // Divide by 2 since each trade involves 2 teams
  const avgGrade = reportCards.length > 0
    ? Math.round(reportCards.reduce((sum, c) => sum + c.gradeScore, 0) / reportCards.length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Trade Report Cards</h2>
          <p className="text-sm text-gray-400">
            {Math.round(totalTrades)} total trades • League avg: {avgGrade} pts
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Values shown are averages of estimated trade-time value and current value
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {displayedCards.map((card, index) => (
          <ReportCard key={card.rosterId} card={card} rank={index + 1} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-sm text-sleeper-accent hover:text-white transition-colors"
        >
          {showAll ? 'Show Less' : `Show All ${reportCards.length} Teams`}
        </button>
      )}
    </div>
  );
}
