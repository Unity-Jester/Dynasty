import { describe, it, expect } from 'vitest';
import { buildReport, type BuildReportInput } from '../report';
import type { TeamPlan } from '@/engine/import/translateRosters';
import type { PickPlan } from '@/engine/import/translatePicks';

function team(rosterId: number, name: string, statuses: TeamPlan['members'][number]['status'][]): TeamPlan {
  return {
    rosterId,
    name,
    members: statuses.map((status, i) => ({ playerId: `${rosterId}-${i}`, status })),
  };
}

function pick(originalRosterId: number, currentRosterId: number): PickPlan {
  return { season: 2027, round: 1, originalRosterId, currentRosterId };
}

function baseInput(overrides: Partial<BuildReportInput> = {}): BuildReportInput {
  return {
    leagueName: 'Rookie Fever',
    season: 2026,
    teams: [team(1, 'Alpha', ['active', 'active', 'taxi', 'ir'])],
    picks: [pick(1, 1)],
    settingsWarnings: [],
    rosterWarnings: [],
    pickWarnings: [],
    blockers: [],
    ...overrides,
  };
}

describe('buildReport', () => {
  it('tallies each team by member status', () => {
    const report = buildReport(baseInput());
    expect(report.teams).toEqual([{ rosterId: 1, name: 'Alpha', active: 2, taxi: 1, ir: 1 }]);
    expect(report.teamCount).toBe(1);
  });

  it('counts tradesApplied as picks whose current owner differs from original', () => {
    const report = buildReport(
      baseInput({ picks: [pick(1, 1), pick(1, 2), pick(2, 3)] }),
    );
    expect(report.pickBaseSize).toBe(3);
    expect(report.tradesApplied).toBe(2);
  });

  it('keeps the three warning arrays separate and copies them defensively', () => {
    const settingsWarnings = ['s1'];
    const report = buildReport(
      baseInput({ settingsWarnings, rosterWarnings: ['r1'], pickWarnings: ['p1', 'p2'] }),
    );
    expect(report.settingsWarnings).toEqual(['s1']);
    expect(report.rosterWarnings).toEqual(['r1']);
    expect(report.pickWarnings).toEqual(['p1', 'p2']);
    settingsWarnings.push('mutated');
    expect(report.settingsWarnings).toEqual(['s1']);
  });

  it('passes blockers through verbatim', () => {
    const report = buildReport(baseInput({ blockers: ['already imported'] }));
    expect(report.blockers).toEqual(['already imported']);
  });

  it('carries leagueName and season', () => {
    const report = buildReport(baseInput({ leagueName: 'Brokeback Bros', season: 2025 }));
    expect(report.leagueName).toBe('Brokeback Bros');
    expect(report.season).toBe(2025);
  });
});
