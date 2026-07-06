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

// Select which release asset to download for a given season, by documented
// preference: the exact per-season offense file if it exists, else the
// consolidated all-seasons file. Pure and total: never fetches, never throws
// for ordinary "asset missing" cases (those are reported via ok:false only
// when NEITHER preference is available — a real "nflverse changed shape"
// signal the job surfaces rather than guessing).
export function selectReleaseAsset(
  assets: readonly ReleaseAsset[],
  season: number,
): SelectAssetResult {
  invariant(Number.isInteger(season) && season > 1900 && season < 2100, 'season outside sane window');
  invariant(Array.isArray(assets), 'assets must be an array');

  const wanted = perSeasonName(season);
  const perSeason = assets.find((a) => a.name === wanted);
  if (perSeason !== undefined) {
    return { ok: true, asset: perSeason };
  }

  const consolidated = assets.find((a) => a.name === CONSOLIDATED_NAME);
  if (consolidated !== undefined) {
    return { ok: true, asset: consolidated };
  }

  return {
    ok: false,
    error: `no usable asset: neither ${wanted} nor ${CONSOLIDATED_NAME} present (${assets.length} assets seen)`,
  };
}
