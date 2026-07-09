import 'server-only';
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, players, rosterMembers, seasons, teams } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { LeagueSettingsSchema, type LeagueSettings } from '@/engine/settings';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { ROSTERABLE_POSITIONS } from '@/engine/playerSync';
import type { MyTeamInfo, PositionFilter, RosterOption, UnrosteredPlayer } from './types';

// Unrostered search is capped per the plan's own number (Rule 2/3); a real
// league never approaches it — a wide-open query still returns fast.
const MAX_SEARCH_RESULTS = 50;
// A team's roster is bounded by league roster-slot totals; mirrors the
// lineup/trades pages' own MAX_ROSTER.
const MAX_ROSTER = 100;
// Bounded ilike: the search box itself caps input length before it ever
// reaches the query (belt: the <input maxLength> in the form is the other).
const MAX_QUERY_LENGTH = 60;

export type LeagueRow = { id: string; name: string; createdBy: string };
export type SeasonRow = { year: number; settings: unknown };

export async function fetchLeague(leagueId: string): Promise<LeagueRow | null> {
  const [row] = await getDb()
    .select({ id: leagues.id, name: leagues.name, createdBy: leagues.createdBy })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  return row ?? null;
}

export async function fetchLatestSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({ year: seasons.year, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

export type ParsedSettingsResult = { ok: true; settings: LeagueSettings } | { ok: false; detail: string };

export function parseSeasonSettings(settings: unknown): ParsedSettingsResult {
  const parsed = LeagueSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return { ok: false, detail: firstZodIssueMessage(parsed.error) };
  }
  return { ok: true, settings: parsed.data };
}

export async function fetchMyTeam(leagueId: string, ownerId: string): Promise<MyTeamInfo | null> {
  const [row] = await getDb()
    .select({
      id: teams.id,
      name: teams.name,
      faabRemaining: teams.faabRemaining,
      waiverPriority: teams.waiverPriority,
    })
    .from(teams)
    .where(and(eq(teams.leagueId, leagueId), eq(teams.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

/** My team's roster, for the claim modal's optional drop select. */
export async function fetchMyRoster(teamId: string): Promise<RosterOption[]> {
  const rows = await getDb()
    .select({ id: rosterMembers.playerId, fullName: players.fullName, position: players.position })
    .from(rosterMembers)
    .innerJoin(players, eq(rosterMembers.playerId, players.sleeperId))
    .where(eq(rosterMembers.teamId, teamId))
    .orderBy(players.position, players.fullName)
    .limit(MAX_ROSTER);
  invariant(rows.length <= MAX_ROSTER, 'roster query exceeded its bound');
  return rows;
}

// Parses a raw searchParams value into a bounded, trimmed query string, or
// null when absent/blank — never throws (searchParams are user-controlled).
export function parseQueryParam(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().slice(0, MAX_QUERY_LENGTH);
  return trimmed.length === 0 ? null : trimmed;
}

export function parsePositionParam(raw: string | undefined): PositionFilter | null {
  if (raw === undefined) return null;
  return (ROSTERABLE_POSITIONS as readonly string[]).includes(raw) ? (raw as PositionFilter) : null;
}

/**
 * Every player unrostered ANYWHERE in this league (LEFT JOIN roster_members
 * scoped to the league, keep rows with no match), optionally filtered by
 * name (bounded ilike) and position, bounded LIMIT 50 (Rule 2/3).
 */
export async function searchUnrosteredPlayers(
  leagueId: string,
  q: string | null,
  pos: PositionFilter | null,
): Promise<UnrosteredPlayer[]> {
  const conditions = [isNull(rosterMembers.id)];
  if (q !== null) conditions.push(ilike(players.fullName, `%${q}%`));
  if (pos !== null) conditions.push(eq(players.position, pos));

  const rows = await getDb()
    .select({ id: players.sleeperId, fullName: players.fullName, position: players.position, nflTeam: players.nflTeam })
    .from(players)
    .leftJoin(
      rosterMembers,
      and(eq(rosterMembers.playerId, players.sleeperId), eq(rosterMembers.leagueId, leagueId)),
    )
    .where(and(...conditions))
    .orderBy(players.fullName)
    .limit(MAX_SEARCH_RESULTS);
  invariant(rows.length <= MAX_SEARCH_RESULTS, 'unrostered player search exceeded its bound');
  return rows;
}
