import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { fetchLatestSeason, fetchTeam, loadLineupPageData } from './lineupQueries';
import { LineupHeader, NoSeasonPanel, NoStartersPanel, SettingsErrorPanel } from './PageChrome';
import LineupEditor from './LineupEditor';
import LineupReadOnly from './LineupReadOnly';

const TeamIdParam = z.string().uuid();

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default async function LineupPage({
  params,
  searchParams,
}: {
  params: { leagueId: string; teamId: string };
  searchParams: { week?: string };
}) {
  const parsedTeamId = TeamIdParam.safeParse(params.teamId);
  if (!parsedTeamId.success) {
    notFound();
  }

  const team = await fetchTeam(parsedTeamId.data);
  if (!team || team.leagueId !== params.leagueId) {
    notFound();
  }

  const [season, viewerId] = await Promise.all([fetchLatestSeason(team.leagueId), getViewerId()]);
  const isOwner = viewerId !== null && viewerId === team.ownerId;
  const header = <LineupHeader teamName={team.name} leagueId={params.leagueId} teamId={team.id} />;

  if (!season) {
    return (
      <div className="space-y-8">
        {header}
        <NoSeasonPanel />
      </div>
    );
  }

  const parsedSettings = LeagueSettingsSchema.safeParse(season.settings);
  if (!parsedSettings.success) {
    return (
      <div className="space-y-8">
        {header}
        <SettingsErrorPanel detail={firstZodIssueMessage(parsedSettings.error)} />
      </div>
    );
  }

  const data = await loadLineupPageData(team.id, season.year, parsedSettings.data, searchParams.week);

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-gray-400">
        {season.year} · Week {data.week} {!isOwner && <span className="text-gray-600">(read-only)</span>}
      </p>
      {!data.hasStarters ? (
        <NoStartersPanel />
      ) : isOwner ? (
        <LineupEditor
          teamId={team.id}
          season={season.year}
          week={data.week}
          initialInstances={data.instances}
          roster={data.roster}
          kickoffs={data.kickoffs}
          lockedNflTeams={data.lockedNflTeams}
        />
      ) : (
        <LineupReadOnly instances={data.instances} rosterById={data.rosterById} kickoffs={data.kickoffs} />
      )}
    </div>
  );
}
