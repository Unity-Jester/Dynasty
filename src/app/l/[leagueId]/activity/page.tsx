import { notFound } from 'next/navigation';
import { fetchLeague, fetchLeagueTeams } from '../trades/tradeQueries';
import { fetchRecentTransactions, resolveActivity } from './activityQueries';
import ActivityFeed from './ActivityFeed';

export default async function ActivityPage({ params }: { params: { leagueId: string } }) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [teamRows, rows] = await Promise.all([fetchLeagueTeams(league.id), fetchRecentTransactions(league.id)]);
  const teamNames = new Map(teamRows.map((t) => [t.id, t.name]));
  const items = await resolveActivity(rows, teamNames);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl text-white">Activity</h1>
        <p className="text-sm text-gray-500 mt-1">
          The league&apos;s most recent {items.length} transaction{items.length === 1 ? '' : 's'} — trades, waivers,
          and commissioner actions.
        </p>
        <div className="keyline mt-3" />
      </header>
      <ActivityFeed items={items} />
    </div>
  );
}
