import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues } from '@/server/schema';
import LeagueNav from './LeagueNav';

const LeagueIdParam = z.string().uuid();

async function fetchLeagueName(leagueId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ name: leagues.name })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row?.name ?? null;
}

export default async function LeagueShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { leagueId: string };
}) {
  const parsedId = LeagueIdParam.safeParse(params.leagueId);
  if (!parsedId.success) {
    notFound();
  }

  const leagueName = await fetchLeagueName(parsedId.data);
  if (leagueName === null) {
    notFound();
  }

  return (
    <div>
      <LeagueNav leagueId={parsedId.data} leagueName={leagueName} />
      <div className="max-w-4xl mx-auto py-10 px-4">{children}</div>
    </div>
  );
}
