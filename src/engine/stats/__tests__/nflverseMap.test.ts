import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCSVLine } from '@/lib/utils';
import { MAPPED_SLEEPER_KEYS, mapNflverseRow, parseCrosswalk } from '../nflverseMap';

const statsFixtureText = readFileSync(
  join(__dirname, '../__fixtures__/nflverse-2023-wk17-sample.csv'),
  'utf8',
);
const crosswalkFixtureText = readFileSync(join(__dirname, '../__fixtures__/crosswalk-sample.csv'), 'utf8');

// Parse the stats fixture into row objects the same way the real reconcile
// job will: header + parseCSVLine per data row.
function parseFixtureRows(csvText: string): Record<string, string>[] {
  const lines = csvText.split('\n').filter((l) => l.length > 0);
  const header = parseCSVLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const fields = parseCSVLine(line);
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      row[key] = fields[i] ?? '';
    });
    return row;
  });
}

describe('mapNflverseRow', () => {
  it('maps the real CMC (gsis 00-0033280) wk17 2023 row to exact Sleeper stat literals', () => {
    const rows = parseFixtureRows(statsFixtureText);
    const cmc = rows.find((r) => r.player_id === '00-0033280');
    expect(cmc).toBeDefined();
    if (!cmc) return;
    const mapped = mapNflverseRow(cmc);
    // Derived directly from the fixture row via node (see __fixtures__/README.md).
    expect(mapped.rush_yd).toBe(64);
    expect(mapped.rush_td).toBe(0);
    expect(mapped.rec).toBe(4);
    expect(mapped.rec_yd).toBe(27);
    expect(mapped.rec_td).toBe(0);
    // fum_lost is deliberately NOT emitted even though all three nflverse
    // fumbles-lost components are present in this row — see the exclusion
    // regression tests below.
    expect(mapped.fum_lost).toBeUndefined();
  });

  // Regression: nflverse's fumbles-lost columns (sack/rushing/receiving) cover
  // OFFENSIVE fumbles only, while Sleeper's fum_lost includes special teams.
  // A narrower source must never zero a wider one (live 2023 wk17: nflverse's
  // 0 would have erased real -2/fumble points for kick returners). fum_lost is
  // therefore excluded from the mapping entirely.
  it('never emits fum_lost, even when all fumbles-lost components are present and nonzero', () => {
    const row: Record<string, string> = {
      sack_fumbles_lost: '1',
      rushing_fumbles_lost: '1',
      receiving_fumbles_lost: '0',
    };
    const mapped = mapNflverseRow(row);
    expect(mapped.fum_lost).toBeUndefined();
  });

  it('excludes fum_lost from the exported mapped-keys list the reconcile diff uses', () => {
    expect(MAPPED_SLEEPER_KEYS).not.toContain('fum_lost');
    // Sanity: the list still carries the 1:1 mapped keys.
    expect(MAPPED_SLEEPER_KEYS).toContain('rush_yd');
    expect(MAPPED_SLEEPER_KEYS).toContain('rec_yd');
  });

  it('drops empty-string and non-numeric mapped columns instead of coercing to 0/NaN', () => {
    const row: Record<string, string> = {
      passing_yards: '',
      rushing_yards: 'NA',
      receiving_yards: '12',
    };
    const mapped = mapNflverseRow(row);
    expect(mapped.pass_yd).toBeUndefined();
    expect(mapped.rush_yd).toBeUndefined();
    expect(mapped.rec_yd).toBe(12);
  });

  it('omits fum_lost when no fumble-lost components are present (exclusion holds trivially)', () => {
    const row: Record<string, string> = { receiving_yards: '12' };
    const mapped = mapNflverseRow(row);
    expect(mapped.fum_lost).toBeUndefined();
  });

  it('bounds output keys to at most the mapping size (no aggregations)', () => {
    const rows = parseFixtureRows(statsFixtureText);
    for (const row of rows) {
      const mapped = mapNflverseRow(row);
      expect(Object.keys(mapped).length).toBeLessThanOrEqual(12); // the 12 1:1 mapped cols
    }
  });
});

describe('parseCrosswalk', () => {
  it('parses the real crosswalk fixture and resolves the known CMC gsis->sleeper pair', () => {
    const result = parseCrosswalk(crosswalkFixtureText);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byGsis.get('00-0033280')).toBe('4034');
    expect(result.value.byGsis.get('00-0032764')).toBe('3198');
    expect(result.value.byGsis.get('00-0030506')).toBe('1466');
  });

  it('errs when a required header (gsis_id or sleeper_id) is missing', () => {
    const csv = 'name,team\nSome Guy,KC\n';
    const result = parseCrosswalk(csv);
    expect(result.ok).toBe(false);
  });

  it('skips (and counts) rows missing either gsis_id or sleeper_id', () => {
    const csv = 'gsis_id,sleeper_id\n00-0000001,100\n,200\n00-0000003,\n00-0000004,400\n';
    const result = parseCrosswalk(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byGsis.size).toBe(2);
    expect(result.value.skipped).toBe(2);
  });

  // Regression: the live db_playerids.csv carries the sentinel "NA" on
  // thousands of rows and a handful of genuinely duplicate gsis_ids. Both
  // previously broke the byGsis.size-based accounting invariant.
  it('treats "NA" sentinel ids as skipped, not as a real mapping', () => {
    const csv = 'gsis_id,sleeper_id\nNA,100\n00-0000002,NA\n00-0000003,300\n';
    const result = parseCrosswalk(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byGsis.size).toBe(1);
    expect(result.value.byGsis.has('NA')).toBe(false);
    expect(result.value.skipped).toBe(2);
  });

  it('tolerates duplicate gsis_ids (last wins) without failing accounting', () => {
    const csv = 'gsis_id,sleeper_id\n00-0000001,100\n00-0000001,101\n00-0000002,200\n';
    const result = parseCrosswalk(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two rows collapse onto one key — size(2) < rows(3), yet no invariant throw.
    expect(result.value.byGsis.size).toBe(2);
    expect(result.value.byGsis.get('00-0000001')).toBe('101');
    expect(result.value.skipped).toBe(0);
  });
});
