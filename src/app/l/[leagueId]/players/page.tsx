import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/supabase';
import { NoSeasonPanel, PlayersHeader, SettingsErrorPanel } from './PageChrome';
import {
  fetchLeague,
  fetchLatestSeason,
  fetchMyTeam,
  parsePositionParam,
  parseQueryParam,
  parseSeasonSettings,
} from './playersQueries';
import { loadPlayersSections } from './loadPlayersSections';
import PlayersSections from './PlayersSections';

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default async function PlayersPage({
  params,
  searchParams,
}: {
  params: { leagueId: string };
  searchParams: { q?: string; pos?: string };
}) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [season, viewerId] = await Promise.all([fetchLatestSeason(league.id), getViewerId()]);

  if (!season) {
    return (
      <div className="space-y-8">
        <PlayersHeader />
        <NoSeasonPanel />
      </div>
    );
  }

  const parsedSettings = parseSeasonSettings(season.settings);
  if (!parsedSettings.ok) {
    return (
      <div className="space-y-8">
        <PlayersHeader />
        <SettingsErrorPanel detail={parsedSettings.detail} />
      </div>
    );
  }
  const { settings } = parsedSettings;

  const isCreator = viewerId !== null && viewerId === league.createdBy;
  const myTeam = viewerId !== null ? await fetchMyTeam(league.id, viewerId) : null;
  const q = parseQueryParam(searchParams.q);
  const pos = parsePositionParam(searchParams.pos);

  const data = await loadPlayersSections(league.id, q, pos, myTeam?.id ?? null);

  return (
    <div className="space-y-8">
      <PlayersHeader />
      <PlayersSections
        leagueId={league.id}
        q={q}
        pos={pos}
        settings={settings}
        myTeam={myTeam}
        isCreator={isCreator}
        data={data}
      />
    </div>
  );
}
