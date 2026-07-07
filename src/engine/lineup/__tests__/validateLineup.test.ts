import { describe, it, expect } from 'vitest';
import { validateLineup, type LineupAssignment } from '../validateLineup';
import { DEFAULT_SUPERFLEX_PPR } from '../../settings';

// DEFAULT_SUPERFLEX_PPR starters: QB 1, RB 2, WR 3, TE 1, FLEX 2, SUPER_FLEX 1,
// K 0, DEF 0 (only QB/RB/WR/TE/FLEX/SUPER_FLEX are configured) => 10 instances.
// K/DEF are lineup-legal slots per STARTER_SLOTS but this default league does
// not configure any starter count for them, so no instances are expected.

function fullLineup(overrides: Partial<Record<string, string | null>> = {}): LineupAssignment[] {
  const base: LineupAssignment[] = [
    { slot: 'QB', slotIndex: 0, playerId: 'qb1' },
    { slot: 'RB', slotIndex: 0, playerId: 'rb1' },
    { slot: 'RB', slotIndex: 1, playerId: 'rb2' },
    { slot: 'WR', slotIndex: 0, playerId: 'wr1' },
    { slot: 'WR', slotIndex: 1, playerId: 'wr2' },
    { slot: 'WR', slotIndex: 2, playerId: 'wr3' },
    { slot: 'TE', slotIndex: 0, playerId: 'te1' },
    { slot: 'FLEX', slotIndex: 0, playerId: 'rb3' },
    { slot: 'FLEX', slotIndex: 1, playerId: 'wr4' },
    { slot: 'SUPER_FLEX', slotIndex: 0, playerId: 'qb2' },
  ];
  const key = (a: LineupAssignment) => `${a.slot}:${a.slotIndex}`;
  const overrideKeys = new Set(Object.keys(overrides));
  return base.map((a) => {
    const explicitKey = [...overrideKeys].find((k) => key(a) === k);
    return explicitKey ? { ...a, playerId: overrides[explicitKey] ?? null } : a;
  });
}

const ALL_PLAYERS = [
  'qb1', 'qb2', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'wr3', 'wr4', 'te1', 'bench1', 'k1', 'def1',
];

const POSITIONS = new Map<string, string>([
  ['qb1', 'QB'], ['qb2', 'QB'],
  ['rb1', 'RB'], ['rb2', 'RB'], ['rb3', 'RB'],
  ['wr1', 'WR'], ['wr2', 'WR'], ['wr3', 'WR'], ['wr4', 'WR'],
  ['te1', 'TE'],
  ['bench1', 'RB'],
  ['k1', 'K'],
  ['def1', 'DEF'],
]);

function members(activeIds: readonly string[], statusOverrides: Record<string, 'taxi' | 'ir'> = {}) {
  return activeIds.map((playerId) => ({
    playerId,
    status: statusOverrides[playerId] ?? ('active' as const),
  }));
}

function baseInput(overrides: Partial<Parameters<typeof validateLineup>[0]> = {}) {
  return {
    settings: DEFAULT_SUPERFLEX_PPR,
    members: members(ALL_PLAYERS),
    playerPositions: POSITIONS,
    current: fullLineup(),
    proposed: fullLineup(),
    lockedNflTeams: new Set<string>(),
    playerNflTeams: new Map<string, string | null>(),
    ...overrides,
  };
}

describe('validateLineup', () => {
  it('accepts a full legal lineup', () => {
    const result = validateLineup(baseInput());
    expect(result.ok).toBe(true);
  });

  it('accepts a lineup with some empty (null) slots', () => {
    const proposed = fullLineup({ 'FLEX:1': null, 'SUPER_FLEX:0': null });
    const result = validateLineup(baseInput({ current: proposed, proposed }));
    expect(result.ok).toBe(true);
  });

  it('shape_mismatch: missing an instance', () => {
    const proposed = fullLineup().filter((a) => !(a.slot === 'SUPER_FLEX' && a.slotIndex === 0));
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'shape_mismatch' });
  });

  it('shape_mismatch: extra assignment beyond the configured instances', () => {
    const proposed = [...fullLineup(), { slot: 'FLEX', slotIndex: 2, playerId: null }];
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'shape_mismatch' });
  });

  it('shape_mismatch: slotIndex out of range for a configured slot', () => {
    const proposed = fullLineup().map((a) =>
      a.slot === 'RB' && a.slotIndex === 1 ? { ...a, slotIndex: 5 } : a,
    );
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'shape_mismatch' });
  });

  it('shape_mismatch: duplicated (slot, slotIndex) instance', () => {
    const proposed = fullLineup().map((a) =>
      a.slot === 'RB' && a.slotIndex === 1 ? { ...a, slotIndex: 0 } : a,
    );
    // Now missing RB:1 and RB:0 appears twice.
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'shape_mismatch' });
  });

  it('precedence: shape_mismatch wins over an off-roster player elsewhere in the same proposal', () => {
    const proposed = fullLineup({ 'QB:0': 'not_on_roster_guy' }).filter(
      (a) => !(a.slot === 'SUPER_FLEX' && a.slotIndex === 0),
    );
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'shape_mismatch' });
  });

  it('not_on_roster: playerId not present in members', () => {
    const proposed = fullLineup({ 'QB:0': 'ghost_player' });
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'not_on_roster' });
  });

  it('not_active: a taxi-squad player cannot start', () => {
    const proposed = fullLineup({ 'QB:0': 'bench1' });
    const result = validateLineup(
      baseInput({
        proposed,
        members: members(ALL_PLAYERS, { bench1: 'taxi' }),
        playerPositions: new Map(POSITIONS).set('bench1', 'QB'),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: 'not_active', detail: expect.stringMatching(/taxi/) });
  });

  it('not_active: an IR player cannot start', () => {
    const proposed = fullLineup({ 'QB:0': 'bench1' });
    const result = validateLineup(
      baseInput({
        proposed,
        members: members(ALL_PLAYERS, { bench1: 'ir' }),
        playerPositions: new Map(POSITIONS).set('bench1', 'QB'),
      }),
    );
    expect(result).toMatchObject({ ok: false, error: 'not_active', detail: expect.stringMatching(/ir/) });
  });

  it('ineligible_position: QB cannot start in FLEX', () => {
    const proposed = fullLineup({ 'FLEX:0': 'qb1', 'SUPER_FLEX:0': null });
    // Free up qb1 from QB:0 so it's not a duplicate-player case; put someone else there.
    const adjusted = proposed.map((a) => (a.slot === 'QB' && a.slotIndex === 0 ? { ...a, playerId: 'qb2' } : a));
    const result = validateLineup(baseInput({ proposed: adjusted }));
    expect(result).toMatchObject({ ok: false, error: 'ineligible_position' });
  });

  it('ok: QB can start in SUPER_FLEX', () => {
    // This is exactly the happy-path fixture (qb2 sits in SUPER_FLEX already).
    const result = validateLineup(baseInput());
    expect(result.ok).toBe(true);
  });

  it('ineligible_position: K cannot start in WR', () => {
    const proposed = fullLineup({ 'WR:0': 'k1' });
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'ineligible_position' });
  });

  it('ineligible_position: unknown position maps to false, detail says unknown position', () => {
    const proposed = fullLineup({ 'QB:0': 'mystery1' });
    const result = validateLineup(
      baseInput({
        proposed,
        members: [...members(ALL_PLAYERS), { playerId: 'mystery1', status: 'active' }],
        // Deliberately no entry for mystery1 in playerPositions.
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: 'ineligible_position',
      detail: expect.stringMatching(/unknown position/i),
    });
  });

  it('duplicate_player: same player assigned to two instances', () => {
    const proposed = fullLineup({ 'SUPER_FLEX:0': 'qb1' }); // qb1 already at QB:0
    const result = validateLineup(baseInput({ proposed }));
    expect(result).toMatchObject({ ok: false, error: 'duplicate_player' });
  });

  describe('locked_change', () => {
    const lockedTeams = new Set(['NE']);
    const nflTeams = new Map<string, string | null>([
      ['qb1', 'NE'],
      ['qb2', 'KC'],
      ['bench1', 'NE'],
      ['rb1', null],
    ]);

    it('rejects benching a locked starter (outgoing locked player)', () => {
      const current = fullLineup();
      const proposed = fullLineup({ 'QB:0': null });
      const result = validateLineup(
        baseInput({ current, proposed, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result).toMatchObject({ ok: false, error: 'locked_change' });
    });

    it('rejects inserting a locked player from the bench (incoming locked player)', () => {
      const current = fullLineup({ 'QB:0': null });
      const proposed = fullLineup({ 'QB:0': null, 'SUPER_FLEX:0': null });
      // Move a locked bench player (bench1, NE) into an empty SUPER_FLEX slot.
      const proposedWithInsert = proposed.map((a) =>
        a.slot === 'SUPER_FLEX' && a.slotIndex === 0 ? { ...a, playerId: 'bench1' } : a,
      );
      const result = validateLineup(
        baseInput({
          current,
          proposed: proposedWithInsert,
          lockedNflTeams: lockedTeams,
          playerNflTeams: nflTeams,
          playerPositions: new Map(POSITIONS).set('bench1', 'QB'),
        }),
      );
      expect(result).toMatchObject({ ok: false, error: 'locked_change' });
    });

    it('rejects moving a locked player between two instances (both count as changes)', () => {
      const current = fullLineup(); // qb1 (locked, NE) at QB:0
      const proposed = fullLineup({ 'QB:0': null, 'SUPER_FLEX:0': 'qb1' });
      // qb2 was at SUPER_FLEX:0; now bumped out. qb1 moves QB:0 -> SUPER_FLEX:0.
      const result = validateLineup(
        baseInput({ current, proposed, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result).toMatchObject({ ok: false, error: 'locked_change' });
    });

    it('rejects a locked player swapped with an unlocked player across two instances, even though the locked player is still in the lineup overall (guards against a by-player-set diff instead of by-instance)', () => {
      const current = fullLineup(); // qb1 (locked, NE) at QB:0; qb2 (unlocked, KC) at SUPER_FLEX:0
      // Swap them: qb1 moves to SUPER_FLEX:0, qb2 moves to QB:0. A diff that only
      // compared "is qb1 still assigned somewhere" (rather than per-instance) would
      // wrongly see this as a no-op for qb1 and miss the violation.
      const proposed = fullLineup({ 'QB:0': 'qb2', 'SUPER_FLEX:0': 'qb1' });
      const result = validateLineup(
        baseInput({ current, proposed, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result).toMatchObject({ ok: false, error: 'locked_change' });
    });

    it('allows an unchanged locked instance alongside a changed unlocked instance in the same save', () => {
      const current = fullLineup();
      // qb1 (locked) stays put at QB:0; only change an unlocked instance (WR:0).
      const proposed = fullLineup({ 'WR:0': 'bench1' });
      // bench1 must be eligible for WR to isolate this to the lock check; give it WR
      // position, active status, and an unlocked team (overriding the NE default).
      const result = validateLineup(
        baseInput({
          current,
          proposed,
          lockedNflTeams: lockedTeams,
          playerNflTeams: new Map(nflTeams).set('bench1', 'KC'),
          playerPositions: new Map(POSITIONS).set('bench1', 'WR'),
        }),
      );
      expect(result.ok).toBe(true);
    });

    it('never rejects a player with no NFL team on file (null/absent team is never locked)', () => {
      const current = fullLineup();
      // rb1 has a null team in nflTeams; benching it must be allowed re: locks.
      const proposed = fullLineup({ 'RB:0': null });
      const result = validateLineup(
        baseInput({ current, proposed, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result.ok).toBe(true);
    });

    it('first save (current is empty) rejects a locked incoming player', () => {
      const proposed = fullLineup(); // qb1 (locked, NE) proposed at QB:0
      const result = validateLineup(
        baseInput({ current: [], proposed, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result).toMatchObject({ ok: false, error: 'locked_change' });
    });

    it('first save (current is empty) accepts an all-unlocked proposed lineup', () => {
      const proposed = fullLineup({ 'QB:0': 'qb2' }); // qb2 is KC, unlocked; avoid duplicate with SUPER_FLEX qb2
      const adjusted = proposed.map((a) =>
        a.slot === 'SUPER_FLEX' && a.slotIndex === 0 ? { ...a, playerId: null } : a,
      );
      const result = validateLineup(
        baseInput({ current: [], proposed: adjusted, lockedNflTeams: lockedTeams, playerNflTeams: nflTeams }),
      );
      expect(result.ok).toBe(true);
    });
  });
});
