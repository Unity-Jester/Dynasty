import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import {
  fetchLatestSeason,
  fetchLeagueCreator,
  fetchTeam,
  loadLineupPageData,
  type LineupPageData,
  type TeamRow,
} from './lineupQueries';
import { LineupHeader, NoSeasonPanel, NoStartersPanel, SettingsErrorPanel } from './PageChrome';
import LineupEditor from './LineupEditor';
import LineupReadOnly from './LineupReadOnly';
import CommishLineupPanel from './CommishLineupPanel';

const TeamIdParam = z.string().uuid();

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

type ViewerRoles = { isOwner: boolean; isCreator: boolean; isReadOnly: boolean };

// Split out of LineupPage purely to keep its own complexity under the lint
// cap. Commissioner affordance (Phase 7 Task 8) only kicks in when the
// creator is looking at a team they do NOT own — an owner who also happens
// to be the creator just gets the normal owner-editable view.
function computeViewerRoles(viewerId: string | null, team: TeamRow, leagueCreatorId: string | null): ViewerRoles {
  const isOwner = viewerId !== null && viewerId === team.ownerId;
  const isCreator = !isOwner && viewerId !== null && viewerId === leagueCreatorId;
  return { isOwner, isCreator, isReadOnly: !isOwner && !isCreator };
}

// The three mutually-exclusive lineup views, split out of LineupPage purely
// to keep its own complexity under the lint cap.
function LineupBody({
  isOwner,
  isCreator,
  team,
  season,
  data,
}: {
  isOwner: boolean;
  isCreator: boolean;
  team: TeamRow;
  season: number;
  data: LineupPageData;
}) {
  if (!data.hasStarters) {
    return <NoStartersPanel />;
  }
  if (isOwner) {
    return (
      <LineupEditor
        teamId={team.id}
        season={season}
        week={data.week}
        initialInstances={data.instances}
        roster={data.roster}
        kickoffs={data.kickoffs}
        lockedNflTeams={data.lockedNflTeams}
      />
    );
  }
  if (isCreator) {
    return (
      <CommishLineupPanel
        teamId={team.id}
        teamName={team.name}
        season={season}
        week={data.week}
        initialInstances={data.instances}
        roster={data.roster}
        rosterById={data.rosterById}
        kickoffs={data.kickoffs}
      />
    );
  }
  return <LineupReadOnly instances={data.instances} rosterById={data.rosterById} kickoffs={data.kickoffs} />;
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

  const [season, viewerId, leagueCreatorId] = await Promise.all([
    fetchLatestSeason(team.leagueId),
    getViewerId(),
    fetchLeagueCreator(team.leagueId),
  ]);
  const { isOwner, isCreator, isReadOnly } = computeViewerRoles(viewerId, team, leagueCreatorId);
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
        {season.year} · Week {data.week} {isReadOnly && <span className="text-gray-600">(read-only)</span>}
      </p>
      <LineupBody isOwner={isOwner} isCreator={isCreator} team={team} season={season.year} data={data} />
    </div>
  );
}
