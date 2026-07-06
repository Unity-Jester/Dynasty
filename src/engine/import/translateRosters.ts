import { z } from 'zod';
import { invariant } from '../../lib/invariant';
import { validateRosterCounts, type RosterMemberShape, type RosterMemberStatus } from '../roster';
import type { LeagueSettings } from '../settings';
import { firstZodIssueMessage } from '../zodIssue';

// Fixed upper bounds for loops over external (Sleeper API) data — Rule 2.
const MAX_IMPORT_TEAMS = 32;
const MAX_IMPORT_ROSTER = 100;
const MAX_IMPORT_USERS = 64;

const RawRosterInput = z.object({
  roster_id: z.number().int(),
  owner_id: z.string().nullish(),
  players: z.array(z.string()).max(MAX_IMPORT_ROSTER).nullish(),
  taxi: z.array(z.string()).max(MAX_IMPORT_ROSTER).nullish(),
  reserve: z.array(z.string()).max(MAX_IMPORT_ROSTER).nullish(),
});

const RawUserInput = z.object({
  user_id: z.string(),
  display_name: z.string().nullish(),
  metadata: z
    .object({
      team_name: z.string().nullish(),
    })
    .nullish(),
});

const RawImportInput = z.object({
  rosters: z.array(RawRosterInput).max(MAX_IMPORT_TEAMS),
  users: z.array(RawUserInput).max(MAX_IMPORT_USERS),
});

type RawRoster = z.infer<typeof RawRosterInput>;
type RawUser = z.infer<typeof RawUserInput>;

export interface TeamPlan {
  readonly rosterId: number;
  readonly name: string;
  readonly members: { readonly playerId: string; readonly status: RosterMemberStatus }[];
}

export type TranslateRostersResult =
  | { ok: true; value: { teams: TeamPlan[]; warnings: string[] } }
  | { ok: false; error: string };

export interface TranslateRostersOpts {
  readonly knownPlayerIds: ReadonlySet<string>;
  readonly settings: LeagueSettings;
}

// Resolves one player's status, warning when taxi+reserve overlap forces the
// documented 'taxi wins' precedence.
function resolveMemberStatus(
  playerId: string,
  rosterId: number,
  taxi: ReadonlySet<string>,
  reserve: ReadonlySet<string>,
  warnings: string[],
): RosterMemberStatus {
  const inTaxi = taxi.has(playerId);
  const inReserve = reserve.has(playerId);
  if (inTaxi && inReserve) {
    warnings.push(`Player ${playerId} on roster ${rosterId} is in both taxi and reserve — taxi wins`);
    return 'taxi';
  }
  if (inTaxi) return 'taxi';
  if (inReserve) return 'ir';
  return 'active';
}

// Builds this roster's member list, skipping unknown player ids (capped to
// one summary warning per roster rather than one per player — Rule 3 bound
// on warning volume). Taxi+reserve overlap resolves to 'taxi' (documented
// precedence) with a per-player warning naming the id and roster.
function buildMembers(roster: RawRoster, knownPlayerIds: ReadonlySet<string>, warnings: string[]): RosterMemberShape[] {
  const players = roster.players ?? [];
  const taxi = new Set(roster.taxi ?? []);
  const reserve = new Set(roster.reserve ?? []);
  invariant(players.length <= MAX_IMPORT_ROSTER, 'players array exceeds the parsed bound');

  // Union of players[] with any taxi/reserve ids not present there (Sleeper
  // should not produce this, but we tolerate it per spec).
  const allIds = new Set<string>(players);
  for (const id of taxi) allIds.add(id);
  for (const id of reserve) allIds.add(id);

  const unknownIds: string[] = [];
  const members: RosterMemberShape[] = [];
  for (const playerId of allIds) {
    if (!knownPlayerIds.has(playerId)) {
      unknownIds.push(playerId);
      continue;
    }
    const status = resolveMemberStatus(playerId, roster.roster_id, taxi, reserve, warnings);
    members.push({ playerId, status });
  }

  if (unknownIds.length > 0) {
    warnings.push(`Roster ${roster.roster_id} references unknown player ids: ${unknownIds.join(', ')}`);
  }
  return members;
}

// Resolves a roster's team name: metadata.team_name (trimmed, nonempty) ->
// display_name -> "Team <rosterId>". co_owners are ignored entirely — see
// the fixture's roster 7, which has a co_owner but is still named from its
// primary owner_id's team_name ("Brokeback Bros").
function resolveBaseName(roster: RawRoster, usersById: ReadonlyMap<string, RawUser>): string {
  const ownerId = roster.owner_id;
  if (!ownerId) return `Team ${roster.roster_id}`;

  const user = usersById.get(ownerId);
  if (!user) return `Team ${roster.roster_id}`;

  const teamName = user.metadata?.team_name?.trim();
  if (teamName) return teamName;
  if (user.display_name) return user.display_name;
  return `Team ${roster.roster_id}`;
}

// Deduplicates team names in encounter order, appending " (2)", " (3)", etc
// to later collisions and warning once per renamed team.
function dedupeNames(baseNames: readonly string[], warnings: string[]): string[] {
  const seenCounts = new Map<string, number>();
  const finalNames: string[] = [];
  for (const base of baseNames) {
    const count = (seenCounts.get(base) ?? 0) + 1;
    seenCounts.set(base, count);
    if (count === 1) {
      finalNames.push(base);
    } else {
      const renamed = `${base} (${count})`;
      warnings.push(`Duplicate team name "${base}" — renamed to "${renamed}"`);
      finalNames.push(renamed);
    }
  }
  return finalNames;
}

/**
 * Translates raw Sleeper rosters + users into Dynasty TeamPlans. zod-parses
 * only the fields read here (trust boundary). Validation failures against
 * league roster-count settings become warnings, never translation errors —
 * an over-capacity roster still imports so the commissioner can fix it later.
 */
export function translateRosters(input: unknown, opts: TranslateRostersOpts): TranslateRostersResult {
  const parsed = RawImportInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstZodIssueMessage(parsed.error) };
  }
  invariant(parsed.data.rosters.length <= MAX_IMPORT_TEAMS, 'rosters exceeds the parsed bound');

  const usersById = new Map<string, RawUser>();
  for (const user of parsed.data.users) {
    usersById.set(user.user_id, user);
  }

  const warnings: string[] = [];
  const baseNames = parsed.data.rosters.map((roster) => resolveBaseName(roster, usersById));
  const finalNames = dedupeNames(baseNames, warnings);
  invariant(
    finalNames.length === parsed.data.rosters.length,
    'deduped name count must match roster count',
  );

  const teams: TeamPlan[] = [];
  for (let i = 0; i < parsed.data.rosters.length; i += 1) {
    const roster = parsed.data.rosters[i];
    invariant(roster !== undefined, 'roster vanished mid-iteration');
    const name = finalNames[i];
    invariant(name !== undefined, 'name vanished mid-iteration');

    const members = buildMembers(roster, opts.knownPlayerIds, warnings);
    const countsResult = validateRosterCounts(opts.settings, members);
    if (!countsResult.ok) {
      warnings.push(`${name}: ${countsResult.detail}`);
    }

    teams.push({ rosterId: roster.roster_id, name, members });
  }

  return { ok: true, value: { teams, warnings } };
}
