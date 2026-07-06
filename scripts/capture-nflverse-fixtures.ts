// Captures a small, real slice of nflverse's community weekly player-stats
// CSV plus the matching dynastyprocess player-id crosswalk rows, for the
// Phase 4 Task 5 nflverse mapping/diff engine TDD suite
// (src/engine/stats/__tests__). Sibling to capture-stats-fixtures.ts; kept
// separate because the source (nflverse/dynastyprocess GitHub release
// assets, not the Sleeper API) and the output shape (CSV slices, not raw
// JSON dumps) are different enough to not share the fetch/write helpers.
//
// Standalone script: plain fetch, no Next.js runtime dependencies.
//
// Usage: npx tsx scripts/capture-nflverse-fixtures.ts <season> <week>
// Example: npx tsx scripts/capture-nflverse-fixtures.ts 2023 17
//
// NOTE ON THE URL: the task that authored this script originally targeted
// `.../releases/download/player_stats/player_stats_2025.csv` (one CSV per
// season). That per-season asset no longer exists — nflverse consolidated
// all seasons into a single gzipped release asset, `player_stats.csv.gz`,
// under the same `player_stats` release tag. This script downloads that
// combined file and filters client-side by season/week instead.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseCSVLine } from '../src/lib/utils';

const NFLVERSE_STATS_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz';
const CROSSWALK_URL = 'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv';
const FIXTURES_DIR = join(__dirname, '..', 'src', 'engine', 'stats', '__fixtures__');

// Bounded: a hand-picked, small, diverse fixture slice, not a data dump.
const MAX_DATA_ROWS = 30;
// Only these skill positions count toward the "variety" fill after the
// named spot-check players are placed first.
const VARIETY_POSITIONS: readonly string[] = ['QB', 'RB', 'WR', 'TE'];
// nflverse player_display_name values for the three required spot-check
// players; matched case-sensitively against the real CSV.
const SPOT_CHECK_NAMES: readonly string[] = ['Christian McCaffrey', 'Derrick Henry', 'Travis Kelce'];

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

async function fetchGunzippedText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch error: ${response.status} ${response.statusText} for ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return gunzipSync(buf).toString('utf8');
}

function parseArgs(argv: readonly string[]): { season: string; week: string } {
  const [season, week] = argv;
  if (!season || !week) {
    throw new Error('Usage: npx tsx scripts/capture-nflverse-fixtures.ts <season> <week>');
  }
  return { season, week };
}

interface CsvTable {
  header: string[];
  rows: string[][];
}

function parseCsvTable(csvText: string): CsvTable {
  const lines = csvText.split('\n').filter((l) => l.length > 0);
  const [headerLine, ...dataLines] = lines;
  if (!headerLine) {
    throw new Error('empty CSV: no header row');
  }
  const header = parseCSVLine(headerLine);
  const rows = dataLines.map((line) => parseCSVLine(line));
  return { header, rows };
}

function buildCrosswalkMap(crosswalk: CsvTable): Map<string, string> {
  const gsisIdx = crosswalk.header.indexOf('gsis_id');
  const sleeperIdx = crosswalk.header.indexOf('sleeper_id');
  if (gsisIdx === -1 || sleeperIdx === -1) {
    throw new Error('crosswalk CSV missing gsis_id or sleeper_id header');
  }
  const map = new Map<string, string>();
  for (const row of crosswalk.rows) {
    const gsis = row[gsisIdx];
    const sleeper = row[sleeperIdx];
    if (gsis && sleeper) {
      map.set(gsis, sleeper);
    }
  }
  return map;
}

// Select the fixture row subset: spot-check players first, then a
// round-robin fill across QB/RB/WR/TE up to MAX_DATA_ROWS. Bounded by
// MAX_DATA_ROWS and by the fixed VARIETY_POSITIONS list.
function selectFixtureRows(
  weekRows: readonly string[][],
  header: readonly string[],
  crosswalkMap: ReadonlyMap<string, string>,
): string[][] {
  const idIdx = header.indexOf('player_id');
  const nameIdx = header.indexOf('player_display_name');
  const posIdx = header.indexOf('position');

  const crosswalkable = weekRows.filter((row) => crosswalkMap.has(row[idIdx] ?? ''));
  const priority = crosswalkable.filter((row) => SPOT_CHECK_NAMES.includes(row[nameIdx] ?? ''));
  const rest = crosswalkable.filter((row) => !SPOT_CHECK_NAMES.includes(row[nameIdx] ?? ''));

  const byPosition = new Map<string, string[][]>();
  for (const row of rest) {
    const pos = row[posIdx] ?? '';
    if (!VARIETY_POSITIONS.includes(pos)) continue;
    const bucket = byPosition.get(pos) ?? [];
    bucket.push(row);
    byPosition.set(pos, bucket);
  }

  const selected: string[][] = [...priority];
  const cursor = new Map<string, number>(VARIETY_POSITIONS.map((p) => [p, 0]));
  // Bounded: at most MAX_DATA_ROWS iterations of the outer fill loop.
  for (let i = 0; i < MAX_DATA_ROWS && selected.length < MAX_DATA_ROWS; i++) {
    let addedAny = false;
    for (const pos of VARIETY_POSITIONS) {
      if (selected.length >= MAX_DATA_ROWS) break;
      const bucket = byPosition.get(pos) ?? [];
      const at = cursor.get(pos) ?? 0;
      const row = bucket[at];
      if (row) {
        selected.push(row);
        cursor.set(pos, at + 1);
        addedAny = true;
      }
    }
    if (!addedAny) break;
  }
  return selected.slice(0, MAX_DATA_ROWS);
}

function toCsvLine(fields: readonly string[]): string {
  return fields
    .map((f) => (f.includes(',') || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f))
    .join(',');
}

async function main(): Promise<void> {
  const { season, week } = parseArgs(process.argv.slice(2));
  await mkdir(FIXTURES_DIR, { recursive: true });

  console.log(`Downloading ${NFLVERSE_STATS_URL} ...`);
  const statsCsvText = await fetchGunzippedText(NFLVERSE_STATS_URL);
  const statsTable = parseCsvTable(statsCsvText);

  console.log(`Downloading ${CROSSWALK_URL} ...`);
  const crosswalkCsvText = await fetchText(CROSSWALK_URL);
  const crosswalkTable = parseCsvTable(crosswalkCsvText);
  const crosswalkMap = buildCrosswalkMap(crosswalkTable);

  const seasonIdx = statsTable.header.indexOf('season');
  const weekIdx = statsTable.header.indexOf('week');
  const seasonTypeIdx = statsTable.header.indexOf('season_type');
  const weekRows = statsTable.rows.filter(
    (row) => row[seasonIdx] === season && row[weekIdx] === week && row[seasonTypeIdx] === 'REG',
  );
  console.log(`Found ${weekRows.length} REG rows for season=${season} week=${week}`);

  const selectedRows = selectFixtureRows(weekRows, statsTable.header, crosswalkMap);
  console.log(`Selected ${selectedRows.length} rows for the fixture (cap ${MAX_DATA_ROWS}).`);

  const statsOutLines = [toCsvLine(statsTable.header), ...selectedRows.map(toCsvLine)];
  const statsOutPath = join(FIXTURES_DIR, `nflverse-${season}-wk${week}-sample.csv`);
  await writeFile(statsOutPath, `${statsOutLines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${statsOutPath}`);

  const idIdx = statsTable.header.indexOf('player_id');
  const selectedSleeperIds = new Set(
    selectedRows.map((row) => crosswalkMap.get(row[idIdx] ?? '')).filter((v): v is string => Boolean(v)),
  );
  const sleeperIdx = crosswalkTable.header.indexOf('sleeper_id');
  const crosswalkRowsOut = crosswalkTable.rows.filter((row) => selectedSleeperIds.has(row[sleeperIdx] ?? ''));
  const crosswalkOutLines = [toCsvLine(crosswalkTable.header), ...crosswalkRowsOut.map(toCsvLine)];
  const crosswalkOutPath = join(FIXTURES_DIR, 'crosswalk-sample.csv');
  await writeFile(crosswalkOutPath, `${crosswalkOutLines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${crosswalkOutPath} (${crosswalkRowsOut.length} rows)`);

  console.log('nflverse fixture capture complete.');
}

main().catch((error) => {
  console.error('nflverse fixture capture failed:', error);
  process.exit(1);
});
