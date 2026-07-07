// Captures the real 2025 Sleeper season used as the golden fixture for the
// Phase 5 scoring engine: replay this league's matchups through our scoring
// engine and match Sleeper's official numbers. Predecessor league "Any Given
// Sunday (DYNASTY)", season 2025, status complete, 12 rosters.
//
// Standalone script: deliberately does NOT import src/lib/sleeper.ts (that
// module's fetch call uses Next.js-specific `next: { revalidate }` fetch
// options that don't apply outside the Next runtime). Uses plain fetch, same
// house style as scripts/capture-stats-fixtures.ts.
//
// Usage: npx tsx scripts/capture-golden-fixtures.ts [leagueId]
// Defaults to the real 2025 predecessor league id below if omitted.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
const FIXTURES_DIR = join(__dirname, '..', 'src', 'engine', 'scoring', '__fixtures__');

// "Any Given Sunday (DYNASTY)" — the user's real 2025 season, status
// complete, 12 rosters. Probed 2026-07-06.
const DEFAULT_LEAGUE_ID = '1181064052869079040';

// Bounded: golden fixtures only ever need the season-opening and
// season-closing regular-season weeks (week 1 and week 17); anything else is
// a caller error, not a retry.
const GOLDEN_WEEKS = [1, 17] as const;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  const outPath = join(FIXTURES_DIR, name);
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outPath}`);
}

function parseArgs(argv: readonly string[]): { leagueId: string } {
  const [leagueId] = argv;
  return { leagueId: leagueId ?? DEFAULT_LEAGUE_ID };
}

async function captureLeague(leagueId: string): Promise<void> {
  const league = await fetchJson(`${SLEEPER_API_BASE}/league/${leagueId}`);
  await writeFixture('league-2025.json', league);
}

async function captureMatchupWeek(leagueId: string, week: number): Promise<void> {
  const matchups = await fetchJson(`${SLEEPER_API_BASE}/league/${leagueId}/matchups/${week}`);
  const entryCount = Array.isArray(matchups) ? matchups.length : 0;
  await writeFixture(`matchups-2025-wk${week}.json`, matchups);
  console.log(`  week ${week}: ${entryCount} matchup entries`);
}

async function main(): Promise<void> {
  const { leagueId } = parseArgs(process.argv.slice(2));
  await mkdir(FIXTURES_DIR, { recursive: true });

  await captureLeague(leagueId);
  for (const week of GOLDEN_WEEKS) {
    await captureMatchupWeek(leagueId, week);
  }

  console.log('Golden fixture capture complete.');
}

main().catch((error) => {
  console.error('Golden fixture capture failed:', error);
  process.exit(1);
});
