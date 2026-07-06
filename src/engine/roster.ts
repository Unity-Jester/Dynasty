import { invariant } from '../lib/invariant';
import type { LeagueSettings } from './settings';

// Fixed upper bound for the tally loop (CODING_STANDARDS.md Rule 2). No real
// roster approaches this; it exists purely to bound iteration over external data.
const MAX_ROSTER_MEMBERS = 200;

const MEMBER_STATUSES = ['active', 'taxi', 'ir'] as const;
export type RosterMemberStatus = (typeof MEMBER_STATUSES)[number];

export interface RosterMemberShape {
  readonly playerId: string;
  readonly status: RosterMemberStatus;
}

export type RosterCountsResult =
  | { ok: true }
  | { ok: false; error: 'over_capacity' | 'taxi_full' | 'ir_full'; detail: string };

function slotCount(settings: LeagueSettings, slot: string): number {
  const entry = settings.rosterSlots.find((s) => s.slot === slot);
  return entry ? entry.count : 0;
}

function totalCapacity(settings: LeagueSettings): number {
  let total = 0;
  for (const entry of settings.rosterSlots) {
    total += entry.count;
  }
  return total;
}

interface StatusTally {
  readonly active: number;
  readonly taxi: number;
  readonly ir: number;
}

function tallyByStatus(members: readonly RosterMemberShape[]): StatusTally {
  invariant(
    members.length <= MAX_ROSTER_MEMBERS,
    `roster member list (${members.length}) exceeds the sanity bound of ${MAX_ROSTER_MEMBERS}`,
  );

  let active = 0;
  let taxi = 0;
  let ir = 0;
  for (const member of members) {
    // Impossible-state assert: members are produced by the DB layer per a
    // status enum column; a value outside the known set indicates a bug
    // upstream, not user input (that boundary is zod's job, not this one).
    invariant(
      MEMBER_STATUSES.includes(member.status),
      `roster member ${member.playerId} has unknown status "${String(member.status)}"`,
    );
    if (member.status === 'active') active += 1;
    else if (member.status === 'taxi') taxi += 1;
    else ir += 1;
  }
  return { active, taxi, ir };
}

/**
 * Validates a team's roster SHAPE (counts per status bucket) against the
 * league's configured slot capacities. Does not validate lineup legality
 * (position eligibility, FLEX rules) — that is Phase 6.
 */
export function validateRosterCounts(
  settings: LeagueSettings,
  members: readonly RosterMemberShape[],
): RosterCountsResult {
  invariant(
    settings.rosterSlots.length > 0,
    'league settings have no roster slots configured; schema validation should have rejected this upstream',
  );

  const capacity = totalCapacity(settings);
  const taxiCap = slotCount(settings, 'TAXI');
  const irCap = slotCount(settings, 'IR');
  const activePool = capacity - taxiCap - irCap;

  const { active, taxi, ir } = tallyByStatus(members);
  const totalMembers = active + taxi + ir;

  if (totalMembers > capacity || active > activePool) {
    // Same error code either way (precedence contract), but describe the
    // actual trigger: total-roster overflow can occur with a legal active
    // count (e.g. 25 active + 8 taxi = 33 > 32 while 25 <= 25).
    const detail =
      totalMembers > capacity
        ? `${totalMembers} rostered players exceeds the ${capacity}-player roster capacity`
        : `${active} active players exceeds the ${activePool}-player active pool`;
    return { ok: false, error: 'over_capacity', detail };
  }
  if (taxi > taxiCap) {
    return {
      ok: false,
      error: 'taxi_full',
      detail: `${taxi} taxi-squad players exceeds the ${taxiCap}-player taxi limit`,
    };
  }
  if (ir > irCap) {
    return {
      ok: false,
      error: 'ir_full',
      detail: `${ir} IR players exceeds the ${irCap}-player IR limit`,
    };
  }
  return { ok: true };
}
