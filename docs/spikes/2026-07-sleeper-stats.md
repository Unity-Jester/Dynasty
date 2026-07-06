# Spike: Sleeper weekly stats endpoint — GO/NO-GO evidence

**Phase:** 4, Task 1 (stats ingestion foundation) — this doc gates the phase.
**Endpoint under test:** `GET https://api.sleeper.app/v1/stats/nfl/regular/<season>/<week>`
**Fixtures:** `src/engine/stats/__fixtures__/sleeper-2025-wk1.json` (2,312 entries),
`src/engine/stats/__fixtures__/sleeper-2025-wk17.json` (2,476 entries), captured via
`scripts/capture-stats-fixtures.ts` on 2026-07-06.

```
npx tsx scripts/capture-stats-fixtures.ts 2025 1 17
```

## 1. Shape & keying

The response is a flat JSON object (map), not an array. Top-level keys are Sleeper
player ids as strings; values are stat objects with a sparse key set (see §3).

| | wk1 | wk17 |
|---|---|---|
| Total entries | 2,312 | 2,476 |
| Numeric player-id entries | 2,248 | 2,412 |
| `TEAM_<ABBR>` entries | 32 | 32 |
| Plain `<ABBR>` entries | 32 | 32 |

Both weeks carry exactly 32 team-prefixed and 32 plain-abbreviation entries — one
per NFL team, no more, no fewer.

**Team-DEF entries — two distinct key formats, easy to conflate:**

- **Plain abbreviation key** (e.g. `"BAL"`) — this is the **fantasy DEF/ST unit's own
  scoring line**: `pts_allow`, `sack`, `int`, `fum_rec`, `tkl`, `def_st_tkl_solo`,
  `def_pass_def`, `pts_std`/`pts_half_ppr`/`pts_ppr`. Example, `BAL` wk17: `sack: 2,
  int: 1, fum_rec: 1, pts_allow: 24, pts_allow_21_27: 1, pts_std: 6`.
- **`TEAM_`-prefixed key** (e.g. `"TEAM_BUF"`) — this is the **team's aggregate
  offensive production** (the sum of that team's offense that week): `pass_yd,
  rush_yd, rec, rec_yd, pass_td, off_snp`, etc. Example, `TEAM_BUF` wk17: `pass_yd:
  262, rush_yd: 120, rec: 23, pts_std: 59.68` — clearly an offense-side rollup, not
  a defense score.

This matters directly for Phase 5: our `players` table keys DEF entities by the
**plain team abbreviation** (verified by DB query — see §2), so the join key for
fantasy defense scoring is the plain-abbreviation entry, **not** `TEAM_<ABBR>`.
Using the wrong one would silently score every DEF/ST team as if it were an
offense (BUF's real DEF score that week was far lower than the `pts_std: 59.68`
seen on `TEAM_BUF`).

## 2. Player-id join

Query run against the live `players` table (`.env.local` DATABASE_URL, read-only):

```sql
SELECT sleeper_id FROM players;              -- 4,254 rows
SELECT * FROM players WHERE position='DEF';  -- 32 rows, sleeper_id = plain team abbr (e.g. 'BAL', 'ARI')
```

Join test: for each fixture key (excluding the 32 `TEAM_`-prefixed rollup keys,
which are not player/DEF ids at all), check membership in `players.sleeper_id`.

| | wk1 | wk17 |
|---|---|---|
| Fixture keys (non-`TEAM_`) | 2,280 | 2,444 |
| Present in `players` | 749 (32.9%) | 783 (32.0%) |
| Missing | 1,531 | 1,661 |

**Where the misses concentrate:** 100% of misses are non-rosterable positions.
Cross-referencing all 1,661 wk17 miss-ids against Sleeper's `/v1/players/nfl`
(the full ~14 MB player universe) shows every single one resolves to a real,
known Sleeper player at a position outside our `ROSTERABLE_POSITIONS` filter
(`QB, RB, WR, TE, K, DEF` — see `src/engine/playerSync.ts`):

```
DE: 134   LB: 277   DT: 131   OL: 256   DB: 307   CB: 167
OT: 37    G: 43     C: 20     T: 63     LS: 34    P: 33
OG: 11    FB: 11    SS: 2     NT: 2     DL: 133
```

Zero rosterable-position players were missing from the `players` table. Sample
of 5 missing ids, looked up live:

| id | name | position | note |
|---|---|---|---|
| 125 | Calais Campbell | DE | IDP, filtered by design |
| 439 | JJ Jansen | LS | long snapper, filtered |
| 445 | Thomas Morstead | P | punter, filtered |
| 525 | Morgan Cox | LS | long snapper, filtered |
| 548 | Jon Weeks | LS | long snapper, filtered |

**Conclusion:** the ~32% join rate is expected and benign — it's an artifact of
`playerSync.ts` intentionally not persisting IDP/OL/specialist rows, not a data
quality problem with the stats endpoint. Every fantasy-relevant player and every
DEF unit joins cleanly.

## 3. Vocabulary coverage — all 60 `SCORING_STAT_KEYS`

Checked each key in `src/engine/settings.ts` against both fixture weeks. Sleeper's
stat objects are **sparse**: a key is present only when its value would be
nonzero for that entry (verified: `pass_int` appears on 31/2,476 wk17 entries,
`fgm_20_29` on 10, `safe` on 0 — no entry anywhere carries an explicit `0`
for keys it doesn't report). This means "absent from both weeks" is the correct
signal for "never emitted," not a decoding gap.

| Key | wk17 | wk1 | Example |
|---|---|---|---|
| pass_yd | present | present | Stafford: 269 |
| pass_td | present | present | Stafford: 2 |
| pass_int | present | present | Stafford: 3 |
| pass_2pt | absent | **present** | wk1 only |
| pass_att | present | present | Stafford: 38 |
| pass_cmp | present | present | Stafford: 22 |
| pass_cmp_40p | present | present | — |
| pass_inc | present | present | Stafford: 16 |
| pass_td_40p | present | present | — |
| rush_yd | present | present | Henry: 216 |
| rush_td | present | present | Henry: 4 |
| rush_2pt | **absent** | **absent** | never observed |
| rush_att | present | present | Henry: 36 |
| rush_td_40p | present | present | — |
| rec | present | present | Kelce: 5 |
| rec_yd | present | present | Kelce: 36 |
| rec_td | present | present | — |
| rec_2pt | absent | **present** | wk1 only |
| rec_td_40p | present | present | — |
| fum_lost | present | present | — |
| fum_rec | present | present | BAL: 1 |
| sack | present | present | BAL: 2 |
| int | present | present | BAL: 1 |
| fgm | present | present | — |
| fgm_0_19 | **absent** | **absent** | never observed |
| fgm_20_29 | present | present | 10 entries wk17 |
| fgm_30_39 | present | present | — |
| fgm_40_49 | present | present | — |
| fgm_50p | present | present | — |
| fgmiss | present | present | 12 entries wk17 |
| fga | present | present | — |
| xpm | present | present | — |
| xpmiss | present | present | — |
| xpa | present | present | — |
| def_td | present | present | — |
| def_st_td | present | absent | wk17 only |
| def_st_fum_rec | absent | present | wk1 only |
| def_2pt | **absent** | **absent** | never observed |
| pts_allow | present | present | BAL: 24 |
| pts_allow_0 | **absent** | **absent** | never observed (no shutouts either week) |
| pts_allow_1_6 | present | present | — |
| pts_allow_7_13 | present | present | — |
| pts_allow_14_20 | present | present | — |
| pts_allow_21_27 | present | present | BAL: 1 |
| pts_allow_28_34 | present | present | — |
| pts_allow_35p | present | present | 4 entries wk17 |
| yds_allow | present | present | BAL: 363 |
| ff | present | present | — |
| tkl | present | present | BAL: 46 |
| safe | **absent** | **absent** | never observed |
| st_td | present | absent | wk17 only |
| st_fum_rec | absent | present | wk1 only |
| blk_kick | present | present | — |
| bonus_rec_te | present | present | Kelce: 5 |
| bonus_pass_yd_300 | present | present | — |
| bonus_pass_yd_400 | **absent** | **absent** | never observed |
| bonus_rush_yd_100 | present | present | — |
| bonus_rush_yd_200 | present | absent | wk17 only (Henry) |
| bonus_rec_yd_100 | present | present | Cooks: 1 |
| bonus_rec_yd_200 | **absent** | **absent** | never observed |

**Flagged — 7 of our 60 keys never appeared in either fixture week:**
`rush_2pt`, `fgm_0_19`, `def_2pt`, `pts_allow_0`, `safe`, `bonus_pass_yd_400`,
`bonus_rec_yd_200`.

All 7 correspond to genuinely rare in-game events (a 2-point rush conversion, a
sub-20-yard missed field goal being scored as a "make" bucket at all — `fgm_0_19`
looks structurally odd, more below —, a defensive 2-point return, a shutout, a
safety, a 400-yard passing game, a 200-yard receiving game). Two weeks is a thin
sample for rare events; this is **not proof Sleeper never emits these keys**, but
it is proof they did not fire across 4,788 combined entries. `fgm_0_19` is worth
extra scrutiny before Phase 5: Sleeper's `fgm_20_29`/`_30_39`/`_40_49`/`_50p`
buckets were all populated, so a missing `fgm_0_19` may mean Sleeper does not
emit a distinct bucket for the shortest field goals (they may fold into `fgm`
only) — Phase 5 should either confirm this with a longer capture window or treat
`fgm_0_19` as always-zero and rely on `fgm` for the base make-count.

## 4. Spot-checks — internal consistency (strongest available check in July)

Public box scores for a specific 2025 week are not something I can verify from
model knowledge with confidence, so the strongest available check is **recomputing
Sleeper's own `pts_std`/`pts_half_ppr`/`pts_ppr` from the raw stat line** using
standard fantasy scoring (`1 pt / 10 rush or rec yards, 6 pt rush/rec TD, 0 PPR
for std, 0.5 for half, 1.0 for full`). Four wk17 players with simple, single-category
lines make the arithmetic unambiguous:

**Nick Chubb** (rush_att: 1, rush_yd: 1, no other scoring stats):
```
pts_std = rush_yd / 10 = 1 / 10 = 0.1
Fixture reports pts_std: 0.1  ->  MATCH
```

**Derrick Henry** (rush_att: 36, rush_yd: 216, rush_td: 4):
```
pts_std = rush_yd/10 + rush_td*6 = 216/10 + 4*6 = 21.6 + 24 = 45.6
Fixture reports pts_std: 45.6  ->  MATCH
```

**Adam Thielen** (rec: 2, rec_yd: 14, no rush/pass stats) — also cross-checks the
PPR/half-PPR reception bonus:
```
pts_std      = rec_yd/10                = 14/10            = 1.4
pts_half_ppr = pts_std + rec*0.5         = 1.4 + 2*0.5      = 2.4
pts_ppr      = pts_std + rec*1.0         = 1.4 + 2*1.0      = 3.4
Fixture reports pts_std: 1.4, pts_half_ppr: 2.4, pts_ppr: 3.4  ->  ALL MATCH
```

**Travis Kelce** (rec: 5, rec_yd: 36):
```
pts_std      = 36/10             = 3.6
pts_half_ppr = 3.6 + 5*0.5        = 6.1
pts_ppr      = 3.6 + 5*1.0        = 8.6
Fixture reports pts_std: 3.6, pts_half_ppr: 6.1, pts_ppr: 8.6  ->  ALL MATCH
```

Four-for-four exact matches on rush- and reception-yardage/TD arithmetic across
`pts_std`, `pts_half_ppr`, and `pts_ppr` is strong internal-consistency evidence
that the raw counting stats (`rush_yd`, `rush_td`, `rec`, `rec_yd`) are coherent
with each other and with Sleeper's own scoring engine — i.e., not corrupted or
shuffled between fields.

One caveat surfaced while attempting this on **QB** lines (Stafford, Rivers):
their reported `pts_std` did **not** match `pass_yd/25 + pass_td*4 - pass_int*2`
(off by a flat +3.0 and +0.9 respectively). Both QBs carry a `bonus_fd_qb`
(first-down bonus) field that is not one of our 60 `SCORING_STAT_KEYS` — Sleeper's
own default league likely scores first-down bonuses, and its computed `pts_std`
column reflects *its* default ruleset, not raw-stat-only standard scoring. This is
expected and fine: **Phase 5 must compute scores from the 60 raw stat keys and
league-configured `scoring.rules`, never by trusting Sleeper's `pts_*` columns
directly** — those columns are useful only as an approximate golden-file sanity
check on skill-position rush/rec lines, not as ground truth for our own engine.

## 5. Sleeper's computed points

`pts_std`, `pts_half_ppr`, and `pts_ppr` are all present in both fixture weeks,
on the same sparse basis as raw stats (present only for entries with any scoring
activity: 399–400 of 2,476 wk17 entries carry all three). Useful as a rough
golden-file cross-check for Phase 5's own scoring engine on skill-position
rush/reception lines (see caveat in §4 re: QB bonus categories and DEF/ST, which
diverge from a pure-raw-stat computation).

## 6. Preseason probe

`GET /v1/stats/nfl/pre/2025/1` returns **HTTP 200**, same map shape, **3,033
entries** — more entries than a regular-season week despite fewer meaningful
snaps, consistent with expanded preseason rosters. Most entries are snap-count-only
(`gms_active`, `tm_off_snp`, `tm_def_snp`, `tm_st_snp`, `pos_rank_*`) with no
scoring stats — e.g. player id `19` has only 7 fields, all snap/rank metadata.
But a meaningful subset does carry full box-score stats: 723 entries have
`pts_std`, 122 have `pass_yd`, 233 have `rush_yd` — e.g. player id `260` has a
complete QB line (`pass_att: 22, pass_yd: 173, pass_td: 1, pass_int: 1, pts_std:
10.82`). Conclusion: the preseason endpoint is live and shaped identically to
the regular-season endpoint well before the season starts, which is exactly what
the ~Aug 7 latency probe needs to confirm — no further August action required
beyond re-running the capture script against a live preseason week for freshness
timing.

## 7. Rate / latency caveats

**Cannot be validated in July:** live-game update latency (how quickly a stat
line updates after a play, or after a game ends) is impossible to observe from a
static July capture of already-final 2025 weeks. The only way to measure this is
to poll the endpoint for an in-progress or just-completed game and diff
successive captures — that has to happen during the 2026 season itself.

**Mitigation already in place:** `scripts/capture-stats-fixtures.ts` is a
generic, reusable capture tool (not a one-off) — it doubles as a **drift
canary**: re-running it periodically during the 2026 season and diffing against
these committed fixtures will surface any Sleeper schema change (new/renamed
stat keys, changed key format for DEF entries, changed sparse-vs-dense
encoding) before Phase 5's scoring engine silently mis-scores a live week.

No rate-limit headers or errors were encountered capturing 2 full weeks + 1
preseason week + 1 full player-universe dump in this session; Sleeper's stats
endpoints appear to be unauthenticated and did not throttle this usage pattern,
consistent with the "unofficial but widely used" reputation of this API.

## 8. Verdict

**GO.**

The endpoint returns a stable, sparse, well-keyed stats map; every fantasy-relevant
player and every DEF/ST unit joins cleanly against our `players` table (100% of
join misses are IDP/OL/specialist positions we deliberately don't roster); and
raw rush/reception stats reconcile exactly against Sleeper's own computed
`pts_std`/`pts_half_ppr`/`pts_ppr` across all four spot-checked players.

**Conditions for Phase 5:**

1. Join fantasy DEF/ST stats using the **plain team-abbreviation key** (`BAL`),
   never `TEAM_<ABBR>` (`TEAM_BAL`) — the latter is the team's offensive rollup
   and will produce wildly wrong DEF scores if used by mistake.
2. Compute scores from the 60 raw `SCORING_STAT_KEYS` and league
   `scoring.rules`/`bonuses`, not from Sleeper's `pts_*` columns — those reflect
   Sleeper's own default ruleset (e.g. first-down bonuses) which isn't in our
   vocabulary and won't match a league's actual configured scoring.
3. Seven keys (`rush_2pt`, `fgm_0_19`, `def_2pt`, `pts_allow_0`, `safe`,
   `bonus_pass_yd_400`, `bonus_rec_yd_200`) never appeared in either fixture
   week. Phase 5 must not assume these are dead keys — they gate on rare game
   events — but should have an explicit test asserting the scoring function
   handles a genuinely-absent key as `0` rather than `undefined`/`NaN`, since
   real-season data may go many weeks without exercising them.
4. Treat the preseason endpoint (`/stats/nfl/pre/<season>/<week>`) as
   confirmed-live and same-shaped; no separate Phase-5 spike needed for it, just
   re-run the capture script once live in August to confirm before wiring the
   Aug 7 sync job.
