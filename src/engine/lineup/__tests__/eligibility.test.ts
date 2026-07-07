import { describe, it, expect } from 'vitest';
import { isEligible, STARTER_SLOTS } from '../eligibility';

describe('isEligible', () => {
  it('QB is eligible for QB', () => {
    expect(isEligible('QB', 'QB')).toBe(true);
  });

  it('QB is eligible for SUPER_FLEX', () => {
    expect(isEligible('QB', 'SUPER_FLEX')).toBe(true);
  });

  it('QB is NOT eligible for FLEX', () => {
    expect(isEligible('QB', 'FLEX')).toBe(false);
  });

  it('RB, WR, and TE are each eligible for FLEX and SUPER_FLEX', () => {
    for (const position of ['RB', 'WR', 'TE']) {
      expect(isEligible(position, 'FLEX')).toBe(true);
      expect(isEligible(position, 'SUPER_FLEX')).toBe(true);
      expect(isEligible(position, position)).toBe(true);
    }
  });

  it('K is eligible only for K', () => {
    expect(isEligible('K', 'K')).toBe(true);
    expect(isEligible('K', 'FLEX')).toBe(false);
    expect(isEligible('K', 'SUPER_FLEX')).toBe(false);
  });

  it('DEF is eligible only for DEF', () => {
    expect(isEligible('DEF', 'DEF')).toBe(true);
    expect(isEligible('DEF', 'FLEX')).toBe(false);
  });

  it('an unknown position is never eligible for any slot', () => {
    expect(isEligible('LB', 'FLEX')).toBe(false);
    expect(isEligible('', 'QB')).toBe(false);
  });

  it('an unknown/non-starter slot (BENCH) is never eligible, regardless of position', () => {
    expect(isEligible('QB', 'BENCH')).toBe(false);
    expect(isEligible('RB', 'BENCH')).toBe(false);
    expect(isEligible('K', 'TAXI')).toBe(false);
  });

  it('STARTER_SLOTS lists exactly the lineup-legal slots, excluding BENCH/TAXI/IR', () => {
    expect(STARTER_SLOTS).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']);
  });
});
