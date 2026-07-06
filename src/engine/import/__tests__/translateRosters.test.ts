import { describe, it, expect } from 'vitest';
import { translateRosters } from '../translateRosters';
import { DEFAULT_SUPERFLEX_PPR } from '../../settings';
import rostersFixture from '../__fixtures__/rosters.json';
import usersFixture from '../__fixtures__/users.json';

// Every player id referenced anywhere in the rosters fixture — the real
// import pipeline would source this from a synced player table; for these
// tests it just needs to be a superset so nothing in the real fixture gets
// treated as "unknown".
function allFixturePlayerIds(): Set<string> {
  const ids = new Set<string>();
  for (const roster of rostersFixture as Array<Record<string, unknown>>) {
    const players = (roster.players as string[] | null) ?? [];
    for (const id of players) ids.add(id);
    const taxi = (roster.taxi as string[] | null) ?? [];
    for (const id of taxi) ids.add(id);
    const reserve = (roster.reserve as string[] | null) ?? [];
    for (const id of reserve) ids.add(id);
  }
  return ids;
}

const FIXTURE_PLAYER_IDS = allFixturePlayerIds();

function baseOpts(knownPlayerIds: ReadonlySet<string> = FIXTURE_PLAYER_IDS) {
  return { knownPlayerIds, settings: DEFAULT_SUPERFLEX_PPR };
}

describe('translateRosters — real league fixture', () => {
  it('translates all 12 rosters into teams', () => {
    const result = translateRosters({ rosters: rostersFixture, users: usersFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.teams).toHaveLength(12);
  });

  it("names roster 1's team from users.json metadata.team_name", () => {
    const result = translateRosters({ rosters: rostersFixture, users: usersFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team1 = result.value.teams.find((t) => t.rosterId === 1);
    expect(team1?.name).toBe('Rookie Fever');
  });

  it('assigns roster 1 exact taxi/ir/active counts from the fixture (31 players, 3 taxi, 0 reserve -> 28 active)', () => {
    const result = translateRosters({ rosters: rostersFixture, users: usersFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team1 = result.value.teams.find((t) => t.rosterId === 1);
    expect(team1).toBeDefined();
    const taxi = team1!.members.filter((m) => m.status === 'taxi');
    const ir = team1!.members.filter((m) => m.status === 'ir');
    const active = team1!.members.filter((m) => m.status === 'active');
    expect(taxi).toHaveLength(3);
    expect(ir).toHaveLength(0);
    expect(active).toHaveLength(28);
    expect(team1!.members).toHaveLength(31);
  });

  it('total member count across all teams equals the sum of fixture players arrays (389) minus skipped unknowns (0)', () => {
    const result = translateRosters({ rosters: rostersFixture, users: usersFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const totalMembers = result.value.teams.reduce((sum, t) => sum + t.members.length, 0);
    expect(totalMembers).toBe(389);
  });

  it('ignores co_owners entirely — roster 7 is named from its primary owner_id (860942655239086080), not the co-owner', () => {
    const result = translateRosters({ rosters: rostersFixture, users: usersFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team7 = result.value.teams.find((t) => t.rosterId === 7);
    expect(team7?.name).toBe('Brokeback Bros');
  });
});

describe('translateRosters — synthetic scenarios', () => {
  it('skips unknown player ids and emits one warning per roster listing them', () => {
    const rosters = [{ roster_id: 1, owner_id: 'u1', players: ['known1', 'ghost1', 'ghost2'] }];
    const users = [{ user_id: 'u1', display_name: 'Someone', metadata: { team_name: 'Team X' } }];
    const known = new Set(['known1']);
    const result = translateRosters({ rosters, users }, baseOpts(known));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team = result.value.teams[0];
    expect(team.members).toHaveLength(1);
    expect(team.members[0].playerId).toBe('known1');
    const warning = result.value.warnings.find((w) => w.includes('ghost1') && w.includes('ghost2'));
    expect(warning).toBeDefined();
  });

  it('resolves taxi+reserve overlap to taxi and warns naming the player and roster', () => {
    const rosters = [
      { roster_id: 2, owner_id: 'u2', players: ['p1'], taxi: ['p1'], reserve: ['p1'] },
    ];
    const users = [{ user_id: 'u2', display_name: 'Someone', metadata: { team_name: 'Team Y' } }];
    const known = new Set(['p1']);
    const result = translateRosters({ rosters, users }, baseOpts(known));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const team = result.value.teams[0];
    expect(team.members).toHaveLength(1);
    expect(team.members[0].status).toBe('taxi');
    const warning = result.value.warnings.find((w) => w.includes('p1') && w.includes('2'));
    expect(warning).toBeDefined();
  });

  it('suffixes duplicate team names with (2), (3), etc and warns', () => {
    const rosters = [
      { roster_id: 1, owner_id: 'u1', players: [] },
      { roster_id: 2, owner_id: 'u2', players: [] },
      { roster_id: 3, owner_id: 'u3', players: [] },
    ];
    const users = [
      { user_id: 'u1', display_name: 'A', metadata: { team_name: 'Dynasty' } },
      { user_id: 'u2', display_name: 'B', metadata: { team_name: 'Dynasty' } },
      { user_id: 'u3', display_name: 'C', metadata: { team_name: 'Dynasty' } },
    ];
    const result = translateRosters({ rosters, users }, baseOpts(new Set()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.teams.map((t) => t.name).sort();
    expect(names).toEqual(['Dynasty', 'Dynasty (2)', 'Dynasty (3)']);
    expect(result.value.warnings.some((w) => w.includes('Dynasty'))).toBe(true);
  });

  it('falls back to "Team <rosterId>" for a null owner_id with no warning about it', () => {
    const rosters = [{ roster_id: 9, owner_id: null, players: [] }];
    const result = translateRosters({ rosters, users: [] }, baseOpts(new Set()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.teams[0].name).toBe('Team 9');
    expect(result.value.warnings).toEqual([]);
  });

  it('reports a warning (but stays ok:true) when a team violates roster count settings', () => {
    // DEFAULT_SUPERFLEX_PPR capacity is 1+2+3+1+2+1+15+4+3 = 32, active pool = 32-4-3=25.
    const tooManyActive = Array.from({ length: 30 }, (_, i) => `p${i}`);
    const rosters = [{ roster_id: 1, owner_id: 'u1', players: tooManyActive }];
    const users = [{ user_id: 'u1', display_name: 'A', metadata: { team_name: 'Overloaded' } }];
    const known = new Set(tooManyActive);
    const result = translateRosters({ rosters, users }, baseOpts(known));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((w) => w.startsWith('Overloaded:'))).toBe(true);
  });

  it('returns err for non-object input', () => {
    const result = translateRosters('not an object', baseOpts(new Set()));
    expect(result.ok).toBe(false);
  });

  it('returns err when more than 32 rosters are supplied', () => {
    const rosters = Array.from({ length: 33 }, (_, i) => ({ roster_id: i + 1, owner_id: null, players: [] }));
    const result = translateRosters({ rosters, users: [] }, baseOpts(new Set()));
    expect(result.ok).toBe(false);
  });
});
