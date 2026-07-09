import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { lineupSlots, players, rosterMembers, seasons, teams } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import type { LineupAssignment, LineupMember } from '@/engine/lineup/validateLineup';

// Split out of src/server/actions/lineup.ts purely to keep that file's size
// under the lint cap (CODING_STANDARDS.md Rule 4) — the reads saveLineup
// needs before it can validate a proposed lineup.

// Roster members per team are bounded by the league's roster-slot totals
// (BENCH 15 + starters + TAXI/IR); 100 is generous headroom, not a real limit
// (Rule 3). The same cap bounds the player-detail fetch keyed off member ids.
const MAX_ROSTER = 100;
// A team-week has exactly (# starter slots) lineup rows — 9-ish for the default
// SUPER_FLEX build, MAX_SLOT_COUNT (40) at the schema ceiling. 30 comfortably
// covers any real starter set; it matches the validator's own MAX_ASSIGNMENTS.
const MAX_LINEUP_ROWS = 30;

export type TeamRow = { id: string; leagueId: string; ownerId: string | null };
export type SeasonRow = { id: string; leagueId: string; year: number; settings: unknown };

export async function fetchTeam(teamId: string): Promise<TeamRow | null> {
  const [row] = await getDb()
    .select({ id: teams.id, leagueId: teams.leagueId, ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export async function fetchLatestSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({
      id: seasons.id,
      leagueId: seasons.leagueId,
      year: seasons.year,
      settings: seasons.settings,
    })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

export type ValidationInputs = {
  members: LineupMember[];
  playerPositions: Map<string, string>;
  playerNflTeams: Map<string, string | null>;
  current: LineupAssignment[];
};

export async function loadValidationInputs(
  team: TeamRow,
  input: { season: number; week: number },
): Promise<ValidationInputs> {
  const memberRows = await getDb()
    .select({ playerId: rosterMembers.playerId, status: rosterMembers.status })
    .from(rosterMembers)
    .where(eq(rosterMembers.teamId, team.id))
    .limit(MAX_ROSTER);
  invariant(memberRows.length <= MAX_ROSTER, 'roster member count exceeded its bound');
  const members: LineupMember[] = memberRows.map((r) => ({ playerId: r.playerId, status: r.status }));

  const memberIds = members.map((m) => m.playerId);
  const playerPositions = new Map<string, string>();
  const playerNflTeams = new Map<string, string | null>();
  if (memberIds.length > 0) {
    const playerRows = await getDb()
      .select({ id: players.sleeperId, position: players.position, nflTeam: players.nflTeam })
      .from(players)
      .where(inArray(players.sleeperId, memberIds))
      .limit(MAX_ROSTER);
    invariant(playerRows.length <= MAX_ROSTER, 'player detail count exceeded its bound');
    for (const p of playerRows) {
      playerPositions.set(p.id, p.position);
      playerNflTeams.set(p.id, p.nflTeam);
    }
  }

  const currentRows = await getDb()
    .select({ slot: lineupSlots.slot, slotIndex: lineupSlots.slotIndex, playerId: lineupSlots.playerId })
    .from(lineupSlots)
    .where(
      and(
        eq(lineupSlots.teamId, team.id),
        eq(lineupSlots.season, input.season),
        eq(lineupSlots.week, input.week),
      ),
    )
    .limit(MAX_LINEUP_ROWS);
  invariant(currentRows.length <= MAX_LINEUP_ROWS, 'current lineup row count exceeded its bound');
  const current: LineupAssignment[] = currentRows.map((r) => ({
    slot: r.slot,
    slotIndex: r.slotIndex,
    playerId: r.playerId,
  }));

  return { members, playerPositions, playerNflTeams, current };
}
