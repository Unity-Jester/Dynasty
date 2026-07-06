import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import type { TeamPlan } from '@/engine/import/translateRosters';
import type { PickPlan } from '@/engine/import/translatePicks';

// The commissioner-facing summary of a proposed (or completed) import. Pure
// data — the same shape backs both dry-run preview and execute confirmation.
export type ImportReport = {
  leagueName: string;
  season: number;
  teamCount: number;
  settingsWarnings: string[];
  rosterWarnings: string[];
  pickWarnings: string[];
  teams: { rosterId: number; name: string; active: number; taxi: number; ir: number }[];
  pickBaseSize: number;
  tradesApplied: number; // picks with currentRosterId !== originalRosterId
  blockers: string[]; // nonempty → execute must not proceed
};

// Fixed upper bound for the per-team status tally loop — teams come from an
// already-bounded translator (MAX_IMPORT_TEAMS = 32), but Rule 2 wants a named
// cap at every loop over external-derived data.
const MAX_REPORT_TEAMS = 64;

export type BuildReportInput = {
  readonly leagueName: string;
  readonly season: number;
  readonly teams: readonly TeamPlan[];
  readonly picks: readonly PickPlan[];
  readonly settingsWarnings: readonly string[];
  readonly rosterWarnings: readonly string[];
  readonly pickWarnings: readonly string[];
  readonly blockers: readonly string[];
};

// Tallies one TeamPlan's members by status into the report's per-team shape.
function tallyTeam(team: TeamPlan): ImportReport['teams'][number] {
  let active = 0;
  let taxi = 0;
  let ir = 0;
  for (const member of team.members) {
    if (member.status === 'active') active += 1;
    else if (member.status === 'taxi') taxi += 1;
    else ir += 1;
  }
  return { rosterId: team.rosterId, name: team.name, active, taxi, ir };
}

// Builds the immutable ImportReport from translator outputs. Pure: no I/O, no
// DB, deterministic — this is the unit-tested core of the orchestrator.
export function buildReport(input: BuildReportInput): ImportReport {
  invariant(input.teams.length <= MAX_REPORT_TEAMS, 'team count exceeds report cap');
  invariant(input.leagueName.length > 0, 'buildReport requires a nonempty league name');

  const teams = input.teams.map(tallyTeam);
  const tradesApplied = input.picks.filter(
    (pick) => pick.currentRosterId !== pick.originalRosterId,
  ).length;

  return {
    leagueName: input.leagueName,
    season: input.season,
    teamCount: input.teams.length,
    settingsWarnings: [...input.settingsWarnings],
    rosterWarnings: [...input.rosterWarnings],
    pickWarnings: [...input.pickWarnings],
    teams,
    pickBaseSize: input.picks.length,
    tradesApplied,
    blockers: [...input.blockers],
  };
}

// Trust-boundary schema for the one raw Sleeper league field the orchestrator
// itself persists (name) — the translators validate everything else. Kept here
// so both the orchestrator and its tests share one definition.
export const LeagueNameSchema = z.string().trim().min(1).max(100);
