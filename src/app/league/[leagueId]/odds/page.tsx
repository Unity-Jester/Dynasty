import Image from 'next/image';
import {
  getLeague,
  getLeagueUsers,
  getLeagueRosters,
  getAllPlayers,
  getSeasonWeeklyMatchups,
  getUserByOwnerId,
  getUserAvatarUrl,
} from '@/lib/sleeper';
import { fetchFantasyCalcValues } from '@/lib/rankings';
import { estimateScoringModels, simulateSeason } from '@/lib/simulation';
import { FantasyCalcSettings, SleeperMatchup } from '@/lib/types';
import { getTeamName } from '@/lib/utils';
import ErrorState from '@/components/ErrorState';

export const revalidate = 300;

interface LeaguePageProps {
  params: { leagueId: string };
}

const SIMS = 2500;

function deriveLeagueSettings(
  rosterPositions: string[],
  scoringSettings: Record<string, number>,
  totalRosters: number
): FantasyCalcSettings {
  const qbCount = rosterPositions.filter(pos => pos === 'QB' || pos === 'SUPER_FLEX').length;
  const recValue = scoringSettings?.rec ?? 1;
  return {
    numQbs: qbCount >= 2 ? 2 : 1,
    ppr: recValue === 0 ? 0 : recValue === 0.5 ? 0.5 : 1,
    numTeams: totalRosters || 12,
  };
}

// Pair a week's matchups into [rosterA, rosterB] tuples
function pairWeek(matchups: SleeperMatchup[]): [number, number][] {
  const groups = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (!m.matchup_id) continue;
    const g = groups.get(m.matchup_id) || [];
    g.push(m);
    groups.set(m.matchup_id, g);
  }
  const pairs: [number, number][] = [];
  groups.forEach(g => {
    if (g.length === 2) pairs.push([g[0].roster_id, g[1].roster_id]);
  });
  return pairs;
}

// Stable per-league-week seed so odds don't jitter between page loads
function seedFrom(leagueId: string, weekCount: number): number {
  let h = weekCount;
  for (let i = 0; i < leagueId.length; i++) {
    h = (h * 31 + leagueId.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pctColor(pct: number): string {
  if (pct >= 75) return 'text-sleeper-green';
  if (pct >= 40) return 'text-gold-400';
  if (pct >= 15) return 'text-gray-300';
  return 'text-sleeper-red';
}

export default async function OddsPage({ params }: LeaguePageProps) {
  const { leagueId } = params;

  try {
    const [league, users, rosters, players] = await Promise.all([
      getLeague(leagueId),
      getLeagueUsers(leagueId),
      getLeagueRosters(leagueId),
      getAllPlayers(),
    ]);

    if (league.status === 'pre_draft' || league.status === 'drafting') {
      return (
        <div className="text-center py-16">
          <h1 className="text-3xl text-white mb-3">Playoff Odds</h1>
          <p className="text-gray-400">
            Odds open once the league has drafted and the schedule exists.
          </p>
        </div>
      );
    }
    if (league.status === 'complete') {
      return (
        <div className="text-center py-16">
          <h1 className="text-3xl text-white mb-3">Playoff Odds</h1>
          <p className="text-gray-400">
            The {league.season} season is complete &mdash; the banner is already hung.
            Odds return with next season&apos;s schedule.
          </p>
        </div>
      );
    }

    const regularSeasonWeeks = Math.max(1, (league.settings.playoff_week_start || 15) - 1);
    const [weeklyMatchups, { playerValues }] = await Promise.all([
      getSeasonWeeklyMatchups(leagueId, regularSeasonWeeks),
      fetchFantasyCalcValues(
        deriveLeagueSettings(league.roster_positions || [], league.scoring_settings || {}, league.total_rosters)
      ),
    ]);

    // Roster values feed the preseason scoring prior
    const rosterValues = new Map<number, number>();
    for (const roster of rosters) {
      let total = 0;
      for (const pid of roster.players || []) total += playerValues.get(pid) || 0;
      rosterValues.set(roster.roster_id, total);
    }

    const models = estimateScoringModels(weeklyMatchups, rosterValues);

    // Remaining = scheduled weeks nobody has scored in yet
    const remainingWeeks = weeklyMatchups
      .filter(week => week.length > 0 && !week.some(m => (m.points || 0) > 0))
      .map(pairWeek)
      .filter(pairs => pairs.length > 0);

    if (remainingWeeks.length === 0 && !weeklyMatchups.some(w => w.length > 0)) {
      return (
        <div className="text-center py-16">
          <h1 className="text-3xl text-white mb-3">Playoff Odds</h1>
          <p className="text-gray-400">
            Sleeper hasn&apos;t generated the {league.season} schedule yet &mdash; check back
            closer to kickoff.
          </p>
        </div>
      );
    }

    const playoffTeams = league.settings.playoff_teams || 6;
    const weeksPlayed = weeklyMatchups.filter(w => w.some(m => (m.points || 0) > 0)).length;

    const odds = simulateSeason({
      models,
      standings: rosters.map(r => ({
        rosterId: r.roster_id,
        wins: r.settings.wins || 0,
        ties: r.settings.ties || 0,
        pointsFor: (r.settings.fpts || 0) + (r.settings.fpts_decimal || 0) / 100,
      })),
      remainingWeeks,
      playoffTeams,
      sims: SIMS,
      seed: seedFrom(leagueId, weeksPlayed),
    });

    const hasByes = playoffTeams >= 6;

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl text-white">Playoff Odds</h1>
          <p className="text-gray-400 mt-1">
            {league.name} &middot; {playoffTeams}-team playoff &middot; {remainingWeeks.length} week
            {remainingWeeks.length !== 1 ? 's' : ''} remaining
          </p>
        </div>

        <div className="panel overflow-hidden">
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="pb-3 pr-4">Team</th>
                  <th className="pb-3 pr-4 text-center">Record</th>
                  <th className="pb-3 pr-4 text-center">Proj. Wins</th>
                  <th className="pb-3 pr-4 text-center">Avg Seed</th>
                  {hasByes && <th className="pb-3 pr-4 text-center">Bye</th>}
                  <th className="pb-3 pr-4">Playoffs</th>
                  <th className="pb-3 text-right">Title</th>
                </tr>
              </thead>
              <tbody>
                {odds.map(o => {
                  const roster = rosters.find(r => r.roster_id === o.rosterId);
                  const user = roster ? getUserByOwnerId(users, roster.owner_id) : null;
                  const name = getTeamName(user, o.rosterId);
                  return (
                    <tr key={o.rosterId} className="border-t border-white/[0.05] text-gray-300">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <Image
                            src={getUserAvatarUrl(user?.avatar || null)}
                            alt={name}
                            width={26}
                            height={26}
                            className="rounded-full"
                          />
                          <span className="text-white truncate max-w-[170px]">{name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-center tabular-nums">
                        {roster?.settings.wins || 0}-{roster?.settings.losses || 0}
                        {(roster?.settings.ties || 0) > 0 ? `-${roster?.settings.ties}` : ''}
                      </td>
                      <td className="py-2.5 pr-4 text-center tabular-nums">
                        {o.projectedWins.toFixed(1)}
                      </td>
                      <td className="py-2.5 pr-4 text-center tabular-nums">
                        {o.avgSeed !== null ? o.avgSeed.toFixed(1) : '—'}
                      </td>
                      {hasByes && (
                        <td className="py-2.5 pr-4 text-center tabular-nums text-gray-400">
                          {o.byePct.toFixed(0)}%
                        </td>
                      )}
                      <td className="py-2.5 pr-4 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-gold-400 to-gold-600"
                              style={{ width: `${o.playoffPct}%` }}
                            />
                          </div>
                          <span className={`tabular-nums font-medium w-12 text-right ${pctColor(o.playoffPct)}`}>
                            {o.playoffPct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className={`py-2.5 text-right tabular-nums font-medium ${pctColor(o.titlePct)}`}>
                        {o.titlePct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          {SIMS.toLocaleString()} Monte Carlo simulations of the remaining schedule. Weekly
          scoring is modeled from each team&apos;s {weeksPlayed > 0 ? `${weeksPlayed} played week${weeksPlayed !== 1 ? 's' : ''} blended with ` : ''}
          roster-value priors; the playoff bracket is simulated single-elimination by seed.
          Division tiebreakers are approximated by overall record and points.
        </p>
      </div>
    );
  } catch (error) {
    console.error('Error loading playoff odds:', error);
    return <ErrorState title="Error Loading Playoff Odds" />;
  }
}
