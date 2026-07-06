# Stats fixtures

## Sleeper fixtures

`sleeper-2025-wk1.json`, `sleeper-2025-wk17.json` — captured by
`scripts/capture-stats-fixtures.ts` (Task 1 spike). See that script's header
comment for source/usage.

## nflverse + crosswalk fixtures (Phase 4 Task 5)

- `nflverse-2023-wk17-sample.csv` — header row + 30 player-week rows from
  nflverse's community weekly player stats release.
- `crosswalk-sample.csv` — header row + the ~30 `db_playerids` rows whose
  `sleeper_id` appears in the stats sample above.

Captured by `scripts/capture-nflverse-fixtures.ts`. Re-run that script to
refresh if nflverse or dynastyprocess change shape.

### Source URLs

- nflverse weekly player stats (all seasons, one release):
  `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv.gz`
  (the per-season file named in the original task spec,
  `player_stats_2025.csv`, no longer exists — nflverse consolidated all
  seasons into a single gzipped CSV under the `player_stats` release tag).
- Player id crosswalk:
  `https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv`

### Capture date

2026-07-06.

### Why 2023 week 17, not 2025 week 17

The task's target fixture was "2025 week 17." At capture time, nflverse's
published `player_stats.csv` only contains data through the **2024** season
(max `season`/`week` observed: `2024`/`15`) — the 2025 season's stats are not
yet in the community release. Within the available data, the three named
spot-check players (Christian McCaffrey, Derrick Henry, Travis Kelce) all
share a single common week: **season 2023, week 17, season_type REG**. That
slice was used instead, keeping the same "week 17" shape the task asked for
(a data-availability substitution, not a design choice). File and constant
names in `nflverseMap.ts` and its tests reflect the actual capture (2023),
not the originally-specified 2025.

### Real header (verified against the downloaded CSV, 53 columns)

```
player_id,player_name,player_display_name,position,position_group,headshot_url,
recent_team,season,week,season_type,opponent_team,completions,attempts,
passing_yards,passing_tds,interceptions,sacks,sack_yards,sack_fumbles,
sack_fumbles_lost,passing_air_yards,passing_yards_after_catch,
passing_first_downs,passing_epa,passing_2pt_conversions,pacr,dakota,carries,
rushing_yards,rushing_tds,rushing_fumbles,rushing_fumbles_lost,
rushing_first_downs,rushing_epa,rushing_2pt_conversions,receptions,targets,
receiving_yards,receiving_tds,receiving_fumbles,receiving_fumbles_lost,
receiving_air_yards,receiving_yards_after_catch,receiving_first_downs,
receiving_epa,receiving_2pt_conversions,racr,target_share,air_yards_share,
wopr,special_teams_tds,fantasy_points,fantasy_points_ppr
```

Notable deviation from the task's expected shape: the interceptions column
is named **`interceptions`**, not `passing_interceptions`. There is no
`fum_lost` column at all — nflverse splits fumbles-lost by phase
(`sack_fumbles_lost`, `rushing_fumbles_lost`, `receiving_fumbles_lost`),
which `nflverseMap.ts` sums into Sleeper's single `fum_lost` key.

### Crosswalk header (verified, 35 columns)

```
mfl_id,sportradar_id,fantasypros_id,gsis_id,pff_id,sleeper_id,nfl_id,espn_id,
yahoo_id,fleaflicker_id,cbs_id,pfr_id,cfbref_id,rotowire_id,rotoworld_id,
ktc_id,stats_id,stats_global_id,fantasy_data_id,swish_id,name,merge_name,
position,team,birthdate,age,draft_year,draft_round,draft_pick,draft_ovr,
twitter_username,height,weight,college,db_season
```

Relevant columns: `gsis_id`, `sleeper_id`.

### Known crosswalk pairs used in tests

- CMC: `gsis_id=00-0033280` -> `sleeper_id=4034`
- Derrick Henry: `gsis_id=00-0032764` -> `sleeper_id=3198`
- Travis Kelce: `gsis_id=00-0030506` -> `sleeper_id=1466`
