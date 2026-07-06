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

// ============================================================================
// fum_lost is DELIBERATELY EXCLUDED from this mapping.
//
// nflverse splits fumbles-lost into sack_fumbles_lost / rushing_fumbles_lost /
// receiving_fumbles_lost — OFFENSIVE fumbles only. Sleeper's single fum_lost
// also counts special-teams fumbles (kick/punt returners). A narrower source
// must not zero a wider one: summing nflverse's components and overriding
// Sleeper would erase real fantasy points (observed live, 2023 wk17: three
// returner fum_lost=1 rows that nflverse's offensive columns cannot see;
// fum_lost scores -2, enough to flip matchups). Sleeper keeps sole authority
// for fum_lost; do not re-add an aggregation here without a source that
// covers all fumble phases.
// ============================================================================

// The Sleeper keys nflverse has override authority for — exactly the 1:1
// mapping values above. The reconcile job's diff is restricted to this list.
export const MAPPED_SLEEPER_KEYS: readonly string[] = Object.values(NFLVERSE_TO_SLEEPER);

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

// Map one nflverse CSV row (already split into a header->field Record) to
// Sleeper stat keys. Bounded output: at most MAPPING_SIZE keys — strictly the
// 1:1 mapping, no aggregations (fum_lost exclusion documented above).
export function mapNflverseRow(row: Record<string, string>): Record<string, number> {
  const mapped: Record<string, number> = {};

  for (const [nflverseKey, sleeperKey] of Object.entries(NFLVERSE_TO_SLEEPER)) {
    const value = parseNumericField(row[nflverseKey]);
    if (value !== undefined) {
      mapped[sleeperKey] = value;
    }
  }

  invariant(Object.keys(mapped).length <= MAPPING_SIZE, 'mapNflverseRow produced more keys than the mapping allows');
  invariant(
    Object.values(mapped).every((v) => Number.isFinite(v)),
    'mapNflverseRow produced a non-finite stat value',
  );

  return mapped;
}

// A crosswalk id is usable only when non-empty and not dynastyprocess's "NA"
// sentinel (the live file carries "NA" on thousands of rows for players
// without a real id). Blank or "NA" on either side -> row is skipped.
function isUsableId(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== 'NA';
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
  let mapped = 0;
  for (const line of lines.slice(1)) {
    const fields = parseCSVLine(line);
    const gsis = fields[gsisIdx];
    const sleeper = fields[sleeperIdx];
    if (!isUsableId(gsis) || !isUsableId(sleeper)) {
      skipped += 1;
      continue;
    }
    invariant(gsis !== undefined && sleeper !== undefined, 'usable id unexpectedly undefined');
    byGsis.set(gsis, sleeper);
    mapped += 1;
  }

  // Count rows PROCESSED (mapped), not the map's final size: the live file has
  // duplicate gsis_ids that legitimately overwrite, so byGsis.size < mapped.
  invariant(mapped + skipped === lines.length - 1, 'crosswalk row accounting did not add up');

  return { ok: true, value: { byGsis, skipped } };
}
