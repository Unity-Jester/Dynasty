import { describe, it, expect } from 'vitest';
import { mapSleeperPlayers, ROSTERABLE_POSITIONS } from '../playerSync';

const raw = {
  '4034': {
    player_id: '4034', full_name: 'Christian McCaffrey', position: 'RB',
    team: 'SF', status: 'Active', injury_status: null, years_exp: 9,
  },
  DEF_SF: {
    player_id: 'SF', full_name: 'San Francisco 49ers', position: 'DEF',
    team: 'SF', status: 'Active', injury_status: null, years_exp: 0,
  },
  '9999': {
    player_id: '9999', full_name: 'Some Longsnapper', position: 'LS',
    team: 'KC', status: 'Active', injury_status: null, years_exp: 3,
  },
  bad_row: { player_id: 'bad_row', position: 'QB' }, // missing required fields
};

describe('mapSleeperPlayers', () => {
  it('maps valid rosterable players to row shape', () => {
    const result = mapSleeperPlayers(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cmc = result.value.rows.find((r) => r.sleeperId === '4034');
    expect(cmc).toEqual({
      sleeperId: '4034', fullName: 'Christian McCaffrey', position: 'RB',
      nflTeam: 'SF', status: 'Active', injuryStatus: null, yearsExp: 9,
    });
  });

  it('keeps team DEF entries and drops non-rosterable positions (LS)', () => {
    const result = mapSleeperPlayers(raw);
    if (!result.ok) throw new Error('expected ok');
    const positions = result.value.rows.map((r) => r.position);
    expect(positions).toContain('DEF');
    expect(positions).not.toContain('LS');
  });

  it('counts and skips rows that fail validation instead of failing the sync', () => {
    const result = mapSleeperPlayers(raw);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.skipped).toBe(1); // bad_row
    expect(result.value.rows).toHaveLength(2); // CMC + DEF (LS filtered is not "skipped")
  });

  it('errs when the map exceeds MAX_SLEEPER_PLAYERS (bounded input)', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 30_001; i++) huge[`p${i}`] = raw['4034'];
    const result = mapSleeperPlayers(huge);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    expect(mapSleeperPlayers('nope').ok).toBe(false);
  });

  // Additional edge cases beyond the spec's 5 cases:

  it('rejects a row with an empty full_name', () => {
    const withEmptyName = {
      p1: {
        player_id: 'p1', full_name: '', position: 'RB',
        team: 'SF', status: 'Active', injury_status: null, years_exp: 1,
      },
    };
    const result = mapSleeperPlayers(withEmptyName);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.skipped).toBe(1);
    expect(result.value.rows).toHaveLength(0);
  });

  it('rejects a row where years_exp is a non-integer float', () => {
    const withFloatExp = {
      p1: {
        player_id: 'p1', full_name: 'Test Player', position: 'RB',
        team: 'SF', status: 'Active', injury_status: null, years_exp: 2.5,
      },
    };
    const result = mapSleeperPlayers(withFloatExp);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.skipped).toBe(1);
    expect(result.value.rows).toHaveLength(0);
  });

  it('defaults status to "unknown" and nflTeam/injuryStatus to null when fields are missing', () => {
    const minimal = {
      p1: { player_id: 'p1', full_name: 'Free Agent Guy', position: 'WR' },
    };
    const result = mapSleeperPlayers(minimal);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.rows).toEqual([
      {
        sleeperId: 'p1', fullName: 'Free Agent Guy', position: 'WR',
        nflTeam: null, status: 'unknown', injuryStatus: null, yearsExp: null,
      },
    ]);
  });

  it('accepts exactly MAX_SLEEPER_PLAYERS entries (boundary, not over)', () => {
    const atLimit: Record<string, unknown> = {};
    for (let i = 0; i < 30_000; i++) atLimit[`p${i}`] = raw['4034'];
    const result = mapSleeperPlayers(atLimit);
    expect(result.ok).toBe(true);
  });

  // Review follow-up: systemic-failure detection and input-guard tightening.

  it('errs on systemic parse failure (90/150 rows bad)', () => {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) map[`good${i}`] = raw['4034'];
    for (let i = 0; i < 90; i++) map[`bad${i}`] = { player_id: `bad${i}` };
    const result = mapSleeperPlayers(map);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('systemic');
  });

  it('tolerates routine skip noise below the ratio (30/150 rows bad)', () => {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 120; i++) map[`good${i}`] = raw['4034'];
    for (let i = 0; i < 30; i++) map[`bad${i}`] = { player_id: `bad${i}` };
    const result = mapSleeperPlayers(map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(30);
  });

  it('skips without failing on small maps even at a high bad ratio (below the floor)', () => {
    const map: Record<string, unknown> = {
      good: raw['4034'],
      bad1: { player_id: 'bad1' },
      bad2: { player_id: 'bad2' },
      bad3: { player_id: 'bad3' },
    };
    const result = mapSleeperPlayers(map);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skipped).toBe(3);
    expect(result.value.rows).toHaveLength(1);
  });

  it('rejects an array input explicitly', () => {
    expect(mapSleeperPlayers([]).ok).toBe(false);
  });
});
