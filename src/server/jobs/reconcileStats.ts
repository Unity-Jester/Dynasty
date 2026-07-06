import 'server-only';
import { gunzipSync } from 'zlib';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { players, statLines } from '@/server/schema';
import { parseCSVLine } from '@/lib/utils';
import { invariant } from '@/lib/invariant';
import { MAPPED_SLEEPER_KEYS, mapNflverseRow, parseCrosswalk } from '@/engine/stats/nflverseMap';
import { diffStatLines } from '@/engine/stats/diffStats';
import { selectReleaseAsset, type ReleaseAsset } from '@/engine/stats/selectReleaseAsset';

// --- windows (copied from pollStats) ---
const MIN_SEASON = 2020;
const MAX_SEASON = 2050;
const MIN_WEEK = 1;
const MAX_WEEK = 18;

// --- bounded reads / writes ---
// stat_lines for one (season, week): the whole NFL slate is < 2k player-weeks
// (Sleeper's own poll caps at 10k lines across ALL positions incl. DEF). 6000
// is generous headroom and still a hard LIMIT (Rule 3).
const MAX_EXISTING_LINES = 6000;
const MAX_KNOWN_PLAYERS = 30000; // matches pollStats' player-universe cap
const BATCH_SIZE = 500;
// One (season, week) yields at most a few thousand changed rows; 20 batches =
// 10k row ceiling matches pollStats.
const MAX_UPDATE_BATCHES = 20;
const MAX_INSERT_BATCHES = 20;

// --- size guards (measured live 2026-07-06; see findings) ---
// Consolidated player_stats.csv.gz: 7.2 MB compressed / 31.9 MB decompressed /
// 134,470 data rows spanning ALL seasons. Per-season player_stats_2023.csv.gz:
// 346 KB / 1.62 MB / 5,653 rows. Caps sit comfortably above the consolidated
// file with ~25% headroom for future seasons.
const MAX_GZ_BYTES = 40 * 1024 * 1024; // 40 MB (consolidated is 7.2 MB today)
const MAX_CSV_BYTES = 200 * 1024 * 1024; // 200 MB (consolidated is 31.9 MB today)
const MAX_CSV_ROWS = 400_000; // consolidated is 134,470 rows today

const RELEASE_META_URL =
  'https://api.github.com/repos/nflverse/nflverse-data/releases/tags/player_stats';
const CROSSWALK_URL = 'https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv';

// diffStatLines is restricted to MAPPED_SLEEPER_KEYS (imported from the
// engine — the single source of truth for nflverse's override authority) so
// keys nflverse doesn't cover (snaps, pts_std, DEF stats, and notably
// fum_lost, whose nflverse columns miss special-teams fumbles) are never
// touched.

export type ReconcileResult =
  | {
      ok: true;
      examined: number;
      corrected: number;
      inserted: number;
      unmatchedCrosswalk: number;
      skippedUnknown: number;
      assetUsed: string;
    }
  | { ok: false; error: string };

// Same call-site labeling idiom as pollStats: the shared fetch reports only
// status text, so which resource failed lives at the call site.
async function labeled<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`${label}: ${message}`);
  }
}

function assertSeasonWeekWindow(season: number, week: number, label: string): void {
  invariant(
    Number.isInteger(season) && season >= MIN_SEASON && season <= MAX_SEASON,
    `${label} season is outside the sane window`,
  );
  invariant(
    Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK,
    `${label} week is outside the sane window`,
  );
}

// Parse the GitHub release payload into the narrow asset list selectReleaseAsset
// needs. Parse-don't-cast at the trust boundary: anything not shaped like an
// asset with a name + browser_download_url is dropped, not coerced.
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

// Probe the release, pick the asset, download it, gunzip if needed — all with
// the labeled fetches + size guards. Returns the decompressed CSV text plus
// which asset was used (surfaced in the result for honest reporting).
async function fetchNflverseCsv(
  season: number,
): Promise<{ ok: true; csv: string; assetUsed: string } | { ok: false; error: string }> {
  try {
    const metaRes = await labeled('release metadata', fetch(RELEASE_META_URL));
    invariant(metaRes.ok, `release metadata fetch failed: ${metaRes.status}`);
    const payload: unknown = await metaRes.json();
    const assets = parseReleaseAssets(payload);

    const selected = selectReleaseAsset(assets, season);
    if (!selected.ok) return { ok: false, error: selected.error };
    const { asset } = selected;

    const dlRes = await labeled('asset download', fetch(asset.downloadUrl));
    invariant(dlRes.ok, `asset download failed: ${dlRes.status}`);
    const compressed = Buffer.from(await dlRes.arrayBuffer());
    invariant(
      compressed.byteLength <= MAX_GZ_BYTES,
      `compressed asset exceeds MAX_GZ_BYTES (${compressed.byteLength})`,
    );

    // Every current asset is a .csv.gz; guard the name so a future plain-.csv
    // asset isn't fed to gunzip.
    invariant(asset.name.endsWith('.gz'), `unexpected non-gz asset ${asset.name}`);
    const decompressed = gunzipSync(compressed);
    invariant(
      decompressed.byteLength <= MAX_CSV_BYTES,
      `decompressed CSV exceeds MAX_CSV_BYTES (${decompressed.byteLength})`,
    );

    return { ok: true, csv: decompressed.toString('utf8'), assetUsed: asset.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

interface ParsedRows {
  ok: true;
  rows: Record<string, string>[];
}

interface HeaderIndices {
  header: string[];
  seasonIdx: number;
  weekIdx: number;
  seasonTypeIdx: number;
}

// Zip a data row's fields against the header into a name->value record.
function rowToRecord(header: readonly string[], fields: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let c = 0; c < header.length; c += 1) {
    const key = header[c];
    if (key !== undefined) record[key] = fields[c] ?? '';
  }
  return record;
}

// True when a data row's fields match the requested season+week and (when the
// column exists — it does today) season_type REG.
function rowMatches(fields: readonly string[], idx: HeaderIndices, seasonStr: string, weekStr: string): boolean {
  if (fields[idx.seasonIdx] !== seasonStr || fields[idx.weekIdx] !== weekStr) return false;
  // season_type REG only when present; absence means we can't distinguish
  // REG/POST, so we don't invent a filter.
  if (idx.seasonTypeIdx !== -1 && fields[idx.seasonTypeIdx] !== 'REG') return false;
  return true;
}

// Parse the CSV header, then row-filter to the requested season + week (and
// season_type REG). Bounded by MAX_CSV_ROWS. Returns only the matching rows as
// header->field records ready for mapNflverseRow.
function parseAndFilterRows(csv: string, season: number, week: number): ParsedRows | { ok: false; error: string } {
  const lines = csv.split('\n');
  if (lines.length <= 1) return { ok: false, error: 'nflverse CSV has no data rows' };
  if (lines.length - 1 > MAX_CSV_ROWS) {
    return { ok: false, error: `nflverse CSV exceeds MAX_CSV_ROWS (${lines.length - 1})` };
  }

  const header = parseCSVLine(lines[0] ?? '');
  const idx: HeaderIndices = {
    header,
    seasonIdx: header.indexOf('season'),
    weekIdx: header.indexOf('week'),
    seasonTypeIdx: header.indexOf('season_type'),
  };
  if (idx.seasonIdx === -1 || idx.weekIdx === -1) {
    return { ok: false, error: 'nflverse CSV missing season/week columns' };
  }

  const seasonStr = String(season);
  const weekStr = String(week);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    const fields = parseCSVLine(line);
    if (!rowMatches(fields, idx, seasonStr, weekStr)) continue;
    rows.push(rowToRecord(header, fields));
  }
  return { ok: true, rows };
}

async function fetchCrosswalk(): Promise<{ ok: true; byGsis: Map<string, string> } | { ok: false; error: string }> {
  try {
    const res = await labeled('crosswalk', fetch(CROSSWALK_URL));
    invariant(res.ok, `crosswalk fetch failed: ${res.status}`);
    const text = await res.text();
    const parsed = parseCrosswalk(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, byGsis: parsed.value.byGsis };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

async function fetchKnownPlayerIds(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ sleeperId: players.sleeperId })
    .from(players)
    .limit(MAX_KNOWN_PLAYERS);
  invariant(rows.length <= MAX_KNOWN_PLAYERS, 'player universe exceeds the bounded read');
  return new Set(rows.map((r) => r.sleeperId));
}

async function fetchExistingLines(season: number, week: number): Promise<Map<string, Record<string, number>>> {
  const rows = await getDb()
    .select({ playerId: statLines.playerId, stats: statLines.stats })
    .from(statLines)
    .where(and(eq(statLines.season, season), eq(statLines.week, week)))
    .limit(MAX_EXISTING_LINES);
  invariant(rows.length <= MAX_EXISTING_LINES, 'existing stat lines exceed the bounded read');
  const byPlayer = new Map<string, Record<string, number>>();
  for (const row of rows) {
    // stats is jsonb; the shape is our own write, but narrow defensively.
    byPlayer.set(row.playerId, (row.stats ?? {}) as Record<string, number>);
  }
  return byPlayer;
}

interface Correction {
  playerId: string;
  merged: Record<string, number>;
}

// The mapped rows joined to Sleeper ids via the crosswalk, split into updates
// (existing row that diffs) and inserts (no existing row, known player).
interface Reconciliation {
  examined: number;
  updates: Correction[];
  inserts: Correction[];
  unmatchedCrosswalk: number;
  skippedUnknown: number;
}

function reconcileRows(
  rows: readonly Record<string, string>[],
  byGsis: Map<string, string>,
  existing: Map<string, Record<string, number>>,
  knownPlayerIds: Set<string>,
): Reconciliation {
  let examined = 0;
  let unmatchedCrosswalk = 0;
  let skippedUnknown = 0;
  const updates: Correction[] = [];
  const inserts: Correction[] = [];

  for (const row of rows) {
    examined += 1;
    const gsis = row.player_id;
    const sleeperId = gsis ? byGsis.get(gsis) : undefined;
    if (sleeperId === undefined) {
      unmatchedCrosswalk += 1;
      continue;
    }
    const corrected = mapNflverseRow(row);
    const existingStats = existing.get(sleeperId);
    if (existingStats !== undefined) {
      const { changed, merged } = diffStatLines(existingStats, corrected, MAPPED_SLEEPER_KEYS);
      if (changed) updates.push({ playerId: sleeperId, merged });
      continue;
    }
    // No existing row: only insert players in our universe (unknown ids, e.g.
    // practice-squad or non-fantasy players, are skipped and counted).
    if (!knownPlayerIds.has(sleeperId)) {
      skippedUnknown += 1;
      continue;
    }
    inserts.push({ playerId: sleeperId, merged: corrected });
  }

  return { examined, updates, inserts, unmatchedCrosswalk, skippedUnknown };
}

async function applyUpdates(updates: readonly Correction[], season: number, week: number): Promise<number> {
  if (updates.length === 0) return 0;
  const batchCount = Math.ceil(updates.length / BATCH_SIZE);
  invariant(batchCount <= MAX_UPDATE_BATCHES, `updates exceed MAX_UPDATE_BATCHES (${batchCount})`);
  const db = getDb();
  let applied = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = updates.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    for (const corr of batch) {
      await db
        .update(statLines)
        .set({ stats: corr.merged, source: 'nflverse', updatedAt: sql`now()` })
        .where(
          and(
            eq(statLines.playerId, corr.playerId),
            eq(statLines.season, season),
            eq(statLines.week, week),
          ),
        );
      applied += 1;
    }
  }
  invariant(applied === updates.length, 'applied update count did not match');
  return applied;
}

async function applyInserts(inserts: readonly Correction[], season: number, week: number): Promise<number> {
  if (inserts.length === 0) return 0;
  const batchCount = Math.ceil(inserts.length / BATCH_SIZE);
  invariant(batchCount <= MAX_INSERT_BATCHES, `inserts exceed MAX_INSERT_BATCHES (${batchCount})`);
  const db = getDb();
  let inserted = 0;
  for (let i = 0; i < batchCount; i += 1) {
    const batch = inserts.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    if (batch.length === 0) continue;
    const values = batch.map((corr) => ({
      playerId: corr.playerId,
      season,
      week,
      stats: corr.merged,
      source: 'nflverse' as const,
    }));
    // A concurrent Sleeper poll could have inserted the row between our read
    // and this write; DO NOTHING keeps the poll's row (reconcile only inserts
    // rows that don't exist — it never clobbers via insert).
    await db
      .insert(statLines)
      .values(values)
      .onConflictDoNothing({
        target: [statLines.playerId, statLines.season, statLines.week],
      });
    inserted += batch.length;
  }
  invariant(inserted === inserts.length, 'inserted count did not match');
  return inserted;
}

export async function reconcileStats(season: number, week: number): Promise<ReconcileResult> {
  assertSeasonWeekWindow(season, week, 'requested');

  const csvResult = await fetchNflverseCsv(season);
  if (!csvResult.ok) return { ok: false, error: csvResult.error };

  const parsed = parseAndFilterRows(csvResult.csv, season, week);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const crosswalk = await fetchCrosswalk();
  if (!crosswalk.ok) return { ok: false, error: crosswalk.error };

  let knownPlayerIds: Set<string>;
  let existing: Map<string, Record<string, number>>;
  try {
    knownPlayerIds = await labeled('player universe', fetchKnownPlayerIds());
    existing = await labeled('existing stat lines', fetchExistingLines(season, week));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }

  const recon = reconcileRows(parsed.rows, crosswalk.byGsis, existing, knownPlayerIds);

  // Post-invariant: every write targets a player in our universe. Updates hit
  // rows that already exist (so their playerId is a valid FK); inserts are
  // guarded above, but assert it here too (Rule 5, cheap).
  invariant(
    recon.inserts.every((c) => knownPlayerIds.has(c.playerId)),
    'insert targets a player outside our universe',
  );

  const corrected = await applyUpdates(recon.updates, season, week);
  const inserted = await applyInserts(recon.inserts, season, week);

  // Post-invariant: we never claim more writes than rows examined.
  invariant(corrected + inserted <= recon.examined, 'corrected+inserted exceeds examined');

  return {
    ok: true,
    examined: recon.examined,
    corrected,
    inserted,
    unmatchedCrosswalk: recon.unmatchedCrosswalk,
    skippedUnknown: recon.skippedUnknown,
    assetUsed: csvResult.assetUsed,
  };
}
