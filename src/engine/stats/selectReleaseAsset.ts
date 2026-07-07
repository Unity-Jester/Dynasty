import { invariant } from '@/lib/invariant';

// A GitHub release asset, narrowed to the two fields we select on. The real
// API returns far more; we parse-don't-cast at the trust boundary (the job
// zod-validates the payload before handing a list of these to us).
export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export type SelectAssetResult =
  | { ok: true; asset: ReleaseAsset }
  | { ok: false; error: string };

// Exact asset names to look for, in preference order: the caller's preferred
// name (e.g. a per-season or .gz variant), then a fallback (e.g. a
// consolidated all-seasons file or a plain non-gz variant). Both are exact
// names, never patterns — a release family sharing a prefix (see
// player_stats_kicking_*, player_stats_def_*, etc.) must never be confused
// for the wanted asset by a loose `includes` match.
export interface AssetNamePreference {
  preferred: string;
  fallback: string;
}

// Select which release asset to use, by documented preference: the exact
// preferred name if present, else the exact fallback name. Pure and total:
// never fetches, never throws for ordinary "asset missing" cases (those are
// reported via ok:false only when NEITHER name is available — a real
// "source changed shape" signal the job surfaces rather than guessing).
export function selectReleaseAsset(
  assets: readonly ReleaseAsset[],
  names: AssetNamePreference,
): SelectAssetResult {
  invariant(Array.isArray(assets), 'assets must be an array');
  invariant(typeof names.preferred === 'string' && names.preferred.length > 0, 'preferred name must be non-empty');
  invariant(typeof names.fallback === 'string' && names.fallback.length > 0, 'fallback name must be non-empty');

  const preferred = assets.find((a) => a.name === names.preferred);
  if (preferred !== undefined) {
    return { ok: true, asset: preferred };
  }

  const fallback = assets.find((a) => a.name === names.fallback);
  if (fallback !== undefined) {
    return { ok: true, asset: fallback };
  }

  return {
    ok: false,
    error: `no usable asset: neither ${names.preferred} nor ${names.fallback} present (${assets.length} assets seen)`,
  };
}

// The consolidated all-seasons offense file (spans every season in one gz).
// This is the guaranteed fallback: it has existed across nflverse's release
// reorganizations (see __fixtures__/README.md).
const CONSOLIDATED_NAME = 'player_stats.csv.gz';

// nflverse's `player_stats` release carries MANY families of assets that all
// share the `player_stats` prefix (verified live 2026-07-06, 1822 assets):
//   player_stats_<year>.csv.gz          <- offense, per season  (what we want)
//   player_stats_kicking_<year>.csv.gz  <- kicking family
//   player_stats_def_<year>.csv.gz      <- defense family
//   player_stats_season_<year>.csv.gz   <- season-aggregate (not per-week)
// Matching the requested season by a loose `includes(season)` would wrongly
// grab a category file. We therefore require the EXACT per-season offense
// name and reject everything else — a category rename by nflverse falls back
// to the consolidated file rather than silently ingesting the wrong family.
function perSeasonName(season: number): string {
  return `player_stats_${season}.csv.gz`;
}

// Convenience wrapper preserving the original player_stats call-site shape:
// prefer the exact per-season offense file, else the consolidated file.
export function selectPlayerStatsAsset(
  assets: readonly ReleaseAsset[],
  season: number,
): SelectAssetResult {
  invariant(Number.isInteger(season) && season > 1900 && season < 2100, 'season outside sane window');
  return selectReleaseAsset(assets, { preferred: perSeasonName(season), fallback: CONSOLIDATED_NAME });
}
