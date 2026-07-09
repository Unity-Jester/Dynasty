import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/supabase';
import { NoSeasonPanel, SettingsErrorPanel, TradesHeader } from './PageChrome';
import { fetchLatestSeason, fetchLeague, fetchLeagueTeams, parseSeasonSettings, resolveCurrentTradeWeek } from './tradeQueries';
import { loadTradesSections } from './loadTradesSections';
import TradesSections from './TradesSections';

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default async function TradesPage({ params }: { params: { leagueId: string } }) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [season, teamRows, viewerId] = await Promise.all([
    fetchLatestSeason(league.id),
    fetchLeagueTeams(league.id),
    getViewerId(),
  ]);

  if (!season) {
    return (
      <div className="space-y-8">
        <TradesHeader />
        <NoSeasonPanel />
      </div>
    );
  }

  const parsedSettings = parseSeasonSettings(season.settings);
  if (!parsedSettings.ok) {
    return (
      <div className="space-y-8">
        <TradesHeader />
        <SettingsErrorPanel detail={parsedSettings.detail} />
      </div>
    );
  }
  const { settings } = parsedSettings;

  const isCreator = viewerId !== null && viewerId === league.createdBy;
  const myTeam = teamRows.find((t) => viewerId !== null && t.ownerId === viewerId) ?? null;
  const teamNames = new Map(teamRows.map((t) => [t.id, t.name]));

  const currentWeek = await resolveCurrentTradeWeek(settings, season.year);
  const deadlinePassed = settings.trades.deadlineWeek !== null && currentWeek > settings.trades.deadlineWeek;

  const sectionsData = await loadTradesSections(
    league.id,
    season.year,
    settings,
    teamNames,
    myTeam?.id ?? null,
    isCreator,
  );

  return (
    <div className="space-y-8">
      <TradesHeader />
      <TradesSections
        data={sectionsData}
        settings={settings}
        teamRows={teamRows}
        myTeam={myTeam}
        isCreator={isCreator}
        deadlinePassed={deadlinePassed}
        currentWeek={currentWeek}
      />
    </div>
  );
}
