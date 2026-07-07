import 'server-only';
import { gunzipSync } from 'zlib';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { nflGames } from '@/server/schema';
import { invariant } from '@/lib/invariant';
import { parseNflSchedule } from '@/engine/stats/parseNflSchedule';
import { selectReleaseAsset, type ReleaseAsset } from '@/engine/stats/selectReleaseAsset';

// --- window (mirrors reconcileStats/pollStats) ---
const MIN_SEASON = 2020;
const MAX_SEASON = 2050;

// --- bounded writes ---
// One season is at most a few hundred games * 2 team-rows (272 games * 2 =
// 544 rows observed live for 2026). 2000 is generous headroom and still a
// hard cap.
const BATCH_SIZE = 500;
const MAX_UPSERT_BATCHES = 4;

// --- size guards (measured live 2026-07-06) ---
// games.csv.gz: ~499 KB compressed / ~2.1 MB decompressed / 7,550 rows
// (spans every season since 1999). Caps sit with generous headroom above
// today's measurements.
const MAX_GZ_BYTES = 5 * 1024 * 1024; // 5 MB (today: ~0.5 MB)
const MAX_CSV_BYTES = 30 * 1024 * 1024; // 30 MB (today: ~2.1 MB)

const RELEASE_META_URL =
  'https://api.github.com/repos/nflverse/nflverse-data/releases/tags/schedules';

export type SyncScheduleResult =
  | { ok: true; upserted: number; skipped: number; assetUsed: string }
  | { ok: false; error: string };

async function labeled<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`${label}: ${message}`);
  }
}

// Parse-don't-cast the release payload into the narrow asset list
// selectReleaseAsset needs (same idiom as reconcileStats.parseReleaseAssets).
function parseReleaseAssets(payload: unknown): ReleaseAsset[] {
  if (typeof payload !== 'object' || payload === null || !('assets' in payload)) {
    return [];
  }
  const rawAssets = (payload as { assets: unknown }).assets;
  if (!Array.isArray(rawAssets)) return [];
  const assets: ReleaseAsset[] = [];
  for (const raw of rawAssets) {
    if (typeof raw !== 'object' || raw === null) continue;
    const name = (raw as Record<string, unknown>).name;
    const url = (raw as Record<string, unknown>).browser_download_url;
    if (typeof name === 'string' && typeof url === 'string') {
      assets.push({ name, downloadUrl: url });
    }
  }
  return assets;
}

// Probe the schedules release, pick the asset (prefer the .gz, fall back to
// plain .csv), download, gunzip when needed — all with labeled fetches +
// size guards. Returns the raw CSV text plus which asset was used.
async function fetchScheduleCsv(): Promise<
  { ok: true; csv: string; assetUsed: string } | { ok: false; error: string }
> {
  try {
    const metaRes = await labeled('release metadata', fetch(RELEASE_META_URL));
    invariant(metaRes.ok, `release metadata fetch failed: ${metaRes.status}`);
    const payload: unknown = await metaRes.json();
    const assets = parseReleaseAssets(payload);

    const selected = selectReleaseAsset(assets, { preferred: 'games.csv.gz', fallback: 'games.csv' });
    if (!selected.ok) return { ok: false, error: selected.error };
    const { asset } = selected;

    const dlRes = await labeled('asset download', fetch(asset.downloadUrl));
    invariant(dlRes.ok, `asset download failed: ${dlRes.status}`);
    const body = Buffer.from(await dlRes.arrayBuffer());

    if (asset.name.endsWith('.gz')) {
      invariant(body.byteLength <= MAX_GZ_BYTES, `compressed asset exceeds MAX_GZ_BYTES (${body.byteLength})`);
      const decompressed = gunzipSync(body);
      invariant(
        decompressed.byteLength <= MAX_CSV_BYTES,
        `decompressed CSV exceeds MAX_CSV_BYTES (${decompressed.byteLength})`,
      );
      return { ok: true, csv: decompressed.toString('utf8'), assetUsed: asset.name };
    }

    invariant(body.byteLength <= MAX_CSV_BYTES, `plain CSV asset exceeds MAX_CSV_BYTES (${body.byteLength})`);
    return { ok: true, csv: body.toString('utf8'), assetUsed: asset.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

async function upsertGames(
  games: readonly { season: number; week: number; nflTeam: string; kickoffIso: string }[],
): Promise<number> {
  if (games.length === 0) return 0;
  const batchCount = Math.ceil(games.length / BATCH_SIZE);
  invariant(batchCount <= MAX_UPSERT_BATCHES, `schedule upsert exceeds MAX_UPSERT_BATCHES (${batchCount})`);

  const db = getDb();
  let upserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = games.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    const values = batch.map((g) => ({
      season: g.season,
      week: g.week,
      nflTeam: g.nflTeam,
      kickoff: new Date(g.kickoffIso),
    }));
    await db
      .insert(nflGames)
      .values(values)
      .onConflictDoUpdate({
        target: [nflGames.season, nflGames.week, nflGames.nflTeam],
        set: {
          kickoff: sql`excluded.kickoff`,
          updatedAt: sql`now()`,
        },
      });
    upserted += batch.length;
  }
  invariant(upserted === games.length, 'upserted count did not match games processed');
  return upserted;
}

export async function syncNflSchedule(season: number): Promise<SyncScheduleResult> {
  invariant(
    Number.isInteger(season) && season >= MIN_SEASON && season <= MAX_SEASON,
    'requested season is outside the sane window',
  );

  const csvResult = await fetchScheduleCsv();
  if (!csvResult.ok) return { ok: false, error: csvResult.error };

  const parsed = parseNflSchedule(csvResult.csv, season);

  const upserted = await upsertGames(parsed.games);
  invariant(upserted === parsed.games.length, 'upserted count did not match parsed game count');

  return { ok: true, upserted, skipped: parsed.skipped, assetUsed: csvResult.assetUsed };
}
