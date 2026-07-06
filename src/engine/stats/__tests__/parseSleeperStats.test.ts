import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSleeperStats } from '../parseSleeperStats';

// Real Sleeper week-17 2025 fixture (2,476 entries), committed by the Task 1 spike.
const wk17Fixture: Record<string, unknown> = JSON.parse(
  readFileSync(join(__dirname, '../__fixtures__/sleeper-2025-wk17.json'), 'utf8'),
);

// Synthetic entry mirroring the real CMC shape, used for deterministic (non-fixture) tests.
const cmcLike = {
  rush_td: 1,
  rec: 4,
  rush_yd: 140,
  pts_ppr: 28.1,
};

describe('parseSleeperStats', () => {
  it('parses the real wk17 CMC (4034) line with correct rush_td and rec', () => {
    const knownPlayerIds = new Set(['4034']);
    const result = parseSleeperStats(wk17Fixture, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cmc = result.value.lines.find((l) => l.playerId === '4034');
    expect(cmc).toBeDefined();
    expect(cmc?.stats.rush_td).toBe(1);
    expect(cmc?.stats.rec).toBe(4);
  });

  it('fixture-scale: knownIds = all fixture keys yields lines.length === entries - skippedInvalid', () => {
    const knownPlayerIds = new Set(Object.keys(wk17Fixture));
    const result = parseSleeperStats(wk17Fixture, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Derived with node: 2476 entries, 0 skippedInvalid (every entry is a
    // non-empty numeric-value object; max 92 numeric keys, under the 120 cap).
    expect(Object.keys(wk17Fixture).length).toBe(2476);
    expect(result.value.skippedInvalid).toBe(0);
    expect(result.value.lines.length).toBe(2476 - result.value.skippedInvalid);
    expect(result.value.skippedUnknown).toBe(0);
  });

  it('excludes TEAM_BUF when absent from knownIds while including BUF when present', () => {
    // Both keys are real entries in the wk17 fixture (verified via node: 'TEAM_BUF'
    // and 'BUF' both exist as top-level keys). Only 'BUF' is a real players-table id
    // (the DEF team code); TEAM_BUF is an offensive rollup absent from `players`.
    const knownPlayerIds = new Set(['BUF']);
    const result = parseSleeperStats(wk17Fixture, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.lines.map((l) => l.playerId);
    expect(ids).not.toContain('TEAM_BUF');
    expect(ids).toContain('BUF');
  });

  it('drops non-numeric values (string/null/nested object) from a synthetic entry', () => {
    const input = {
      p1: {
        rush_td: 1,
        note: 'some string',
        injury: null,
        nested: { a: 1 },
        active: true,
        rec: 4,
      },
    };
    const knownPlayerIds = new Set(['p1']);
    const result = parseSleeperStats(input, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.value.lines.find((l) => l.playerId === 'p1');
    expect(line?.stats).toEqual({ rush_td: 1, rec: 4 });
  });

  it('counts a zero-numeric-key line as skippedInvalid', () => {
    const input = {
      p1: { note: 'no numbers here', injury: null },
    };
    const knownPlayerIds = new Set(['p1']);
    const result = parseSleeperStats(input, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedInvalid).toBe(1);
    expect(result.value.lines).toHaveLength(0);
  });

  it('rejects an array input explicitly', () => {
    const result = parseSleeperStats([], { knownPlayerIds: new Set() });
    expect(result.ok).toBe(false);
  });

  it('rejects other non-map input (null, primitives)', () => {
    expect(parseSleeperStats(null, { knownPlayerIds: new Set() }).ok).toBe(false);
    expect(parseSleeperStats('nope', { knownPlayerIds: new Set() }).ok).toBe(false);
    expect(parseSleeperStats(42, { knownPlayerIds: new Set() }).ok).toBe(false);
  });

  it('errs when entries exceed MAX_STAT_ENTRIES (10_001 entries)', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 10_001; i++) huge[`p${i}`] = cmcLike;
    const knownPlayerIds = new Set(Object.keys(huge));
    const result = parseSleeperStats(huge, { knownPlayerIds });
    expect(result.ok).toBe(false);
  });

  it('errs on systemic parse failure (90/150 bad, over the ratio)', () => {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) map[`good${i}`] = cmcLike;
    for (let i = 0; i < 90; i++) map[`bad${i}`] = { note: 'no numbers' };
    const knownPlayerIds = new Set(Object.keys(map));
    const result = parseSleeperStats(map, { knownPlayerIds });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('systemic');
  });

  it('tolerates routine skip noise below the ratio (30/150 bad)', () => {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 120; i++) map[`good${i}`] = cmcLike;
    for (let i = 0; i < 30; i++) map[`bad${i}`] = { note: 'no numbers' };
    const knownPlayerIds = new Set(Object.keys(map));
    const result = parseSleeperStats(map, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedInvalid).toBe(30);
    expect(result.value.lines).toHaveLength(120);
  });

  it('the entry-count floor protects small maps even at a high bad ratio (3/4 bad)', () => {
    const map: Record<string, unknown> = {
      good: cmcLike,
      bad1: { note: 'x' },
      bad2: { note: 'x' },
      bad3: { note: 'x' },
    };
    const knownPlayerIds = new Set(Object.keys(map));
    const result = parseSleeperStats(map, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedInvalid).toBe(3);
    expect(result.value.lines).toHaveLength(1);
  });

  it('skippedUnknown does NOT count toward the systemic tripwire', () => {
    // 200 entries, all unknown (not in knownPlayerIds), zero invalid — must
    // stay ok:true even though "skip rate" as a whole is 100%.
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) map[`p${i}`] = cmcLike;
    const result = parseSleeperStats(map, { knownPlayerIds: new Set() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedUnknown).toBe(200);
    expect(result.value.skippedInvalid).toBe(0);
    expect(result.value.lines).toHaveLength(0);
  });

  it('caps numeric keys per line at MAX_KEYS_PER_LINE, counting overflow as skippedInvalid', () => {
    const tooManyKeys: Record<string, number> = {};
    for (let i = 0; i < 121; i++) tooManyKeys[`stat_${i}`] = i;
    const input = { p1: tooManyKeys };
    const knownPlayerIds = new Set(['p1']);
    const result = parseSleeperStats(input, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.skippedInvalid).toBe(1);
    expect(result.value.lines).toHaveLength(0);
  });

  it('every emitted playerId is a member of knownPlayerIds (invariant spot-check)', () => {
    const knownPlayerIds = new Set(['4034', 'BAL']);
    const result = parseSleeperStats(wk17Fixture, { knownPlayerIds });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const line of result.value.lines) {
      expect(knownPlayerIds.has(line.playerId)).toBe(true);
    }
    expect(result.value.lines).toHaveLength(2);
  });
});
