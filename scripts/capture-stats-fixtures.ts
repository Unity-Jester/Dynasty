// Captures real Sleeper weekly-stats snapshots used as fixtures for the
// Phase 5 scoring engine spike (docs/spikes/2026-07-sleeper-stats.md). These
// fixtures are the evidence base for the GO/NO-GO call on Sleeper's
// unofficial stats endpoint — re-run to refresh if Sleeper changes shape.
//
// Standalone script: deliberately does NOT import src/lib/sleeper.ts (that
// module's fetch call uses Next.js-specific `next: { revalidate }` fetch
// options that don't apply outside the Next runtime). Uses plain fetch.
//
// Usage: npx tsx scripts/capture-stats-fixtures.ts <season> <week...>
// Example: npx tsx scripts/capture-stats-fixtures.ts 2025 1 17

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';
const FIXTURES_DIR = join(__dirname, '..', 'src', 'engine', 'stats', '__fixtures__');

// Bounded: a single NFL season has at most 22 scheduled weeks (18 regular +
// up to 4 postseason); anything beyond that is a caller error, not a retry.
const MAX_WEEKS_PER_RUN = 22;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

function parseArgs(argv: readonly string[]): { season: string; weeks: number[] } {
  const [season, ...weekArgs] = argv;
  if (!season || weekArgs.length === 0) {
    throw new Error('Usage: npx tsx scripts/capture-stats-fixtures.ts <season> <week...>');
  }
  if (weekArgs.length > MAX_WEEKS_PER_RUN) {
    throw new Error(`too many weeks requested (${weekArgs.length} > ${MAX_WEEKS_PER_RUN})`);
  }
  const weeks = weekArgs.map((w) => {
    const n = Number.parseInt(w, 10);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKS_PER_RUN) {
      throw new Error(`invalid week argument: ${w}`);
    }
    return n;
  });
  return { season, weeks };
}

async function captureWeek(season: string, week: number): Promise<void> {
  const url = `${SLEEPER_API_BASE}/stats/nfl/regular/${season}/${week}`;
  const data = await fetchJson(url);
  const outPath = join(FIXTURES_DIR, `sleeper-${season}-wk${week}.json`);
  await writeFile(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  const entryCount = typeof data === 'object' && data !== null ? Object.keys(data).length : 0;
  console.log(`Wrote ${outPath} (${entryCount} entries)`);
}

async function main(): Promise<void> {
  const { season, weeks } = parseArgs(process.argv.slice(2));
  await mkdir(FIXTURES_DIR, { recursive: true });

  for (const week of weeks) {
    await captureWeek(season, week);
  }

  console.log('Stats fixture capture complete.');
}

main().catch((error) => {
  console.error('Stats fixture capture failed:', error);
  process.exit(1);
});
