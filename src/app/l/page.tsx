import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, seasons, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';

// Defensive cap on how many hosted leagues a "My Leagues" view will render;
// this is a UI page, not a data export, so a hard bound is appropriate
// (Rule 3). Nobody commissions 50 leagues.
const MAX_LEAGUES = 50;

type LeagueCard = {
  id: string;
  name: string;
  status: string;
  seasonYear: number | null;
  seasonPhase: string | null;
  claimedTeams: number;
  totalTeams: number;
};

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// Leagues the user can see: they created it, or they own a team in it. Two
// bounded queries rather than one join, since the row shapes we need
// (league + latest season + team claim counts) don't collapse into a single
// clean join without duplicating league rows per team.
async function findVisibleLeagueIds(userId: string): Promise<string[]> {
  const db = getDb();
  const owned = await db
    .select({ leagueId: teams.leagueId })
    .from(teams)
    .where(eq(teams.ownerId, userId))
    .limit(MAX_LEAGUES);
  const created = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.createdBy, userId))
    .limit(MAX_LEAGUES);

  const ids = new Set<string>();
  for (const row of owned) {
    ids.add(row.leagueId);
  }
  for (const row of created) {
    ids.add(row.id);
  }
  return Array.from(ids).slice(0, MAX_LEAGUES);
}

async function buildLeagueCards(leagueIds: string[]): Promise<LeagueCard[]> {
  if (leagueIds.length === 0) {
    return [];
  }
  const db = getDb();

  const leagueRows = await db
    .select({ id: leagues.id, name: leagues.name, status: leagues.status })
    .from(leagues)
    .where(inArray(leagues.id, leagueIds))
    .limit(MAX_LEAGUES);

  // Latest season per league (by year). Fetched per league id set, bounded
  // by the same MAX_LEAGUES cap; a league has very few seasons so this is
  // cheap even without a single fancy DISTINCT ON query.
  const seasonRows = await db
    .select({ leagueId: seasons.leagueId, year: seasons.year, phase: seasons.phase })
    .from(seasons)
    .where(inArray(seasons.leagueId, leagueIds))
    .limit(MAX_LEAGUES * 10);

  const latestSeasonByLeague = new Map<string, { year: number; phase: string }>();
  for (const row of seasonRows) {
    const current = latestSeasonByLeague.get(row.leagueId);
    if (!current || row.year > current.year) {
      latestSeasonByLeague.set(row.leagueId, { year: row.year, phase: row.phase });
    }
  }

  const teamRows = await db
    .select({ leagueId: teams.leagueId, ownerId: teams.ownerId })
    .from(teams)
    .where(inArray(teams.leagueId, leagueIds))
    .limit(MAX_LEAGUES * 40);

  const teamCounts = new Map<string, { claimed: number; total: number }>();
  for (const row of teamRows) {
    const current = teamCounts.get(row.leagueId) ?? { claimed: 0, total: 0 };
    current.total += 1;
    if (row.ownerId !== null) {
      current.claimed += 1;
    }
    teamCounts.set(row.leagueId, current);
  }

  return leagueRows.map((league) => {
    const season = latestSeasonByLeague.get(league.id) ?? null;
    const counts = teamCounts.get(league.id) ?? { claimed: 0, total: 0 };
    return {
      id: league.id,
      name: league.name,
      status: league.status,
      seasonYear: season?.year ?? null,
      seasonPhase: season?.phase ?? null,
      claimedTeams: counts.claimed,
      totalTeams: counts.total,
    };
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-gray-300 border border-white/10 capitalize">
      {status}
    </span>
  );
}

function LeagueCardView({ league }: { league: LeagueCard }) {
  return (
    <Link href={`/l/${league.id}`} className="panel panel-hover block p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="font-display text-lg text-white">{league.name}</h2>
        <StatusBadge status={league.status} />
      </div>
      <p className="text-sm text-gray-400">
        {league.seasonYear ? (
          <>
            {league.seasonYear} season &middot; <span className="capitalize">{league.seasonPhase}</span>
          </>
        ) : (
          'No season yet'
        )}
      </p>
      <p className="text-sm text-gray-500 mt-1">
        {league.claimedTeams}/{league.totalTeams} teams claimed
      </p>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="panel p-10 text-center space-y-4">
      <h2 className="font-display text-xl text-white">No leagues yet</h2>
      <p className="text-gray-400 max-w-sm mx-auto">
        Create a hosted dynasty league to generate teams and invite links for
        your league mates.
      </p>
      <Link
        href="/l/new"
        className="inline-block px-4 py-3 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all"
      >
        Create league
      </Link>
    </div>
  );
}

export default async function MyLeaguesPage() {
  const userId = await getAuthedUserId();
  if (!userId) {
    // Defense in depth: middleware already guards /l, but never trust that
    // alone (Rule 5).
    redirect('/login');
  }

  const leagueIds = await findVisibleLeagueIds(userId);
  const leagueCards = await buildLeagueCards(leagueIds);

  return (
    <div className="max-w-4xl mx-auto py-16 px-4">
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-white">
            My <span className="text-gold-gradient">Leagues</span>
          </h1>
          <div className="keyline mt-3" />
        </div>
        <Link
          href="/l/new"
          className="px-4 py-2.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all"
        >
          Create league
        </Link>
      </div>

      {leagueCards.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {leagueCards.map((league) => (
            <LeagueCardView key={league.id} league={league} />
          ))}
        </div>
      )}

      <p className="text-sm text-gray-500 text-center">
        Looking for a league you already play in on Sleeper?{' '}
        <Link href="/start" className="text-gold-400 hover:text-gold-300 transition-colors">
          Browse a Sleeper league instead
        </Link>
      </p>
    </div>
  );
}
