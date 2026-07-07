import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { lineupSlots, players, rosterMembers, seasons, teams } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { STARTER_SLOTS } from '@/engine/lineup/eligibility';
import { starterSlotCount, type LeagueSettings } from '@/engine/settings';
import { getKickoffs, getLockedNflTeams } from '@/server/lineup/locks';
import type { RosterPlayer, SlotInstance } from './types';

const WeekParam = z.coerce.number().int().min(1).max(18);

// Mirrors the bounds in src/server/actions/lineup.ts — a roster is capped by
// league settings (BENCH 15 + starters + TAXI/IR); 100 is generous headroom,
// not a real limit (Rule 3).
const MAX_ROSTER = 100;
// A team-week has exactly (# starter slots) lineup rows; 30 mirrors the
// engine's own MAX_ASSIGNMENTS bound.
const MAX_LINEUP_ROWS = 30;

export type RosterMemberRow = RosterPlayer;

// Roster members for this team, joined to player detail, ordered so the
// picker/read-only view render in a stable, predictable order.
export async function fetchRosterMembers(teamId: string): Promise<RosterMemberRow[]> {
  const rows = await getDb()
    .select({
      playerId: rosterMembers.playerId,
      status: rosterMembers.status,
      fullName: players.fullName,
      position: players.position,
      nflTeam: players.nflTeam,
    })
    .from(rosterMembers)
    .innerJoin(players, eq(rosterMembers.playerId, players.sleeperId))
    .where(eq(rosterMembers.teamId, teamId))
    .orderBy(players.position, players.fullName)
    .limit(MAX_ROSTER);
  invariant(rows.length <= MAX_ROSTER, 'roster member query exceeded its bound');
  return rows;
}

export type LineupSlotRow = {
  slot: string;
  slotIndex: number;
  playerId: string | null;
};

// Current saved lineup rows for (team, season, week). Empty when the team has
// never saved a lineup for this week — the editor fills in the full instance
// set from settings regardless.
export async function fetchCurrentLineup(
  teamId: string,
  season: number,
  week: number,
): Promise<LineupSlotRow[]> {
  const rows = await getDb()
    .select({
      slot: lineupSlots.slot,
      slotIndex: lineupSlots.slotIndex,
      playerId: lineupSlots.playerId,
    })
    .from(lineupSlots)
    .where(
      and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.season, season), eq(lineupSlots.week, week)),
    )
    .limit(MAX_LINEUP_ROWS);
  invariant(rows.length <= MAX_LINEUP_ROWS, 'current lineup query exceeded its bound');
  return rows;
}

// The regular season is weeks 1..(startWeek - 1); bounded by the same NFL
// week ceiling used elsewhere (Rule 2).
const MAX_WEEKS_TO_SCAN = 18;

/**
 * The default week to land on when no ?week= searchParam is given: the first
 * week in [1, lastRegularWeek] whose kickoffs are not ALL in the past (i.e.
 * still has at least one game yet to start, or has no games recorded yet —
 * July has none, so week 1 is "open"). Falls back to week 1 if every week has
 * fully kicked off. Bounded loop over a fixed, small week range (Rule 2);
 * `fetchWeekKickoffs` is called at most MAX_WEEKS_TO_SCAN times.
 */
export async function firstOpenWeek(
  lastRegularWeek: number,
  now: Date,
  fetchWeekKickoffs: (week: number) => Promise<ReadonlyMap<string, string>>,
): Promise<number> {
  const cap = Math.min(lastRegularWeek, MAX_WEEKS_TO_SCAN);
  for (let week = 1; week <= cap; week += 1) {
    const kickoffs = await fetchWeekKickoffs(week);
    if (kickoffs.size === 0) {
      return week; // no games recorded yet — treat as open
    }
    let allPast = true;
    for (const iso of kickoffs.values()) {
      if (new Date(iso).getTime() > now.getTime()) {
        allPast = false;
        break;
      }
    }
    if (!allPast) {
      return week;
    }
  }
  return 1;
}

export type TeamRow = { id: string; leagueId: string; name: string; ownerId: string | null };
export type SeasonRow = { id: string; leagueId: string; year: number; settings: unknown };

export async function fetchTeam(teamId: string): Promise<TeamRow | null> {
  const [row] = await getDb()
    .select({ id: teams.id, leagueId: teams.leagueId, name: teams.name, ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return row ?? null;
}

export async function fetchLatestSeason(leagueId: string): Promise<SeasonRow | null> {
  const [row] = await getDb()
    .select({ id: seasons.id, leagueId: seasons.leagueId, year: seasons.year, settings: seasons.settings })
    .from(seasons)
    .where(eq(seasons.leagueId, leagueId))
    .orderBy(desc(seasons.year))
    .limit(1);
  return row ?? null;
}

/** Every configured starter-slot instance, e.g. FLEX count 2 -> FLEX:0, FLEX:1. */
export function buildInstanceShape(settings: LeagueSettings): SlotInstance[] {
  const shape: SlotInstance[] = [];
  for (const entry of settings.rosterSlots) {
    if (!(STARTER_SLOTS as readonly string[]).includes(entry.slot)) continue;
    for (let i = 0; i < entry.count; i += 1) {
      shape.push({ slot: entry.slot, slotIndex: i, playerId: null });
    }
  }
  return shape;
}

export function mergeCurrentIntoShape(
  shape: readonly SlotInstance[],
  current: readonly { slot: string; slotIndex: number; playerId: string | null }[],
): SlotInstance[] {
  const currentByKey = new Map(current.map((c) => [`${c.slot}:${c.slotIndex}`, c.playerId]));
  return shape.map((inst) => ({
    ...inst,
    playerId: currentByKey.get(`${inst.slot}:${inst.slotIndex}`) ?? null,
  }));
}

export type LineupPageData = {
  week: number;
  hasStarters: boolean;
  instances: SlotInstance[];
  roster: RosterPlayer[];
  rosterById: Map<string, RosterPlayer>;
  kickoffs: Record<string, string>;
  lockedNflTeams: string[];
};

/**
 * Everything the page needs once a season and valid settings are in hand:
 * resolves the week, then loads roster/lineup/kickoff/lock data in parallel
 * and merges it into the render-ready shape. Split out of the page component
 * purely to keep LineupPage's own branching under the complexity cap.
 */
export async function loadLineupPageData(
  teamId: string,
  season: number,
  settings: LeagueSettings,
  searchParamWeek: string | undefined,
): Promise<LineupPageData> {
  const lastRegularWeek = Math.max(1, settings.playoffs.startWeek - 1);
  const parsedWeek = WeekParam.safeParse(searchParamWeek);
  const week =
    parsedWeek.success && parsedWeek.data <= lastRegularWeek
      ? parsedWeek.data
      : await firstOpenWeek(lastRegularWeek, new Date(), (w) => getKickoffs(season, w));

  const [roster, currentLineup, kickoffMap, lockedSet] = await Promise.all([
    fetchRosterMembers(teamId),
    fetchCurrentLineup(teamId, season, week),
    getKickoffs(season, week),
    getLockedNflTeams(season, week, new Date()),
  ]);

  const shape = buildInstanceShape(settings);
  const hasStarters = starterSlotCount(settings.rosterSlots) > 0 && shape.length > 0;

  return {
    week,
    hasStarters,
    instances: mergeCurrentIntoShape(shape, currentLineup),
    roster,
    rosterById: new Map(roster.map((p) => [p.playerId, p])),
    kickoffs: Object.fromEntries(kickoffMap),
    lockedNflTeams: [...lockedSet],
  };
}
