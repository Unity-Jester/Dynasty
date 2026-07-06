import { notFound } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { LeagueSettingsSchema } from '@/engine/settings';
import { invariant } from '@/lib/invariant';
import SettingsEditor from './SettingsEditor';
import SettingsReadOnly from './SettingsReadOnly';

// Bounded read: teamCount's hard cap is 32 (engine/settings.ts); 40 leaves
// headroom without an unbounded count (Rule 3).
const MAX_TEAMS = 40;

type LeagueRow = { id: string; name: string; createdBy: string };
type SeasonRow = { id: string; phase: string; settings: unknown };

async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({ id: leagues.id, name: leagues.name, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({ id: seasons.id, phase: seasons.phase, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

async function countTeams(leagueId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(teams)
    .where(eq(teams.leagueId, leagueId))
    .limit(1);
  const total = row?.value ?? 0;
  invariant(total <= MAX_TEAMS, 'team count exceeds hard cap');
  return total;
}

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function Header() {
  return (
    <header>
      <h1 className="font-display text-3xl text-white">League settings</h1>
      <div className="keyline mt-3" />
    </header>
  );
}

function InvalidSettingsPanel() {
  return (
    <div className="panel p-6 text-center">
      <h2 className="font-display text-lg text-white mb-2">League settings are invalid</h2>
      <p className="text-gray-400 text-sm">
        This season&apos;s settings failed validation. Recreate the season before editing.
      </p>
    </div>
  );
}

export default async function SettingsPage({ params }: { params: { leagueId: string } }) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [season, viewerId, teamCount] = await Promise.all([
    fetchCurrentSeason(league.id),
    getViewerId(),
    countTeams(league.id),
  ]);

  if (!season) {
    return (
      <div className="space-y-8">
        <Header />
        <p className="text-gray-400 text-sm">This league has no season set up yet.</p>
      </div>
    );
  }

  const parsed = LeagueSettingsSchema.safeParse(season.settings);
  if (!parsed.success) {
    return (
      <div className="space-y-8">
        <Header />
        <InvalidSettingsPanel />
      </div>
    );
  }

  const isCreator = viewerId !== null && viewerId === league.createdBy;
  const canEdit = isCreator && season.phase === 'offseason';

  // Reconcile teamCount with the real team rows so the editor's read-only
  // display matches what the action enforces on save (Rule 5 cross-check).
  const settings = { ...parsed.data, teamCount };

  return (
    <div className="space-y-8">
      <Header />
      {canEdit ? (
        <SettingsEditor leagueId={league.id} initialSettings={settings} />
      ) : (
        <>
          {isCreator && season.phase !== 'offseason' && (
            <p className="panel p-4 text-sm text-gray-300">
              Settings are locked during the season.
            </p>
          )}
          <SettingsReadOnly settings={settings} />
        </>
      )}
    </div>
  );
}
