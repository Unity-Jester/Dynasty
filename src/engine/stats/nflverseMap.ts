import { invariant } from '@/lib/invariant';
import { parseCSVLine } from '@/lib/utils';

// nflverse's community weekly player-stats CSV renames columns occasionally
// (see __fixtures__/README.md for the header verified against a real
// download). This mapping is the contract: nflverse column -> Sleeper stat
// key. Verified against player_stats.csv (season 2023, week 17, REG) on
// 2026-07-06. Notably `interceptions`, not `passing_interceptions`.
export const NFLVERSE_TO_SLEEPER = {
  passing_yards: 'pass_yd',
  passing_tds: 'pass_td',
  interceptions: 'pass_int',
  passing_2pt_conversions: 'pass_2pt',
  rushing_yards: 'rush_yd',
  rushing_tds: 'rush_td',
  rushing_2pt_conversions: 'rush_2pt',
  receptions: 'rec',
  receiving_yards: 'rec_yd',
  receiving_tds: 'rec_td',
  receiving_2pt_conversions: 'rec_2pt',
  special_teams_tds: 'st_td',
} as const;

const MAPPING_SIZE = Object.keys(NFLVERSE_TO_SLEEPER).length;
// One aggregation beyond the 1:1 mapping: Sleeper's single fum_lost equals
// the sum of nflverse's three phase-specific fumbles-lost columns.
const FUM_LOST_COMPONENTS = ['sack_fumbles_lost', 'rushing_fumbles_lost', 'receiving_fumbles_lost'] as const;

const MAX_CROSSWALK_ROWS = 20_000;

export type CrosswalkResult =
  | { ok: true; value: { byGsis: Map<string, string>; skipped: number } }
  | { ok: false; error: string };

// Parse-don't-cast: Number() a raw CSV string field, dropping anything
// that isn't a finite number (empty string, "NA", undefined).
function parseNumericField(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// Sum the three fumbles-lost components, but only when at least one is
// actually present in the row (absence of all three is not evidence of
// zero — it means the column set didn't include them at all).
function computeFumLost(row: Record<string, string>): number | undefined {
  const values = FUM_LOST_COMPONENTS.map((key) => parseNumericField(row[key]));
  const anyPresent = values.some((v) => v !== undefined);
  if (!anyPresent) return undefined;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

// Map one nflverse CSV row (already split into a header->field Record) to
// Sleeper stat keys. Bounded output: at most MAPPING_SIZE + 1 keys
// (the +1 is fum_lost, the one aggregation).
export function mapNflverseRow(row: Record<string, string>): Record<string, number> {
  const mapped: Record<string, number> = {};

  for (const [nflverseKey, sleeperKey] of Object.entries(NFLVERSE_TO_SLEEPER)) {
    const value = parseNumericField(row[nflverseKey]);
    if (value !== undefined) {
      mapped[sleeperKey] = value;
    }
  }

  const fumLost = computeFumLost(row);
  if (fumLost !== undefined) {
    mapped.fum_lost = fumLost;
  }

  invariant(Object.keys(mapped).length <= MAPPING_SIZE + 1, 'mapNflverseRow produced more keys than the mapping allows');
  invariant(
    Object.values(mapped).every((v) => Number.isFinite(v)),
    'mapNflverseRow produced a non-finite stat value',
  );

  return mapped;
}

// Parse the dynastyprocess db_playerids crosswalk CSV into a gsis_id ->
// sleeper_id map. Bounded by MAX_CROSSWALK_ROWS; rows missing either id are
// skipped (and counted), not treated as an error — the file legitimately
// carries ids for players without a Sleeper mapping.
export function parseCrosswalk(csvText: string): CrosswalkResult {
  const lines = csvText.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { ok: false, error: 'crosswalk CSV is empty' };
  }
  if (lines.length - 1 > MAX_CROSSWALK_ROWS) {
    return { ok: false, error: `crosswalk CSV exceeds MAX_CROSSWALK_ROWS (${lines.length - 1})` };
  }

  const header = parseCSVLine(lines[0] ?? '');
  const gsisIdx = header.indexOf('gsis_id');
  const sleeperIdx = header.indexOf('sleeper_id');
  if (gsisIdx === -1 || sleeperIdx === -1) {
    return { ok: false, error: 'crosswalk CSV missing required header (gsis_id and/or sleeper_id)' };
  }

  const byGsis = new Map<string, string>();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const fields = parseCSVLine(line);
    const gsis = fields[gsisIdx];
    const sleeper = fields[sleeperIdx];
    if (!gsis || !sleeper) {
      skipped += 1;
      continue;
    }
    byGsis.set(gsis, sleeper);
  }

  invariant(byGsis.size + skipped === lines.length - 1, 'crosswalk row accounting did not add up');

  return { ok: true, value: { byGsis, skipped } };
}
