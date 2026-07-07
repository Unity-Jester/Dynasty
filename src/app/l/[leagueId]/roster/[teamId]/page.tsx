import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { profiles, rosterMembers, teams, players } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import RosterSection, { RosterPlayerRow } from './RosterSection';
import PicksSection from './PicksSection';
import { fetchHeldPicks, fetchTradedAwayPicks } from './picksQueries';
import SetLineupButton from './SetLineupButton';

// A roster is capped by league settings (max 32 teams x realistic squad
// sizes); 60 leaves headroom without being unbounded (Rule 3).
const MAX_ROSTER_DISPLAY = 60;

const TeamIdParam = z.string().uuid();

type TeamRow = { id: string; leagueId: string; name: string; ownerId: string | null };
type MemberRow = {
  status: string;
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
};

async function fetchTeam(teamId: string): Promise<TeamRow | null> {
  const [row] = await getDb()
    .select({
      id: teams.id,
      leagueId: teams.leagueId,
      name: teams.name,
      ownerId: teams.ownerId,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

async function getViewerId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function fetchOwnerName(ownerId: string | null): Promise<string | null> {
  if (ownerId === null) {
    return null;
  }
  const [row] = await getDb()
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, ownerId))
    .limit(1);
  return row?.displayName ?? null;
}

async function fetchRosterMembers(teamId: string): Promise<MemberRow[]> {
  return getDb()
    .select({
      status: rosterMembers.status,
      playerId: rosterMembers.playerId,
      fullName: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
      injuryStatus: players.injuryStatus,
    })
    .from(rosterMembers)
    .innerJoin(players, eq(rosterMembers.playerId, players.sleeperId))
    .where(eq(rosterMembers.teamId, teamId))
    .orderBy(players.position, players.fullName)
    .limit(MAX_ROSTER_DISPLAY);
}

function toPlayerRow(member: MemberRow): RosterPlayerRow {
  return {
    playerId: member.playerId,
    fullName: member.fullName,
    position: member.position,
    nflTeam: member.nflTeam,
    injuryStatus: member.injuryStatus,
  };
}

function groupByStatus(members: MemberRow[]): Record<'active' | 'taxi' | 'ir', RosterPlayerRow[]> {
  const groups: Record<'active' | 'taxi' | 'ir', RosterPlayerRow[]> = {
    active: [],
    taxi: [],
    ir: [],
  };
  for (const member of members) {
    if (member.status === 'active' || member.status === 'taxi' || member.status === 'ir') {
      groups[member.status].push(toPlayerRow(member));
    }
  }
  return groups;
}

function TeamHeader({
  teamName,
  ownerDisplayName,
  leagueId,
  teamId,
  isOwner,
}: {
  teamName: string;
  ownerDisplayName: string | null;
  leagueId: string;
  teamId: string;
  isOwner: boolean;
}) {
  return (
    <header>
      <Link href={`/l/${leagueId}`} className="text-sm text-gray-400 hover:text-white transition-colors">
        ← Back to league
      </Link>
      <div className="flex items-start justify-between gap-4 mt-3">
        <div>
          <h1 className="font-display text-3xl text-white">{teamName}</h1>
          <p className="text-sm text-gray-400 mt-1">{ownerDisplayName ?? 'Unclaimed'}</p>
        </div>
        {isOwner && <SetLineupButton leagueId={leagueId} teamId={teamId} />}
      </div>
      <div className="keyline mt-3" />
    </header>
  );
}

function EmptyRosterPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">
        No players yet — rosters fill when your league imports (Phase 3).
      </p>
    </div>
  );
}

export default async function TeamRosterPage({
  params,
}: {
  params: { leagueId: string; teamId: string };
}) {
  const parsedTeamId = TeamIdParam.safeParse(params.teamId);
  if (!parsedTeamId.success) {
    notFound();
  }

  const team = await fetchTeam(parsedTeamId.data);
  if (!team || team.leagueId !== params.leagueId) {
    notFound();
  }

  const [ownerDisplayName, memberRows, heldPicks, tradedAwayPicks, viewerId] = await Promise.all([
    fetchOwnerName(team.ownerId),
    fetchRosterMembers(team.id),
    fetchHeldPicks(team.id),
    fetchTradedAwayPicks(team.id),
    getViewerId(),
  ]);

  const grouped = groupByStatus(memberRows);
  const isOwner = viewerId !== null && viewerId === team.ownerId;

  return (
    <div className="space-y-8">
      <TeamHeader
        teamName={team.name}
        ownerDisplayName={ownerDisplayName}
        leagueId={params.leagueId}
        teamId={team.id}
        isOwner={isOwner}
      />
      {memberRows.length === 0 ? (
        <EmptyRosterPanel />
      ) : (
        <div className="space-y-6">
          <RosterSection title="Active" players={grouped.active} />
          <RosterSection title="Taxi" players={grouped.taxi} />
          <RosterSection title="IR" players={grouped.ir} />
        </div>
      )}
      <PicksSection held={heldPicks} tradedAway={tradedAwayPicks} />
    </div>
  );
}
