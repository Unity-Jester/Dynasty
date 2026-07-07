import { notFound } from 'next/navigation';
import { z } from 'zod';
import { and, count, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, seasons, matchups } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import { fetchWeekMatchups } from './matchupQueries';
import WeekSelector from './WeekSelector';
import MatchupCard from './MatchupCard';
import GenerateScheduleButton from './GenerateScheduleButton';

// Regular season is capped at 18 weeks league-wide (NFL max); default to
// week 1 when the searchParam is absent or malformed.
const WeekParam = z.coerce.number().int().min(1).max(18).catch(1);
const MAX_TOTAL_WEEKS = 18;

type LeagueRow = { id: string; createdBy: string };
type SeasonRow = { id: string; year: number; phase: string };

async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({ id: leagues.id, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

async function fetchCurrentSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({ id: seasons.id, year: seasons.year, phase: seasons.phase })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

async function countSeasonMatchups(leagueId: string, season: number): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(matchups)
    .where(and(eq(matchups.leagueId, leagueId), eq(matchups.season, season)))
    .limit(1);
  return row?.value ?? 0;
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
      <h1 className="font-display text-3xl text-white">Matchups</h1>
      <div className="keyline mt-3" />
    </header>
  );
}

function NoScheduleEmptyState({
  leagueId,
  isCreator,
  isOffseason,
}: {
  leagueId: string;
  isCreator: boolean;
  isOffseason: boolean;
}) {
  if (isCreator && isOffseason) {
    return <GenerateScheduleButton leagueId={leagueId} />;
  }
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">
        The commissioner hasn&apos;t generated a schedule yet.
      </p>
    </div>
  );
}

export default async function MatchupsPage({
  params,
  searchParams,
}: {
  params: { leagueId: string };
  searchParams: { week?: string };
}) {
  const league = await fetchLeague(params.leagueId);
  if (!league) {
    notFound();
  }

  const [season, viewerId] = await Promise.all([
    fetchCurrentSeason(league.id),
    getViewerId(),
  ]);

  const isCreator = viewerId !== null && viewerId === league.createdBy;

  if (!season) {
    return (
      <div className="space-y-8">
        <Header />
        <p className="text-gray-400 text-sm">This league has no season set up yet.</p>
      </div>
    );
  }

  const seasonMatchupCount = await countSeasonMatchups(league.id, season.year);
  if (seasonMatchupCount === 0) {
    return (
      <div className="space-y-8">
        <Header />
        <NoScheduleEmptyState
          leagueId={league.id}
          isCreator={isCreator}
          isOffseason={season.phase === 'offseason'}
        />
      </div>
    );
  }

  const week = WeekParam.parse(searchParams.week);
  const weekMatchups = await fetchWeekMatchups(league.id, season.year, week);

  return (
    <div className="space-y-8">
      <Header />
      <WeekSelector leagueId={league.id} currentWeek={week} totalWeeks={MAX_TOTAL_WEEKS} />
      {weekMatchups.length === 0 ? (
        <div className="panel p-6 text-center">
          <p className="text-gray-400 text-sm">No matchups scheduled for week {week}.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {weekMatchups.map((matchup) => (
            <MatchupCard key={matchup.id} matchup={matchup} />
          ))}
        </div>
      )}
    </div>
  );
}
