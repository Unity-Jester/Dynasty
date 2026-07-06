import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, profiles, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { getSiteOrigin } from '@/lib/siteOrigin';
import TeamsGrid from './TeamsGrid';
import InvitePanel from './InvitePanel';
import SettingsSummary from './SettingsSummary';

// A hosted league's roster is created up front from teamCount (max 32,
// see engine/settings.ts); 40 leaves headroom without being unbounded.
const MAX_TEAMS = 40;

type LeagueRow = {
  id: string;
  name: string;
  status: string;
  createdBy: string;
  sleeperLeagueId: string | null;
};
type SeasonRow = { id: string; year: number; phase: string; currentWeek: number; settings: unknown };
type TeamRow = { id: string; name: string; ownerId: string | null; inviteToken: string | null };

async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({
      id: leagues.id,
      name: leagues.name,
      status: leagues.status,
      createdBy: leagues.createdBy,
      sleeperLeagueId: leagues.sleeperLeagueId,
    })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({
      id: seasons.id,
      year: seasons.year,
      phase: seasons.phase,
      currentWeek: seasons.currentWeek,
      settings: seasons.settings,
    })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

async function fetchTeams(leagueId: string): Promise<TeamRow[]> {
  return getDb()
    .select({ id: teams.id, name: teams.name, ownerId: teams.ownerId, inviteToken: teams.inviteToken })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .limit(MAX_TEAMS);
}

async function fetchOwnerNames(ownerIds: string[]): Promise<Map<string, string>> {
  if (ownerIds.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select({ id: profiles.id, displayName: profiles.displayName })
    .from(profiles)
    .where(inArray(profiles.id, ownerIds))
    .limit(MAX_TEAMS);
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

type TeamCard = { id: string; name: string; ownerDisplayName: string | null };
type UnclaimedInvite = { id: string; name: string; inviteUrl: string };

function buildTeamCards(teamRows: TeamRow[], ownerNames: Map<string, string>): TeamCard[] {
  return teamRows.map((t) => ({
    id: t.id,
    name: t.name,
    ownerDisplayName: t.ownerId ? ownerNames.get(t.ownerId) ?? 'Manager' : null,
  }));
}

// Only ever call this once the caller has confirmed `isCreator`; invite
// tokens must never be shaped into props for a non-creator viewer.
function buildUnclaimedInvites(teamRows: TeamRow[], siteOrigin: string): UnclaimedInvite[] {
  return teamRows
    .filter((t) => t.ownerId === null && t.inviteToken !== null)
    .map((t) => ({ id: t.id, name: t.name, inviteUrl: `${siteOrigin}/join/${t.inviteToken}` }));
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-gray-300 border border-white/10 capitalize">
      {phase}
    </span>
  );
}

function InvalidSettingsPanel() {
  return (
    <div className="panel p-6 text-center">
      <h2 className="font-display text-lg text-white mb-2">League settings are invalid</h2>
      <p className="text-gray-400 text-sm">
        This season&apos;s settings failed validation. Contact support or recreate the
        season before continuing.
      </p>
    </div>
  );
}

function LeagueHeader({
  leagueName,
  season,
  sleeperLeagueId,
}: {
  leagueName: string;
  season: SeasonRow | null;
  sleeperLeagueId: string | null;
}) {
  return (
    <header className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display text-3xl text-white">{leagueName}</h1>
        <div className="keyline mt-3" />
        {sleeperLeagueId && (
          <Link
            href={`/league/${sleeperLeagueId}/history`}
            className="inline-block mt-2 text-xs text-gray-500 hover:text-gold-400 transition-colors"
          >
            League history &rarr;
          </Link>
        )}
      </div>
      {season && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>{season.year} season</span>
          <PhaseBadge phase={season.phase} />
          {season.phase !== 'offseason' && <span>Week {season.currentWeek}</span>}
        </div>
      )}
    </header>
  );
}

function SeasonSettingsSection({
  season,
  parsedSettings,
}: {
  season: SeasonRow | null;
  parsedSettings: ReturnType<typeof LeagueSettingsSchema.safeParse> | null;
}) {
  if (!season) {
    return <p className="text-gray-400 text-sm">This league has no season set up yet.</p>;
  }
  if (!parsedSettings?.success) {
    return <InvalidSettingsPanel />;
  }
  return <SettingsSummary settings={parsedSettings.data} />;
}

export default async function LeagueHomePage({ params }: { params: { leagueId: string } }) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [season, teamRows, viewerId] = await Promise.all([
    fetchCurrentSeason(league.id),
    fetchTeams(league.id),
    getViewerId(),
  ]);

  const ownerIds = teamRows
    .map((t) => t.ownerId)
    .filter((id): id is string => id !== null);
  const ownerNames = await fetchOwnerNames(ownerIds);
  const teamCards = buildTeamCards(teamRows, ownerNames);

  const isCreator = viewerId !== null && viewerId === league.createdBy;
  const unclaimedInvites = isCreator ? buildUnclaimedInvites(teamRows, getSiteOrigin()) : [];

  const parsedSettings = season ? LeagueSettingsSchema.safeParse(season.settings) : null;

  return (
    <div className="space-y-8">
      <LeagueHeader
        leagueName={league.name}
        season={season}
        sleeperLeagueId={league.sleeperLeagueId}
      />
      <SeasonSettingsSection season={season} parsedSettings={parsedSettings} />
      <TeamsGrid leagueId={league.id} teams={teamCards} />
      {isCreator && <InvitePanel teams={unclaimedInvites} />}
    </div>
  );
}
