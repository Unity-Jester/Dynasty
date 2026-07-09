import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/supabase';
import ProcessWaiversButton from '../players/ProcessWaiversButton';
import { parseQueryParam, searchUnrosteredPlayers } from '../players/playersQueries';
import { fetchAllTeamAssets, fetchLeague, fetchLeagueTeams, fetchLatestSeason, parseSeasonSettings } from '../trades/tradeQueries';
import { fetchReviewTrades } from '../trades/transactionQueries';
import { CommishHeader, NoSeasonPanel, NoTeamsPanel, NotCreatorPanel, SettingsErrorPanel } from './PageChrome';
import ForceAddForm from './ForceAddForm';
import ForceDropForm from './ForceDropForm';

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default async function CommishPage({
  params,
  searchParams,
}: {
  params: { leagueId: string };
  searchParams: { q?: string };
}) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const viewerId = await getViewerId();
  const isCreator = viewerId !== null && viewerId === league.createdBy;
  const header = <CommishHeader />;

  if (!isCreator) {
    return (
      <div className="space-y-8">
        {header}
        <NotCreatorPanel />
      </div>
    );
  }

  const season = await fetchLatestSeason(league.id);
  if (!season) {
    return (
      <div className="space-y-8">
        {header}
        <NoSeasonPanel />
      </div>
    );
  }

  const parsedSettings = parseSeasonSettings(season.settings);
  if (!parsedSettings.ok) {
    return (
      <div className="space-y-8">
        {header}
        <SettingsErrorPanel detail={parsedSettings.detail} />
      </div>
    );
  }
  const { settings } = parsedSettings;

  const q = parseQueryParam(searchParams.q);
  const [teams, teamAssetsMap, reviewRows, searchResults] = await Promise.all([
    fetchLeagueTeams(league.id),
    fetchAllTeamAssets(league.id, season.year, settings.trades.futurePickYears),
    fetchReviewTrades(league.id),
    searchUnrosteredPlayers(league.id, q, null),
  ]);
  const teamAssetsById = Object.fromEntries(teamAssetsMap);

  if (teams.length === 0) {
    return (
      <div className="space-y-8">
        {header}
        <NoTeamsPanel />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      <div className="panel p-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-white">
          {reviewRows.length} trade{reviewRows.length === 1 ? '' : 's'} awaiting review.
        </p>
        <Link href={`/l/${league.id}/trades`} className="text-sm text-gold-400 hover:underline">
          Go to trades &rarr;
        </Link>
      </div>

      <div className="panel p-4 space-y-2">
        <h2 className="font-display text-lg text-white">Waivers</h2>
        <ProcessWaiversButton leagueId={league.id} />
      </div>

      <ForceAddForm leagueId={league.id} teams={teams} q={q} results={searchResults} />
      <ForceDropForm teams={teams} teamAssetsById={teamAssetsById} />

      <div className="panel p-4">
        <Link href={`/l/${league.id}/activity`} className="text-sm text-gold-400 hover:underline">
          View league activity &rarr;
        </Link>
      </div>
    </div>
  );
}
