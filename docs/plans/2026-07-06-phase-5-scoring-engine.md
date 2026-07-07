# Phase 5: Scoring Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A pure scoring engine that applies any league's rules-as-data to raw stat lines, proven correct by replaying the user's real 2025 Sleeper season and matching Sleeper's official numbers at per-player, per-starter, and per-team granularity — plus the matchups table and schedule generator that scoring will fill in-season.

**Architecture:** The money path stays pure: `scoreStatLine(rules, bonuses, stats)` is a dot product over the league's configured stat keys (Sleeper's stat lines already include earned bonus keys like `bonus_rush_yd_100` as stats — the spike proved this — so imported leagues score with `bonuses: []`; our native threshold-bonus array applies on top for MFL-grade configs). The **golden-file test is the phase centerpiece**: fixtures from the 2025 predecessor league (`1181064052869079040`, status complete, probed today: 12 wk17 matchups with `points: 107.92`-style totals, 10-player starters arrays, `players_points` maps) scored through `translateSettings` + `scoreStatLine` against the Phase 4 stat fixtures must reproduce Sleeper's numbers within ±0.01.

**Tech Stack:** Existing stack, no new dependencies. Reuses: `translateSettings` (Phase 3), `sleeper-2025-wk{1,17}.json` stat fixtures (Phase 4), house engine idioms.

---

## Decisions locked now

1. **Golden file at three granularities, two weeks, all twelve teams.** Per-player (`players_points`), per-starter-slot (`starters_points`), per-team total (`points`), for weeks 1 and 17 of 2025. Tolerance ±0.01 (Sleeper displays 2dp). A mismatch is a STOP-and-investigate, not a tolerance bump — the pivot gate rides on this.
2. **Imported-league bonuses ride the stat line.** Sleeper emits earned bonuses as stat keys; `translateSettings` already maps them into `scoring.rules`. Our separate `bonuses[]` (threshold-based) exists for native MFL-grade configs and is TDD'd synthetically — it plays no role in the golden file.
3. **Empty starter slots:** Sleeper uses the string `"0"` as an empty-slot sentinel in `starters` arrays. `scoreLineup` treats `"0"` (and any id with no stat line — byes, DNPs) as 0 points, never an error.
4. **Deferred to Phase 6 (they require lineups):** the `scoreWeek` job that fills matchup points in-season, standings computation, and any live-scoring UI. Phase 5 delivers engines + schedule + a read-only matchups page showing pairings.
5. **Schedule generator:** circle-method round-robin, no divisions (not in our settings schema — documented limitation), regular season = weeks 1 through `playoffs.startWeek − 1` (13 weeks for the real league); with 12 teams that's a full 11-week round-robin plus the first 2 rotation weeks repeated — deterministic given the same team-id order (sorted by team id; documented).
6. **Schedule generation is commissioner-triggered** (creator + offseason + no existing matchups for that season → refuse otherwise), not automatic at import.

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. 2025-league golden fixtures | sonnet | controller self |
| 2. scoreStatLine + scoreLineup engines | sonnet | sonnet |
| 3. **Golden-file test** | **opus** | sonnet |
| 4. matchups table | sonnet | controller self |
| 5. schedule generator engine | sonnet | sonnet |
| 6. generateSchedule action + matchups page | sonnet | haiku |
| Final whole-phase review | **opus** | — |

---

### Task 1: Golden fixtures from the 2025 season

**Files:** Create `scripts/capture-golden-fixtures.ts`; fixtures `src/engine/scoring/__fixtures__/league-2025.json`, `matchups-2025-wk1.json`, `matchups-2025-wk17.json`.

Plain-fetch script (house style): `/league/1181064052869079040` (the 2025 predecessor — its own scoring settings; do NOT reuse the 2026 fixture, rules can drift between seasons), `/league/<id>/matchups/1` and `/matchups/17`. Report headline stats: 12 matchups per week, each with points/starters(10)/starters_points/players_points; note any `"0"` empty-slot sentinels and any starter ids MISSING from the Phase 4 stat fixtures (there should be none — flag loudly if found, the golden file depends on it). Commit.

### Task 2: `scoreStatLine` + `scoreLineup` engines (synthetic TDD)

**Files:** Create `src/engine/scoring/score.ts`; test alongside.

```ts
export function scoreStatLine(
  rules: Readonly<Record<string, number>>,
  bonuses: readonly { stat: string; threshold: number; points: number }[],
  stats: Readonly<Record<string, number>>,
): number
```
- Dot product over `rules` keys present in `stats` (absent = 0, never throws); plus each bonus whose `stats[stat] >= threshold` (once per bonus entry). No rounding inside — return the raw float; export `roundPoints(n): number` (2dp, half-up) separately for display/storage.
- Bounds: `MAX_RULE_KEYS = 200` invariant; ≥2 invariants total (finite result; rules values finite).

```ts
export function scoreLineup(
  rules, bonuses,
  starters: readonly string[],
  statsByPlayer: ReadonlyMap<string, Readonly<Record<string, number>>>,
): { total: number; perStarter: number[] }
```
- `"0"` sentinel or missing stat line → 0 for that slot (decision #3). `MAX_STARTERS = 30` bound. perStarter aligns index-for-index with input.

Tests (~10, synthetic, red first): dot product exactness (0.04 × 317 pass_yd etc.); negative stats (fum_lost −2); absent keys are 0; threshold bonus at/below/above threshold; multiple bonuses; empty rules → 0; sentinel and missing-player slots → 0; perStarter alignment; roundPoints half-up cases (0.005 → 0.01, 107.915 → 107.92).

### Task 3: THE GOLDEN FILE (Opus)

**Files:** Create `src/engine/scoring/__tests__/golden2025.test.ts` (+ a small `goldenHelpers.ts` beside it if extraction keeps the test readable).

The test, per week (1 and 17), all 12 rosters:
1. `translateSettings(league-2025.json)` → must be ok; use `value.settings.scoring.rules` (bonuses are [] for this league).
2. Load the Phase 4 stat fixture for that week (`src/engine/stats/__fixtures__/sleeper-2025-wk<N>.json`); build statsByPlayer (raw entries — the engine ignores non-scoring keys by construction).
3. For each matchup entry: for each starter id (skipping `"0"`): `roundPoints(scoreStatLine(rules, [], stats))` must equal Sleeper's `players_points[id]` ±0.01; the `perStarter` array from `scoreLineup` must match `starters_points` element-wise ±0.01; `roundPoints(total)` must match `points` ±0.01.
4. Assert aggregate: 24 team-weeks validated, and REPORT (via a test-time console table or expect messages) the max absolute deviation observed — expect ≤ 0.01.

**If mismatches appear** (the realistic risks, pre-analyzed): (a) a league scoring key Sleeper applies that translateSettings dropped — check the warnings array first; (b) float accumulation order — compare pre-round sums; (c) a player id in starters missing from the stat fixture (bye-week starter — legitimately 0 in players_points too, verify Sleeper agrees); (d) Sleeper stat-line drift between the fixture capture date and the matchup's frozen points (unlikely for a settled season — if found, re-capture fixtures and document). Investigate to root cause — do NOT widen the tolerance or skip teams; if truly blocked, STOP and report to the coordinator with the evidence.

This test passing = the pivot-gate question answered. Commit message: `test: golden-file — 2025 season scores reproduce Sleeper exactly`.

### Task 4: `matchups` table

**Files:** Modify `src/server/schema.ts`; migrations (+RLS, house pattern).

```ts
// One row per pairing per week. Points are filled by the Phase 6 scoreWeek
// job once lineups exist; null until then. final=true freezes the result.
export const matchups = pgTable('matchups', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  homeTeamId: uuid('home_team_id').notNull().references(() => teams.id),
  awayTeamId: uuid('away_team_id').notNull().references(() => teams.id),
  homePoints: numeric('home_points'),
  awayPoints: numeric('away_points'),
  final: boolean('final').notNull().default(false),
}, (t) => [
  uniqueIndex('matchups_home_week_uq').on(t.leagueId, t.season, t.week, t.homeTeamId),
  uniqueIndex('matchups_away_week_uq').on(t.leagueId, t.season, t.week, t.awayTeamId),
  index('matchups_league_week_idx').on(t.leagueId, t.season, t.week),
]);
```
(Two partial-uniqueness guards: a team can appear at most once per week on each side; a same-team-both-sides row is blocked by an application invariant in Task 6 — note it. `numeric` needs the drizzle `numeric` import.)

### Task 5: Schedule generator engine (synthetic TDD)

**Files:** Create `src/engine/schedule.ts`; test alongside.

`generateRoundRobin(teamIds: readonly string[], weeks: number): SchedulePlan` → `{ ok: true; value: { weeks: { week: number; pairings: { home: string; away: string }[] }[] } } | { ok: false; error: string }`:
- Even team count 4–32 required (odd → err — byes are out of MVP scope, documented); weeks 1–25 bound.
- Circle method: fix team[0], rotate the rest; week w pairing i; alternate home/away by parity for fairness; beyond a full rotation (n−1 weeks), continue rotating (repeat cycle) — deterministic for a given input order. Sort a COPY of teamIds first (determinism regardless of caller order; documented).
- Invariants: every week has n/2 pairings; no team appears twice in a week (assert while building); total appearances per team === weeks.

Tests (~8): 4 teams × 3 weeks = full round robin, everyone plays everyone; no-duplicate-per-week across 12×13; determinism (shuffled input → same output); 12 teams 13 weeks → weeks 12–13 repeat rotation weeks 1–2's pairings (assert structural equality); odd count err; 2 weeks < full rotation fine; home/away balance roughly even (each team home ≥ ⌊weeks/2⌋−1 — soft assert with the actual rule you implement, documented).

### Task 6: `generateSchedule` action + matchups page

**Files:** Create `src/server/actions/schedule.ts`; `src/app/l/[leagueId]/matchups/page.tsx` (+ small components ≤150 lines); Modify `src/app/l/[leagueId]/LeagueNav.tsx` (add Matchups link).

Action `generateSchedule(input: unknown)` (copy the settings-action idiom): zod {leagueId uuid}; auth → not creator → season fetch → phase !== 'offseason' → `season_locked`; existing matchups for (league, season) count > 0 → `already_scheduled`; teams fetched bounded (limit 40); `generateRoundRobin(teamIds, playoffs.startWeek − 1)`; single transaction inserting all matchup rows (home/away team ids from pairings; invariant home ≠ away per row — the same-team guard); typed results, every error mapped in UI.

Page: server component, week selector (searchParam, zod 1–18, default 1), pairings with team names (bounded joins), points columns showing "—" until Phase 6 fills them; creator-only "Generate schedule" button (client island) when no matchups exist; friendly empty state otherwise. Nav link.

Live verification: `npm run check` + build-safe checks; then live: generate the schedule for the REAL imported league (2026, weeks 1–13, 78 matchup rows) via the action path — the walkthrough will eyeball it; verify counts + no-dup invariants via read-only query; second call → `already_scheduled`.

### Final: whole-phase Opus review + walkthrough + merge

Review focus: golden-file rigor (does it really cover 24 team-weeks at 3 granularities with no skips?), scoring-engine numeric hygiene (float order, rounding boundary), schedule fairness/determinism, matchups-table seam for Phase 6's scoreWeek. Exit criteria:

- **Golden file green: 24/24 team-weeks, max deviation ≤ 0.01** — the Aug 15 pivot-gate question answered in July.
- Schedule generated live for the real league (78 rows, verified constraints).
- `npm run check` green; grandfather list untouched.
- **User walkthrough:** view the golden-file summary (the numbers matching Sleeper), browse the generated 2026 schedule on the matchups page, confirm week-1 pairings look sane.

**Carried risks:** none new. Phase 6 inherits: scoreWeek job + standings + lineups (the last season-critical build), preseason latency probe ~Aug 7.
