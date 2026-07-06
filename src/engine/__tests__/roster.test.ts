import { describe, it, expect } from 'vitest';
import { validateRosterCounts } from '../roster';
import { DEFAULT_SUPERFLEX_PPR } from '../settings';

const members = (active: number, taxi: number, ir: number) => [
  ...Array.from({ length: active }, (_, i) => ({ playerId: `a${i}`, status: 'active' as const })),
  ...Array.from({ length: taxi }, (_, i) => ({ playerId: `t${i}`, status: 'taxi' as const })),
  ...Array.from({ length: ir }, (_, i) => ({ playerId: `i${i}`, status: 'ir' as const })),
];

describe('validateRosterCounts', () => {
  it('accepts a full legal roster (25 active, 4 taxi, 3 ir)', () => {
    expect(validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(25, 4, 3)).ok).toBe(true);
  });

  it('rejects a 26th active player as over the active pool', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(26, 0, 0));
    expect(r).toMatchObject({ ok: false, error: 'over_capacity' });
  });

  it('rejects a 5th taxi member', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(10, 5, 0));
    expect(r).toMatchObject({ ok: false, error: 'taxi_full' });
  });

  it('rejects a 4th IR member', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(10, 0, 4));
    expect(r).toMatchObject({ ok: false, error: 'ir_full' });
  });

  it('accepts an empty roster', () => {
    expect(validateRosterCounts(DEFAULT_SUPERFLEX_PPR, []).ok).toBe(true);
  });

  it('precedence: over_capacity reported before taxi_full when both violated', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(30, 6, 0));
    expect(r).toMatchObject({ ok: false, error: 'over_capacity' });
  });

  // Added during self-review: precedence — over_capacity must also win over ir_full
  // (not explicitly covered above; only the taxi precedence was pinned).
  it('precedence: over_capacity reported before ir_full when both violated', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(30, 0, 5));
    expect(r).toMatchObject({ ok: false, error: 'over_capacity' });
  });

  // Added during self-review: a league with no TAXI/IR slots configured at all
  // (entries omitted, not count: 0 — see settings.ts canonical-form comment).
  // A single taxi member must still fail taxi_full against a 0-count cap.
  it('rejects a taxi member when the league has no TAXI slot configured', () => {
    const noTaxiOrIr = {
      ...DEFAULT_SUPERFLEX_PPR,
      rosterSlots: DEFAULT_SUPERFLEX_PPR.rosterSlots.filter(
        (s) => s.slot !== 'TAXI' && s.slot !== 'IR',
      ),
    };
    const r = validateRosterCounts(noTaxiOrIr, members(5, 1, 0));
    expect(r).toMatchObject({ ok: false, error: 'taxi_full' });
  });

  // Added during self-review: assert the detail string actually states counts,
  // per the spec's example format.
  it('detail string states the active count and pool size', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(26, 0, 0));
    expect(r).toMatchObject({
      ok: false,
      detail: '26 active players exceeds the 25-player active pool',
    });
  });
});
