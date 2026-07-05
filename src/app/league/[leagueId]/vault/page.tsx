import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getAllPlayers,
  getAllHistoricalTrades,
  getAllHistoricalDrafts,
  getAllSeasonTransactions,
  getLeagueHistory,
  getLeagueDrafts,
  getDraftPicks,
  getUserByOwnerId,
} from '@/lib/sleeper';
import { fetchHistoricalValues, buildPlayerNameMapping } from '@/lib/historicalValues';
import { fetchFantasyCalcValues } from '@/lib/rankings';
import {
  buildVaultTrades,
  estimateScaleFactor,
  buildRosterEvents,
  reconstructFranchiseSeries,
  findSuperlatives,
  sampleDates,
  SeriesPoint,
  VaultTrade,
} from '@/lib/vault';
import { getTeamName, formatDate, abbreviateNumber, truncateName } from '@/lib/utils';
import ErrorState from '@/components/ErrorState';

export const revalidate = 3600; // history moves slowly

interface LeaguePageProps {
  params: { leagueId: string };
}

const SIDE_COLORS = ['#d4b26a', '#8e8a7e', '#c084fc'];

// ---------------------------------------------------------------------------
// Server-rendered charts
// ---------------------------------------------------------------------------

function scale(points: SeriesPoint[][], w: number, h: number, pad: number) {
  const all = points.flat();
  const min = Math.min(...all.map(p => p.value), 0);
  const max = Math.max(...all.map(p => p.value), 1);
  const n = Math.max(...points.map(s => s.length), 2);
  const x = (i: number, len: number) => pad + (i / Math.max(len - 1, 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  return { x, y, n };
}

function TradeAgingChart({ trade, names }: { trade: VaultTrade; names: Map<number, string> }) {
  const sides = trade.sides.filter(s => s.points.length > 1);
  if (sides.length < 2) return null;
  const W = 340;
  const H = 130;
  const { x, y } = scale(sides.map(s => s.points), W, H, 10);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trade value over time">
      {sides.map((side, i) => {
        const color = SIDE_COLORS[i % SIDE_COLORS.length];
        const d = side.points
          .map((p, j) => `${j === 0 ? 'M' : 'L'}${x(j, side.points.length).toFixed(1)},${y(p.value).toFixed(1)}`)
          .join(' ');
        const last = side.points[side.points.length - 1];
        return (
          <g key={side.rosterId}>
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            <circle
              cx={x(side.points.length - 1, side.points.length)}
              cy={y(last.value)}
              r="3.5"
              fill={color}
            >
              <title>{`${names.get(side.rosterId) || side.rosterId}: ${last.value.toLocaleString()} today`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

function FranchiseSparkline({ points }: { points: SeriesPoint[] }) {
  if (points.length < 2) return null;
  const W = 300;
  const H = 72;
  const { x, y } = scale([points], W, H, 6);
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i, points.length).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(points.length - 1, points.length).toFixed(1)},${H - 6} L${x(0, points.length).toFixed(1)},${H - 6} Z`;

  let peakIdx = 0;
  points.forEach((p, i) => {
    if (p.value > points[peakIdx].value) peakIdx = i;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Franchise value over time">
      <path d={area} fill="rgba(212,178,106,0.10)" />
      <path d={line} fill="none" stroke="#d4b26a" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx={x(peakIdx, points.length)} cy={y(points[peakIdx].value)} r="3" fill="#eddcae">
        <title>{`Peak: ${points[peakIdx].value.toLocaleString()} on ${points[peakIdx].date}`}</title>
      </circle>
    </svg>
  );
}

// ---------------------------------------------------------------------------

function coverageBadge(trade: VaultTrade): string | null {
  const total = trade.sides.reduce((s, side) => s + side.totalAssets, 0);
  const tracked = trade.sides.reduce((s, side) => s + side.trackedAssets, 0);
  if (total === 0 || tracked === total) return null;
  return `${tracked}/${total} assets tracked`;
}

function isChartable(trade: VaultTrade): boolean {
  return (
    trade.sides.filter(s => s.points.length > 1).length >= 2 &&
    trade.sides.some(s => s.trackedAssets > 0)
  );
}

export default async function VaultPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

  try {
    const [league, users, rosters, players, historicalData, seasonTrades, draftMap, leagueChain] =
      await Promise.all([
        getLeague(leagueId),
        getLeagueUsers(leagueId),
        getLeagueRosters(leagueId),
        getAllPlayers(),
        fetchHistoricalValues(),
        getAllHistoricalTrades(leagueId),
        getAllHistoricalDrafts(leagueId),
        getLeagueHistory(leagueId),
      ]);

    if (historicalData.dates.length === 0) {
      return (
        <ErrorState
          title="The Vault Is Sealed"
          detail="Historical value data is unavailable right now, and the Vault runs entirely on it."
        />
      );
    }

    const playerMapping = buildPlayerNameMapping(players, historicalData.playerColumns);
    const allTrades = seasonTrades.flatMap(s => s.trades);

    // Team names keyed by roster id (current owners name the franchise)
    const names = new Map<number, string>();
    for (const roster of rosters) {
      names.set(roster.roster_id, getTeamName(getUserByOwnerId(users, roster.owner_id), roster.roster_id));
    }

    // --- Trade aging series ---
    // FantasyCalc fills today's value for assets the sheet doesn't track,
    // rescaled onto the sheet's scale via the overlap between sources.
    const fc = await fetchFantasyCalcValues();
    const scale = estimateScaleFactor(
      historicalData.values.get(historicalData.dates[0]),
      fc.playerValues,
      playerMapping
    );
    const fallback = { playerValues: fc.playerValues, pickValues: fc.pickValues, scale };

    const vaultTrades = buildVaultTrades(
      allTrades, draftMap, historicalData, playerMapping, players, 60, fallback
    );
    const chartable = vaultTrades.filter(isChartable);
    const { heist, photoFinish } = findSuperlatives(vaultTrades);

    // --- Franchise timelines: transactions + drafted players across the chain ---
    const [allTransactions, draftedPlayers] = await Promise.all([
      Promise.all(leagueChain.map(lg => getAllSeasonTransactions(lg.league_id))).then(r => r.flat()),
      Promise.all(
        leagueChain.map(async lg => {
          const drafts = await getLeagueDrafts(lg.league_id).catch(() => []);
          const perDraft = await Promise.all(
            drafts.map(async draft => {
              const picks = await getDraftPicks(draft.draft_id).catch(() => []);
              const ts = draft.start_time || draft.created;
              return picks.map(p => ({ playerId: p.player_id, rosterId: p.roster_id, ts }));
            })
          );
          return perDraft.flat();
        })
      ).then(r => r.flat()),
    ]);

    const events = buildRosterEvents(allTransactions, draftedPlayers);

    // Start franchise timelines at league inception, not the sheet's start:
    // before the startup draft every reconstructed roster is empty.
    const inceptionCandidates = [
      ...draftedPlayers.map(d => d.ts),
      ...allTransactions.map(t => t.created),
    ].filter(ts => ts > 0);
    const inceptionTs = inceptionCandidates.length > 0 ? Math.min(...inceptionCandidates) : 0;
    const franchiseSampleDates = sampleDates(historicalData.dates, inceptionTs, 48);
    const latestSheetValues = historicalData.values.get(historicalData.dates[0]);
    const franchises = rosters
      .map(roster => {
        const series = reconstructFranchiseSeries(
          roster.players || [],
          events.get(roster.roster_id) || [],
          historicalData,
          playerMapping,
          franchiseSampleDates
        );
        let peak = series[0] || { date: '', value: 0 };
        for (const p of series) if (p.value > peak.value) peak = p;

        // Current value gets the same treatment as trade chips: real sheet
        // value for tracked players plus rescaled FantasyCalc estimates for
        // the rest. Without this, rookie-heavy rosters rank artificially
        // low here while ranking high on the Teams page.
        const trackedNow = series[series.length - 1]?.value || 0;
        let estimate = 0;
        for (const playerId of roster.players || []) {
          const col = playerMapping.get(playerId);
          const tracked = col && latestSheetValues?.get(col);
          if (!tracked) {
            const fcVal = fallback.playerValues.get(playerId);
            if (fcVal) estimate += fcVal * fallback.scale;
          }
        }

        return {
          rosterId: roster.roster_id,
          name: names.get(roster.roster_id) || `Team ${roster.roster_id}`,
          series,
          peak,
          current: Math.round(trackedNow + estimate),
          currentIsEstimated: estimate > 0,
        };
      })
      .sort((a, b) => b.current - a.current);

    const peakFranchise = [...franchises].sort((a, b) => b.peak.value - a.peak.value)[0];

    const superlativeCard = (
      title: string,
      emoji: string,
      trade: VaultTrade | null,
      line: (t: VaultTrade) => string
    ) =>
      trade && (
        <div className="panel p-4">
          <p className="text-xs text-gray-500 mb-1">
            <span className="mr-1">{emoji}</span>
            {title}
          </p>
          <p className="text-sm text-white mb-1">
            {trade.sides.map(s => names.get(s.rosterId) || `Team ${s.rosterId}`).join(' vs ')}
            <span className="text-gray-500 ml-2 text-xs">{formatDate(trade.date)}</span>
          </p>
          <div className="space-y-1 mb-2">
            {trade.sides.map((s, i) => (
              <p key={s.rosterId} className="text-xs text-gray-400 truncate flex items-baseline gap-1.5" title={s.assetLabels.join(', ')}>
                <span
                  className="w-1.5 h-1.5 rounded-full inline-block shrink-0 self-center"
                  style={{ backgroundColor: SIDE_COLORS[i % SIDE_COLORS.length] }}
                />
                <span className="text-gray-300 tabular-nums shrink-0">
                  {s.todayIsEstimated ? '\u2248' : ''}
                  {abbreviateNumber(s.todayValue)}
                </span>
                <span className="truncate">{s.assetLabels.join(', ') || 'nothing'}</span>
              </p>
            ))}
          </div>
          <TradeAgingChart trade={trade} names={names} />
          <p className="text-xs text-gray-400 mt-2">{line(trade)}</p>
        </div>
      );

    return (
      <div className="space-y-8">
        <div>
          <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.2em] text-gold-500 mb-2">
            The Vault
          </p>
          <h1 className="text-3xl text-white">Where the Receipts Live</h1>
          <p className="text-gray-400 mt-1">
            {league.name} &middot; every trade and franchise, replayed against{' '}
            {historicalData.dates.length.toLocaleString()} days of market values
          </p>
          <div className="keyline mt-4" />
        </div>

        {/* Superlatives */}
        {(heist || photoFinish || peakFranchise) && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {superlativeCard('The Heist', '\u{1F3C6}', heist, t =>
              `${names.get(t.leaderRosterId!) || 'The winner'} has gained ${abbreviateNumber(Math.abs(Math.round(t.swing)))} of separation since trade day.`
            )}
            {superlativeCard('The Photo Finish', '\u{2696}\u{FE0F}', photoFinish, t =>
              `Still separated by just ${abbreviateNumber(Math.abs(Math.round(t.gapNow)))} after ${Math.round((Date.now() - t.date) / (30 * 24 * 3600 * 1000))} months.`
            )}
            {peakFranchise && peakFranchise.peak.value > 0 && (
              <div className="panel p-4">
                <p className="text-xs text-gray-500 mb-1">
                  <span className="mr-1">{'\u{1F3D4}\u{FE0F}'}</span>
                  Peak Franchise
                </p>
                <p className="text-sm text-white mb-2">{peakFranchise.name}</p>
                <FranchiseSparkline points={peakFranchise.series} />
                <p className="text-xs text-gray-400 mt-2">
                  Highest roster value in league history:{' '}
                  <span className="text-gold-400">{peakFranchise.peak.value.toLocaleString()}</span> on{' '}
                  {peakFranchise.peak.date}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Franchise timelines */}
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold text-white">Franchise Timelines</h2>
            <p className="text-sm text-gray-400">
              Roster value reconstructed from every draft pick, trade, and waiver move.
              Lines chart sheet-tracked value; current values (&asymp;) also estimate
              untracked players, matching how the Teams page ranks rosters.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 divide-white/[0.05]">
            {franchises.map(f => (
              <div key={f.rosterId} className="p-4">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-white truncate">{truncateName(f.name, 20)}</p>
                  <p
                    className="text-sm text-gold-400 tabular-nums"
                    title={f.currentIsEstimated ? 'Includes estimates for players the value sheet does not track' : undefined}
                  >
                    {f.currentIsEstimated ? '\u2248' : ''}
                    {abbreviateNumber(f.current)}
                  </p>
                </div>
                <FranchiseSparkline points={f.series} />
                <p className="text-[11px] text-gray-500 mt-1">
                  Peak {abbreviateNumber(f.peak.value)} &middot; {f.peak.date}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Trade ledger */}
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">The Trade Ledger</h2>
          <p className="text-sm text-gray-400 mb-4">
            {chartable.length} of {vaultTrades.length} trades old enough to chart &mdash; watch them age
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {chartable.map(trade => {
              const badge = coverageBadge(trade);
              const leaderName = trade.leaderRosterId !== null ? names.get(trade.leaderRosterId) : null;
              return (
                <div key={trade.tradeId} className="panel panel-hover p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs text-gray-500">{formatDate(trade.date)}</p>
                    {badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500/90">
                        {badge}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {trade.sides.map((side, i) => (
                      <div key={side.rosterId} className="flex items-baseline gap-1.5 text-sm min-w-0">
                        <span
                          className="w-2 h-2 rounded-full inline-block shrink-0 self-center"
                          style={{ backgroundColor: SIDE_COLORS[i % SIDE_COLORS.length] }}
                        />
                        <span className="text-white shrink-0">
                          {truncateName(names.get(side.rosterId) || `Team ${side.rosterId}`, 14)}
                        </span>
                        <span
                          className="text-gray-500 tabular-nums text-xs shrink-0"
                          title={side.todayIsEstimated ? 'Includes estimates for assets the value sheet does not track' : undefined}
                        >
                          {side.todayIsEstimated ? '\u2248' : ''}
                          {abbreviateNumber(side.todayValue)}
                        </span>
                        <span
                          className="text-gray-400 text-xs truncate"
                          title={side.assetLabels.join(', ')}
                        >
                          {side.assetLabels.join(', ') || 'nothing'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <TradeAgingChart trade={trade} names={names} />
                  {leaderName && (
                    <p className="text-xs text-gray-400 mt-2">
                      {trade.swing >= 0 ? (
                        <>
                          <span className="text-sleeper-green">{truncateName(leaderName, 18)}</span> ahead by{' '}
                          {abbreviateNumber(Math.abs(Math.round(trade.gapNow)))}, up{' '}
                          {abbreviateNumber(Math.abs(Math.round(trade.swing)))} since trade day
                        </>
                      ) : (
                        <>
                          <span className="text-gold-400">{truncateName(leaderName, 18)}</span> ahead by{' '}
                          {abbreviateNumber(Math.abs(Math.round(trade.gapNow)))}, but the gap has closed{' '}
                          {abbreviateNumber(Math.abs(Math.round(trade.swing)))}
                        </>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-gray-600">
          Chart lines use the historical market sheet ({historicalData.dates[0]} latest), which
          tracks a curated set of players &mdash; untracked assets are excluded from lines and
          flagged in coverage badges. Today&apos;s values marked &asymp; fill those gaps with
          FantasyCalc data rescaled onto the sheet&apos;s scale (&times;{scale.toFixed(2)});
          traded picks are valued as picks until their selection enters the data.
        </p>
      </div>
    );
  } catch (error) {
    console.error('Error loading vault:', error);
    return <ErrorState title="Error Loading The Vault" />;
  }
}
