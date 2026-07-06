# Phase 4: Stats Ingestion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** NFL player stat lines flow into the platform on a schedule — polled from Sleeper's stats endpoint during game windows, corrected nightly against nflverse — so Phase 5's scoring engine has trustworthy input for the 2026 season.

**Architecture:** Same pattern as the player sync: pure fixture-TDD'd engines (`parseSleeperStats`, nflverse column mapping + diff) with I/O-only job routes behind `CRON_SECRET`, triggered by GitHub Actions cron (inert until deploy; local curl meanwhile). New `stat_lines` table keyed (player, season, week) with a `source` column — `nflverse` corrections are final and Sleeper polls never overwrite them. **Task 1 is a formal GO/NO-GO spike** on the Sleeper endpoint; a controller probe already confirmed the happy signs (map keyed by Sleeper player ids, 2,476 entries for 2025 wk17, stat keys matching our vocabulary), so the spike formalizes evidence rather than gambles.

**Tech Stack:** Existing stack. nflverse data via its GitHub-release CSVs; player id crosswalk via the dynastyprocess `db_playerids` CSV (has `sleeper_id` and `gsis_id` columns). No new npm dependencies (CSV parsing: the repo already has `parseCSVLine` in `src/lib/utils.ts` — reuse it).

---

## Decisions locked now

1. **Store raw numeric stat maps, filter at scoring time.** `stat_lines.stats` jsonb holds every numeric key Sleeper returns (incl. `pts_std`, snap counts) — the scoring engine (Phase 5) selects what the league's rules reference. Sleeper's own `pts_*` values become free cross-check data for the golden-file test.
2. **Ingest only players we know.** Lines for player ids missing from our `players` table are skipped (FK) and counted; the daily player sync keeps that set fresh.
3. **`nflverse` wins, permanently.** The Sleeper poll's upsert refuses to overwrite a row whose `source = 'nflverse'` (conflict-update `setWhere`). Reconciliation only writes rows where values actually differ beyond float tolerance.
4. **Regular season only** this phase (`season_type 'regular'` constant, documented). Fantasy playoffs run inside NFL regular-season weeks; preseason/postseason ingestion is out of scope.
5. **Latency validation is deferred, deliberately.** It's July — no live games exist. A **preseason latency probe** (~Aug 7: poll during a live preseason game, measure staleness vs broadcast) is a scheduled follow-up noted in the risk register, not a phase blocker.
6. **GO/NO-GO gate after Task 1:** if the spike fails (shape drift, id mismatch, coverage holes), STOP — the controller and user replan Phase 4 as nflverse-nightly-only (next-day scoring, within seed tolerance).

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. Sleeper stats spike (GO/NO-GO) | sonnet | controller reads the findings doc |
| 2. stat_lines table | sonnet | controller self |
| 3. parseSleeperStats engine | sonnet | sonnet |
| 4. poll-stats job + workflow | sonnet | sonnet |
| 5. nflverse mapping + diff engines | sonnet | sonnet |
| 6. reconcile-stats job | **opus** | sonnet |
| Final whole-phase review | **opus** | — |

---

### Task 1: Sleeper stats spike — capture, coverage, GO/NO-GO

**Files:** Create `scripts/capture-stats-fixtures.ts`; `src/engine/stats/__fixtures__/sleeper-2025-wk17.json` (full week) and `sleeper-2025-wk1.json`; `docs/spikes/2026-07-sleeper-stats.md`.

1. Capture script (plain fetch, like `capture-import-fixtures.ts`): `GET https://api.sleeper.app/v1/stats/nfl/regular/<season>/<week>` → pretty JSON fixture. Capture 2025 weeks 17 and 1.
2. Findings doc must answer, with evidence:
   - **Keying:** entries keyed by Sleeper player id? What % of keys exist in our `players` table (read-only DB join — expect high for skill positions; DEF entries key like team codes)?
   - **Stat vocabulary:** for each of our 60 `SCORING_STAT_KEYS`, does the key appear in the fixtures with plausible values? Table: key → present/absent → example. Flag any of OUR keys that never appear (naming drift risk for Phase 5).
   - **Spot-check:** 3 known players' week-17 lines (e.g. CMC rush_td=1) vs public box scores — cite the comparison.
   - **Sleeper's own points:** confirm `pts_std`/`pts_half_ppr`/`pts_ppr` present (golden-file cross-check material).
   - **Probe `pre` season type** for August latency-probe viability (`/stats/nfl/pre/2025/1` — note shape/availability only).
   - **Verdict: GO or NO-GO** with one-line rationale.
3. No app code. Commit fixtures + script + doc: `docs(spike): Sleeper stats endpoint GO/NO-GO evidence`.

**GATE: controller reads the doc and confirms GO before Task 2 dispatches.**

---

### Task 2: `stat_lines` table

**Files:** Modify `src/server/schema.ts`; generated + RLS migrations.

```ts
// One row per player-week. `stats` is the raw numeric map from the source;
// scoring reads keys per-league at compute time. source='nflverse' rows are
// corrections and are never overwritten by Sleeper polls.
export const statLines = pgTable('stat_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: text('player_id').notNull().references(() => players.sleeperId),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  stats: jsonb('stats').notNull(),
  source: text('source', { enum: ['sleeper', 'nflverse'] }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('stat_lines_player_week_uq').on(t.playerId, t.season, t.week),
  index('stat_lines_season_week_idx').on(t.season, t.week),
]);
```

Generate → read SQL → migrate live → RLS custom migration (house pattern) → verify indexes + relrowsecurity → `npm run check` → commit.

---

### Task 3: `parseSleeperStats` engine (fixture TDD)

**Files:** Create `src/engine/stats/parseSleeperStats.ts`; test alongside.

`parseSleeperStats(input: unknown, opts: { knownPlayerIds: ReadonlySet<string> }): ParseStatsResult` → `{ ok: true; value: { lines: StatLineInput[]; skippedUnknown: number; skippedInvalid: number } } | { ok: false; error: string }` where `StatLineInput = { playerId: string; stats: Record<string, number> }`:

- Reject non-map input (incl. arrays); bound `MAX_STAT_ENTRIES = 10_000` (2025 wk17 has ~2.5k).
- Per entry: key must be a nonempty string; value zod-parsed as a record; keep only finite-number values (drop nulls/strings/nested); cap `MAX_KEYS_PER_LINE = 120` keys per player (fixture max is well under) — over-cap → skippedInvalid + warning-free (counted, not itemized).
- Keys not in `knownPlayerIds` → `skippedUnknown` count.
- Lines with zero numeric keys after filtering → skippedInvalid.
- Systemic tripwire mirroring playerSync: if entries ≥ 100 and (skippedInvalid / entries) > 0.5 → err (`systemic parse failure`). Unknown-player skips do NOT count toward the tripwire (offseason weeks legitimately have retired players).
- ≥2 invariants; house typed-result style.

Tests (~10, red first): fixture happy path (assert entry count parsed from wk17 fixture minus known skips — derive literals with node); CMC line contains rush_td 1; unknown-id counting; non-numeric values dropped; zero-key line skipped; array/non-object err; tripwire on/off; per-line key cap.

---

### Task 4: `poll-stats` job + workflow

**Files:** Create `src/server/jobs/pollStats.ts`, `src/app/api/jobs/poll-stats/route.ts`, `.github/workflows/poll-stats.yml`; Modify `src/lib/types.ts`/`sleeper.ts` ONLY if a stats fetcher is added there (add `getWeekStats(season, week)` mirroring house fetcher style, endpoint `/stats/nfl/regular/<season>/<week>`).

- `pollStats(season?: number, week?: number)`: params or derive from `getNFLState()` (`season_type` guard: if not 'regular', return `{ok:true, skipped:'offseason'}` — polling outside the season is a no-op, not an error); fetch week stats; `parseSleeperStats` with knownPlayerIds (bounded id select, reuse the pattern); batched upsert (500/batch, bounded) with `onConflictDoUpdate` target `(playerId, season, week)` setting stats/updatedAt/source='sleeper' **with `setWhere: sql\`${statLines.source} <> 'nflverse'\`** (decision #3 — verify drizzle 0.45 supports setWhere; if not, use raw `sql` ON CONFLICT clause and document); returns counts `{upserted, skippedUnknown, skippedInvalid, protected}` (protected = rows untouched due to nflverse source, derivable via returning() delta — if awkward, omit and note).
- Route: POST, CRON_SECRET bearer (copy sync-players route), optional `?season=&week=` zod-validated (season 2020-2050, week 1-18), maxDuration 60.
- Workflow `poll-stats.yml`: cron for game windows — `0,15,30,45 17-23 * * 0` (Sun afternoon/evening UTC), `0,15,30,45 0-5 * * 1,2,5` (Sun/Mon/Thu night games UTC) — every 15 min (Actions cron jitter makes 5-min unrealistic; 15 min meets "minutes-level lag"), plus workflow_dispatch. Inert-until-deploy comment.
- Live verification: POST for `season=2025&week=17` against the real DB (historical backfill is a legitimate production act — Phase 5's golden-file test needs exactly this data); verify row count ≈ parsed count, spot-check CMC's row, run twice for idempotency, 401 unauthenticated.

---

### Task 5: nflverse mapping + diff engines (fixture TDD)

**Files:** Create `src/engine/stats/nflverseMap.ts`, `src/engine/stats/diffStats.ts`, tests, plus small fixtures: `nflverse-sample.csv` (a ~30-row slice of nflverse `player_stats_2025.csv` covering the spot-check players) and `crosswalk-sample.csv` (matching slice of dynastyprocess `db_playerids.csv`). A capture script extension grabs the slices (document source URLs in the fixture header comments: `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_2025.csv`, `https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv`).

- `nflverseMap.ts`: `NFLVERSE_TO_SLEEPER: readonly [nflverseColumn, sleeperKey][]` — the explicit, bounded mapping (passing_yards→pass_yd, passing_tds→pass_td, passing_interceptions→pass_int, rushing_yards→rush_yd, rushing_tds→rush_td, receptions→rec, receiving_yards→rec_yd, receiving_tds→rec_td, sack_fumbles_lost+rushing_fumbles_lost+receiving_fumbles_lost→fum_lost SUMMED — note the 3→1 aggregation, special_teams_tds→st_td, passing_2pt_conversions→pass_2pt, rushing_2pt_conversions→rush_2pt, receiving_2pt_conversions→rec_2pt; verify each column name against the REAL fixture slice — nflverse renames occasionally, the fixture is the contract). `mapNflverseRow(csvRow: Record<string,string>): Record<string, number>` — parse-don't-cast, drop NaN/absent, TDD'd against the fixture rows.
- `crosswalk.ts` (same file or sibling): `parseCrosswalk(csv)` → Map<gsis_id, sleeper_id> (bounded, skip rows lacking either id, count skips).
- `diffStats.ts`: `diffStatLines(existing: Record<string,number>, corrected: Record<string,number>, keys: readonly string[]): { changed: boolean; merged: Record<string,number> }` — compare ONLY mapped keys with `EPSILON = 0.01` tolerance; merged = existing spread + corrected mapped keys (preserves Sleeper-only keys like snap counts); TDD: identical→unchanged; small float noise→unchanged; real diff→changed with correct merge; corrected key absent from existing→changed.

---

### Task 6: `reconcile-stats` job (Opus)

**Files:** Create `src/server/jobs/reconcileStats.ts`, `src/app/api/jobs/reconcile-stats/route.ts`, `.github/workflows/reconcile-stats.yml`.

- `reconcileStats(season: number, week: number)`: fetch nflverse `player_stats_<season>.csv` (stream/size-guard: reject > `MAX_CSV_BYTES = 30MB`; parse with `parseCSVLine`, bounded `MAX_CSV_ROWS = 20_000`, filter to the target week); fetch crosswalk CSV (same bounds); map rows → sleeper-keyed corrections; load existing stat_lines for (season, week) bounded `.limit(6000)`; for each correction with a crosswalked player AND an existing row: `diffStatLines`; changed → batched update `stats = merged, source = 'nflverse'`. Corrections for players with NO existing row → insert (source nflverse) only when the player exists in our universe; else count-skip. Returns `{examined, corrected, inserted, unmatchedCrosswalk, skippedUnknown}`.
- Route: POST, CRON_SECRET, `?season=&week=` REQUIRED here (no NFL-state guessing for a correction job), zod-validated. Workflow: nightly 10:00 UTC in-season days + dispatch, inert-until-deploy comment.
- Live verification: run against 2025 wk17 AFTER Task 4's backfill; report the counts; spot-check one corrected row (if zero corrections — plausible, Sleeper is usually right — verify by hand-perturbing NOTHING: instead run diff logic against a synthetically perturbed copy in a unit test, and accept `corrected: 0` live as a PASS with the reasoning stated).

---

### Final: whole-phase Opus review + walkthrough + merge

Review focus: source-precedence enforcement (can a Sleeper poll EVER clobber an nflverse row — trace the setWhere), tripwire/bounds coverage, the fum_lost 3-column aggregation correctness, workflow cron sanity, fixtures-vs-live drift. Exit criteria:

- Spike doc: GO with evidence committed.
- 2025 weeks 1 + 17 backfilled in stat_lines from the live poll (row counts reported), CMC spot-check passes, poll idempotent, 401s verified.
- Reconcile run against wk17 completes with reasoned counts.
- All engines fixture-TDD'd; `npm run check` green; grandfather list untouched.
- **User walkthrough (light this phase — it's plumbing):** eyeball 2-3 of Rookie Fever's players' 2025 wk17 stat rows vs memory/box scores; confirm the counts summary reads sanely.

**Carried risks:** live-game latency unproven until the ~Aug 7 preseason probe (scheduled follow-up); no deployed env (crons inert); Sleeper endpoint remains unofficial — the spike doc becomes the canary baseline (re-run the capture script if shapes drift).
