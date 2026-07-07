import { describe, it, expect } from 'vitest';
import { selectReleaseAsset, selectPlayerStatsAsset, type ReleaseAsset } from '../selectReleaseAsset';

// Mirrors the real nflverse `player_stats` release families verified live on
// 2026-07-06: the consolidated file, per-season offense files, and several
// category families that share the `player_stats` prefix but must NOT match.
function asset(name: string): ReleaseAsset {
  return { name, downloadUrl: `https://example.test/${name}` };
}

const CONSOLIDATED = asset('player_stats.csv.gz');
const REALISTIC: ReleaseAsset[] = [
  CONSOLIDATED,
  asset('player_stats_2023.csv.gz'),
  asset('player_stats_2024.csv.gz'),
  asset('player_stats_kicking_2023.csv.gz'),
  asset('player_stats_def_2023.csv.gz'),
  asset('player_stats_season_2023.csv.gz'),
  asset('player_stats_2023.csv'), // non-gz variant, ignored
  asset('player_stats_2023.parquet'),
];

describe('selectPlayerStatsAsset', () => {
  it('prefers the exact per-season offense file when present', () => {
    const result = selectPlayerStatsAsset(REALISTIC, 2023);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.name).toBe('player_stats_2023.csv.gz');
  });

  it('never confuses a category family for the per-season offense file', () => {
    // 2025 has no per-season offense file, but kicking/def/season 2025 exist:
    // must fall back to the consolidated file, not grab a category file.
    const assets: ReleaseAsset[] = [
      CONSOLIDATED,
      asset('player_stats_kicking_2025.csv.gz'),
      asset('player_stats_def_2025.csv.gz'),
      asset('player_stats_season_2025.csv.gz'),
    ];
    const result = selectPlayerStatsAsset(assets, 2025);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.name).toBe('player_stats.csv.gz');
  });

  it('falls back to the consolidated file when the season is unpublished', () => {
    const result = selectPlayerStatsAsset(REALISTIC, 2025);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.name).toBe('player_stats.csv.gz');
  });

  it('errors when neither the per-season nor the consolidated file exists', () => {
    const assets: ReleaseAsset[] = [asset('player_stats_kicking_2023.csv.gz')];
    const result = selectPlayerStatsAsset(assets, 2023);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no usable asset');
  });

  it('errors on an empty asset list rather than guessing', () => {
    const result = selectPlayerStatsAsset([], 2023);
    expect(result.ok).toBe(false);
  });
});

describe('selectReleaseAsset (generalized form)', () => {
  it('selects the preferred exact name when present, e.g. games.csv.gz over games.csv', () => {
    const assets: ReleaseAsset[] = [asset('games.csv'), asset('games.csv.gz'), asset('games.parquet')];
    const result = selectReleaseAsset(assets, { preferred: 'games.csv.gz', fallback: 'games.csv' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.name).toBe('games.csv.gz');
  });

  it('falls back to the exact fallback name when the preferred name is absent', () => {
    const assets: ReleaseAsset[] = [asset('games.csv'), asset('games.parquet')];
    const result = selectReleaseAsset(assets, { preferred: 'games.csv.gz', fallback: 'games.csv' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.asset.name).toBe('games.csv');
  });
});
