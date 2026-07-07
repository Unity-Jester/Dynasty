import { invariant } from '@/lib/invariant';
import type { LeagueSettings } from '../settings';
import { isEligible, STARTER_SLOTS } from './eligibility';

// Fixed upper bound for the assignment lists (CODING_STANDARDS.md Rule 2/3).
// No real lineup approaches this; it exists purely to bound iteration over
// external (client-submitted) data.
const MAX_ASSIGNMENTS = 30;

export type LineupAssignment = {
  slot: string;
  slotIndex: number;
  playerId: string | null;
};

export type LineupError =
  | 'shape_mismatch'
  | 'not_on_roster'
  | 'not_active'
  | 'ineligible_position'
  | 'duplicate_player'
  | 'locked_change';

export type LineupMember = { readonly playerId: string; readonly status: 'active' | 'taxi' | 'ir' };

export interface ValidateLineupInput {
  readonly settings: LeagueSettings;
  readonly members: readonly LineupMember[];
  readonly playerPositions: ReadonlyMap<string, string>;
  readonly current: readonly LineupAssignment[];
  readonly proposed: readonly LineupAssignment[];
  readonly lockedNflTeams: ReadonlySet<string>;
  readonly playerNflTeams: ReadonlyMap<string, string | null>;
}

export type ValidateLineupResult = { ok: true } | { ok: false; error: LineupError; detail: string };

function instanceKey(slot: string, slotIndex: number): string {
  return `${slot}:${slotIndex}`;
}

/** The exact set of starter-slot instances a legal `proposed` must cover, one per (slot, count index). */
function expectedInstances(settings: LeagueSettings): ReadonlySet<string> {
  const expected = new Set<string>();
  for (const entry of settings.rosterSlots) {
    if (!(STARTER_SLOTS as readonly string[]).includes(entry.slot)) continue;
    for (let i = 0; i < entry.count; i += 1) {
      expected.add(instanceKey(entry.slot, i));
    }
  }
  return expected;
}

function checkShape(
  settings: LeagueSettings,
  proposed: readonly LineupAssignment[],
): { ok: true } | { ok: false; detail: string } {
  const expected = expectedInstances(settings);
  const seen = new Set<string>();

  for (const a of proposed) {
    const key = instanceKey(a.slot, a.slotIndex);
    if (!expected.has(key)) {
      return { ok: false, detail: `${key} is not a configured starter-slot instance for this league` };
    }
    if (seen.has(key)) {
      return { ok: false, detail: `${key} is assigned more than once in the proposed lineup` };
    }
    seen.add(key);
  }

  if (seen.size !== expected.size) {
    const missing = [...expected].filter((key) => !seen.has(key));
    return { ok: false, detail: `missing starter-slot instance(s): ${missing.join(', ')}` };
  }

  return { ok: true };
}

/** Builds the (instance key -> non-null playerId) view used by the roster/eligibility/duplicate checks. */
function filledInstances(assignments: readonly LineupAssignment[]): Map<string, string> {
  const filled = new Map<string, string>();
  for (const a of assignments) {
    if (a.playerId !== null) filled.set(instanceKey(a.slot, a.slotIndex), a.playerId);
  }
  return filled;
}

function checkRosterAndEligibility(
  input: ValidateLineupInput,
  filled: ReadonlyMap<string, string>,
): { ok: true } | { ok: false; error: LineupError; detail: string } {
  const memberStatus = new Map(input.members.map((m) => [m.playerId, m.status]));

  for (const [key, playerId] of filled) {
    const status = memberStatus.get(playerId);
    if (status === undefined) {
      return { ok: false, error: 'not_on_roster', detail: `player ${playerId} (${key}) is not on this roster` };
    }
    if (status !== 'active') {
      return {
        ok: false,
        error: 'not_active',
        detail: `player ${playerId} (${key}) has roster status "${status}", not active`,
      };
    }
  }

  for (const [key, playerId] of filled) {
    const position = input.playerPositions.get(playerId);
    const slot = key.split(':')[0];
    if (position === undefined) {
      return {
        ok: false,
        error: 'ineligible_position',
        detail: `player ${playerId} (${key}) has an unknown position`,
      };
    }
    if (!isEligible(position, slot)) {
      return {
        ok: false,
        error: 'ineligible_position',
        detail: `player ${playerId} (position ${position}) is not eligible for slot ${key}`,
      };
    }
  }

  return { ok: true };
}

function checkDuplicates(
  filled: ReadonlyMap<string, string>,
): { ok: true } | { ok: false; error: 'duplicate_player'; detail: string } {
  const seenPlayers = new Map<string, string>(); // playerId -> first instance key seen at
  for (const [key, playerId] of filled) {
    const firstKey = seenPlayers.get(playerId);
    if (firstKey !== undefined) {
      return {
        ok: false,
        error: 'duplicate_player',
        detail: `player ${playerId} is assigned to both ${firstKey} and ${key}`,
      };
    }
    seenPlayers.set(playerId, key);
  }
  return { ok: true };
}

function isLocked(
  playerId: string,
  playerNflTeams: ReadonlyMap<string, string | null>,
  lockedNflTeams: ReadonlySet<string>,
): boolean {
  const team = playerNflTeams.get(playerId);
  if (team === null || team === undefined) return false;
  return lockedNflTeams.has(team);
}

/**
 * Diffs current vs proposed BY INSTANCE (slot+slotIndex). For every instance
 * whose playerId differs, both the outgoing and incoming player (when
 * non-null) are "changed" at that instance — this is what makes a locked
 * player MOVED between two instances count as a change at both (rejected),
 * while an instance whose assignment is unchanged is never a violation even
 * if the occupant is locked.
 */
function checkLocks(
  input: ValidateLineupInput,
): { ok: true } | { ok: false; error: 'locked_change'; detail: string } {
  const currentByKey = filledInstances(input.current);
  const proposedByKey = filledInstances(input.proposed);
  const allKeys = new Set<string>([...currentByKey.keys(), ...proposedByKey.keys()]);

  for (const key of allKeys) {
    const before = currentByKey.get(key) ?? null;
    const after = proposedByKey.get(key) ?? null;
    if (before === after) continue; // unchanged instance, never a lock violation

    if (before !== null && isLocked(before, input.playerNflTeams, input.lockedNflTeams)) {
      return {
        ok: false,
        error: 'locked_change',
        detail: `player ${before} cannot be moved out of ${key}: locked NFL team`,
      };
    }
    if (after !== null && isLocked(after, input.playerNflTeams, input.lockedNflTeams)) {
      return {
        ok: false,
        error: 'locked_change',
        detail: `player ${after} cannot be moved into ${key}: locked NFL team`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validates a proposed lineup save against a league's rules, in strict
 * precedence order: shape -> roster membership -> active status -> position
 * eligibility -> no duplicate players -> no locked-team changes.
 */
export function validateLineup(input: ValidateLineupInput): ValidateLineupResult {
  invariant(
    input.current.length <= MAX_ASSIGNMENTS && input.proposed.length <= MAX_ASSIGNMENTS,
    `lineup assignment list exceeds the sanity bound of ${MAX_ASSIGNMENTS} (current=${input.current.length}, proposed=${input.proposed.length})`,
  );
  invariant(
    input.settings.rosterSlots.length > 0,
    'league settings have no roster slots configured; schema validation should have rejected this upstream',
  );

  const shape = checkShape(input.settings, input.proposed);
  if (!shape.ok) return { ok: false, error: 'shape_mismatch', detail: shape.detail };

  const filled = filledInstances(input.proposed);

  const rosterAndEligibility = checkRosterAndEligibility(input, filled);
  if (!rosterAndEligibility.ok) return rosterAndEligibility;

  const duplicates = checkDuplicates(filled);
  if (!duplicates.ok) return duplicates;

  const locks = checkLocks(input);
  if (!locks.ok) return locks;

  return { ok: true };
}
