// Captures real-league Sleeper API snapshots used as fixtures for the
// import translator TDD suite (src/engine/import/__tests__). Fixtures are
// real-league data, not synthetic — re-run this script to refresh them if
// the source league's settings/rosters/traded picks change.
//
// Standalone script: deliberately does NOT import src/lib/sleeper.ts (that
// module's fetch call uses Next.js-specific `next: { revalidate }` fetch
// options that don't apply outside the Next runtime). Uses plain fetch.
//
// Usage: npx tsx scripts/capture-import-fixtures.ts <sleeperLeagueId>

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
const FIXTURES_DIR = join(__dirname, '..', 'src', 'engine', 'import', '__fixtures__');

// Bounded: exactly the four endpoints the import translators need.
const ENDPOINTS: ReadonlyArray<{ path: string; file: string }> = [
  { path: '', file: 'league.json' },
  { path: '/users', file: 'users.json' },
  { path: '/rosters', file: 'rosters.json' },
  { path: '/traded_picks', file: 'tradedPicks.json' },
];
const MAX_ENDPOINTS = ENDPOINTS.length; // 4, fixed — asserted below

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const leagueId = process.argv[2];
  if (!leagueId) {
    throw new Error('Usage: npx tsx scripts/capture-import-fixtures.ts <sleeperLeagueId>');
  }
  if (ENDPOINTS.length !== MAX_ENDPOINTS) {
    throw new Error('invariant violated: endpoint list must be exactly 4 entries');
  }

  await mkdir(FIXTURES_DIR, { recursive: true });

  for (const endpoint of ENDPOINTS) {
    const url = `${SLEEPER_API_BASE}/league/${leagueId}${endpoint.path}`;
    const data = await fetchJson(url);
    const outPath = join(FIXTURES_DIR, endpoint.file);
    await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${outPath}`);
  }

  console.log('Fixture capture complete.');
}

main().catch(error => {
  console.error('Fixture capture failed:', error);
  process.exit(1);
});
