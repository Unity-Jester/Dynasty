import { describe, it, expect } from 'vitest';
import { diffStatLines } from '../diffStats';

const KEYS = ['pass_yd', 'pass_td', 'rush_yd', 'rush_td', 'rec', 'rec_yd'] as const;

describe('diffStatLines', () => {
  it('identical stats: unchanged, merged content equals existing', () => {
    const existing = { pass_yd: 300, pass_td: 2, rush_yd: 0, rush_td: 0, rec: 0, rec_yd: 0, snp: 60 };
    const corrected = { pass_yd: 300, pass_td: 2, rush_yd: 0, rush_td: 0, rec: 0, rec_yd: 0 };
    const result = diffStatLines(existing, corrected, KEYS);
    expect(result.changed).toBe(false);
    expect(result.merged).toEqual(existing);
  });

  it('float noise within EPSILON (0.005) counts as unchanged', () => {
    const existing = { rush_yd: 64.0, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0 };
    const corrected = { rush_yd: 64.005, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0 };
    const result = diffStatLines(existing, corrected, KEYS);
    expect(result.changed).toBe(false);
    expect(result.merged.rush_yd).toBe(64.0);
  });

  it('real diff beyond EPSILON: changed, merged takes corrected value, preserves unmapped keys', () => {
    const existing = { rush_yd: 60, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0, pts_std: 6 };
    const corrected = { rush_yd: 64, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0 };
    const result = diffStatLines(existing, corrected, KEYS);
    expect(result.changed).toBe(true);
    expect(result.merged.rush_yd).toBe(64);
    expect(result.merged.pts_std).toBe(6);
  });

  it('corrected key absent from existing: changed, value added to merged', () => {
    const existing = { rush_yd: 60, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0 };
    const corrected = { rush_yd: 60, rush_td: 0, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 12 };
    const result = diffStatLines(existing, corrected, KEYS);
    expect(result.changed).toBe(true);
    expect(result.merged.rec_yd).toBe(12);
  });

  it('existing-only mapped key with no corrected counterpart is left untouched', () => {
    const existing = { rush_yd: 60, rush_td: 1, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0 };
    const corrected = { rush_yd: 60, pass_yd: 0, pass_td: 0, rec: 0, rec_yd: 0 }; // no rush_td
    const result = diffStatLines(existing, corrected, KEYS);
    expect(result.changed).toBe(false);
    expect(result.merged.rush_td).toBe(1);
  });

  it('empty keys list: always unchanged regardless of differing values', () => {
    const existing = { rush_yd: 60 };
    const corrected = { rush_yd: 999 };
    const result = diffStatLines(existing, corrected, []);
    expect(result.changed).toBe(false);
    expect(result.merged).toEqual(existing);
  });
});
