# Phase 6: Lineups, Locks, Scoring Wire-up — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** League members set weekly lineups (mobile-first, the most-used page in the product) with position eligibility and per-player game locks enforced; the scoreWeek job turns lineups × stat lines into matchup points and standings. This is the **last season-critical build** — after Phase 6, the platform can run a game week end to end.

**Architecture:** Same discipline: pure engines (`eligibility`, `validateLineup`, `computeStandings`, the scoreWeek math) with I/O shells. Lineups are stored normalized (`lineup_slots`, one row per slot instance) so the DB enforces "a player starts at most once per week" — the index-as-invariant pattern. Per-player locks come from a new `nfl_games` ingestion (nflverse `schedules` release: probed today — `games.csv`, 272 rows for 2026, season/week/gameday/gametime columns; **gametime is US/Eastern by nflverse convention — ingestion converts to UTC timestamps via Intl, no TZ deps**). Lock state is computed at request time and passed INTO the pure validator.

**Tech Stack:** Existing stack, no new dependencies. Reuses: `roundPoints`/`scoreLineup` (Phase 5), `stat_lines` (Phase 4), matchups table + seam note (write 2dp strings), job/route/cron idioms, `parseCSVLine`.

---

## Decisions locked now

1. **Eligibility matrix is explicit engine data** — the mapping Phases 2/4 deferred: QB→{QB, SUPER_FLEX}; RB→{RB, FLEX, SUPER_FLEX}; WR→{WR, FLEX, SUPER_FLEX}; TE→{TE, FLEX, SUPER_FLEX}; K→{K}; DEF→{DEF}. BENCH/TAXI/IR are not lineup slots. Lives in `src/engine/lineup/eligibility.ts` with the cross-reference comments in settings.ts/playerSync.ts updated to point at it (closing the old TODO).
2. **Normalized lineup storage.** `lineup_slots`: one row per starter-slot instance per team-week. DB invariants: unique (team, season, week, slot, slotIndex); partial unique (team, season, week, playerId) WHERE playerId IS NOT NULL — a player cannot occupy two slots. Empty slots are legal (playerId null) and score 0.
3. **Locks are per-player, computed at request time.** A player is locked when their NFL team's kickoff (from `nfl_games`) is ≤ now, for that league-week. Locked semantics: a save may not CHANGE any locked assignment — locked player can't be benched, locked slot's occupant can't be swapped, and a locked player on the bench can't be inserted. Unlocked changes in the same save are fine. The validator receives `lockedNflTeams: ReadonlySet<string>` + `playerTeams: ReadonlyMap<playerId, nflTeam>` — pure, testable, no clocks inside.
4. **No stats season override anywhere.** scoreWeek reads stats strictly for the matchup's own (season, week). Live verification of the write path uses **dry-run mode** (compute + report, no write); 2026 has no stats yet so computed totals are legitimately 0.00 — the write path goes live at the ~Aug 7 preseason probe. Honest inertness over synthetic data in real tables.
5. **Standings tiebreakers (MVP):** wins desc → PF desc → team name asc (deterministic). H2H/division tiebreakers are post-MVP (league settings don't model divisions).
6. **finalize is explicit.** `scoreWeek(..., { finalize })`: cron runs non-finalizing during game windows; the Tuesday-after reconcile cadence runs `finalize: true` (sets `matchups.final`), after which scoreWeek refuses to rewrite that week (guarded UPDATE `WHERE final = false`, row-count checked — same idiom as ever).

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. eligibility + validateLineup engines | sonnet | sonnet |
| 2. lineup_slots table | sonnet | controller self |
| 3. nfl_games ingestion (table + parse engine + job + backfill) | sonnet | sonnet |
| 4. saveLineup action + lock computation | **opus** | sonnet |
| 5. Lineup UI (mobile-first) | sonnet | haiku |
| 6. scoreWeek job + standings + points display | **opus** | sonnet |
| Final whole-phase review | **opus** | — |

---

### Task 1: `eligibility` + `validateLineup` engines (TDD)

**Files:** Create `src/engine/lineup/eligibility.ts`, `src/engine/lineup/validateLineup.ts`, tests for each. Modify (comments only): `src/engine/settings.ts`, `src/engine/playerSync.ts` — point their positions-vs-slots TODO comments at the new matrix.

**eligibility.ts:** `SLOT_ELIGIBILITY: Readonly<Record<RosterSlot-starters-only, readonly Position[]>>` (inverse view of decision #1) + `isEligible(position: string, slot: string): boolean` (unknown position/slot → false, never throws).

**validateLineup.ts:**
```ts
export type LineupAssignment = { slot: string; slotIndex: number; playerId: string | null };
export function validateLineup(input: {
  settings: LeagueSettings;
  members: readonly { playerId: string; status: 'active' | 'taxi' | 'ir' }[];
  playerPositions: ReadonlyMap<string, string>;
  current: readonly LineupAssignment[];   // persisted lineup (empty on first save)
  proposed: readonly LineupAssignment[];
  lockedNflTeams: ReadonlySet<string>;
  playerNflTeams: ReadonlyMap<string, string | null>; // null = free agent, never locked
}): { ok: true } | { ok: false; error: LineupError; detail: string }
```
`LineupError = 'shape_mismatch' | 'not_on_roster' | 'not_active' | 'ineligible_position' | 'duplicate_player' | 'locked_change'`. Checks in that precedence order:
- **shape_mismatch**: proposed slots/counts must exactly match the settings' starter slots expansion (every slot type × count, slotIndex 0..count−1, no extras/missing).
- **not_on_roster / not_active**: every non-null playerId is a member with status 'active' (taxi/IR ineligible).
- **ineligible_position**: player's position eligible for the slot per the matrix.
- **duplicate_player**: no player in two slots.
- **locked_change**: diff current vs proposed per slot instance; any changed assignment involving a locked player (outgoing OR incoming; lock = playerNflTeams.get(id) ∈ lockedNflTeams) → err naming the player and slot. Unchanged locked assignments are fine.
- ≥2 invariants; bounds (MAX_ASSIGNMENTS 30).

Tests (~14, red first): happy full lineup; happy with empty slots; each error branch incl. precedence (shape before roster); FLEX takes RB/WR/TE but not QB; SUPER_FLEX takes QB; K slot rejects WR; taxi and ir member rejections separately; duplicate; locked: benching a locked starter rejected, inserting a locked bench player rejected, leaving a locked assignment untouched while changing an unlocked one accepted; free-agent-team-null player never locked.

### Task 2: `lineup_slots` table

**Files:** schema append + migrations (+RLS, house pattern).

```ts
// One row per starter-slot instance per team-week. playerId null = empty slot.
// The partial unique index is the "player starts at most once" invariant.
export const lineupSlots = pgTable('lineup_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  slot: text('slot').notNull(),
  slotIndex: integer('slot_index').notNull(),
  playerId: text('player_id').references(() => players.sleeperId),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('lineup_slots_instance_uq').on(t.teamId, t.season, t.week, t.slot, t.slotIndex),
  uniqueIndex('lineup_slots_player_uq').on(t.teamId, t.season, t.week, t.playerId).where(sql`${t.playerId} IS NOT NULL`),
  index('lineup_slots_team_week_idx').on(t.teamId, t.season, t.week),
]);
```

### Task 3: `nfl_games` ingestion

**Files:** schema (`nflGames`: season, week, nflTeam text, kickoff timestamptz; unique (season, week, nflTeam)) + migrations/RLS; `src/engine/stats/parseNflSchedule.ts` + test (fixture slice of games.csv committed — capture-script extension); `src/server/jobs/syncNflSchedule.ts` + route `/api/jobs/sync-nfl-schedule` + dispatch-only workflow.

- Parse engine: games.csv rows → per-game TWO team rows (home + away share kickoff); **UTC conversion from America/New_York via Intl.DateTimeFormat with explicit timeZone — TDD with a January (EST) and September (EDT) case to prove DST handling**; bounded; typed results; skip-and-count malformed.
- Job: probe the `schedules` release assets (reuse/generalize `selectReleaseAsset` — it's currently player_stats-named; generalize its signature to take the exact preferred name + fallback name as params, keeping existing tests), fetch games.csv (size-guarded), parse, filter to requested season, batched upsert.
- Live: backfill season 2026 (expect 272 games → 544 team-rows), spot-check: week 1 opener 2026-09-09 20:20 ET → 2026-09-10T00:20:00Z. Report.

### Task 4: `saveLineup` action + lock computation (Opus)

**Files:** `src/server/actions/lineup.ts`; small helper `src/server/lineup/locks.ts` (`getLockedNflTeams(season, week, now)` — bounded select of nfl_games where kickoff ≤ now).

Action `saveLineup(input: unknown)`: zod {teamId uuid, season int, week int 1..18, assignments: array (max 30) of {slot string max 20, slotIndex int 0..39, playerId nullable string max 30}}; auth → team fetch (limit 1) → **viewer must be the team's OWNER** (not league creator — owners set their own lineups; creator does NOT get to edit others' lineups in MVP: note this as an explicit decision, commissioner lineup-override is a Phase 7 commish tool) → season/settings fetch + safeParse → week window (regular season: 1..playoffs.startWeek−1 for now; playoff lineups post-MVP note) → load members + positions + current lineup + locks (all bounded) → `validateLineup` → on ok: transaction DELETE current week's rows + batched INSERT proposed (the partial unique index backstops duplicates; 23505 → 'conflict' error code) → typed results, every code UI-mapped.
Post-invariants: inserted === proposed length. NO partial saves.

### Task 5: Lineup UI (mobile-first)

**Files:** `src/app/l/[leagueId]/roster/[teamId]/lineup/page.tsx` + client components (each ≤150 lines); link from the roster page and team cards ("Set lineup" for the owner).

Server page: team + ownership check (non-owners see read-only lineup view); settings starter slots; members with positions/NFL teams; current lineup; locked team set + kickoff times for display. Client editor: slot list (grouped by slot type) rendered mobile-first (single column, large touch targets); each slot opens an eligible-player picker (bench players filtered by eligibility matrix client-side for UX — server revalidates); locked slots visually locked with kickoff time shown; save button → action → error codes mapped (esp. `locked_change` naming the player); optimistic disable during save; empty-slot allowed with warning styling. Week selector (current week default — derive from nfl_games: first week whose games aren't all past; helper in the server page, bounded).

### Task 6: `scoreWeek` job + standings (Opus)

**Files:** `src/server/jobs/scoreWeek.ts` + route `/api/jobs/score-week` (+ workflow additions: extend poll-stats workflow with a follow-on scoreWeek call? NO — separate dispatch-only workflow, same inert pattern; deploy wires the chain); `src/engine/standings.ts` + test; league home standings section + matchups page points display already renders strings (verify).

- `scoreWeek(season, week, { finalize })`: for each hosted league with matchups in (season, week) (bounded select of leagues, limit 50): settings parse → rules; lineups for both teams of each matchup (bounded); stats for (season, week) bounded; `scoreLineup` per team (players with no stat line → 0 — bye/DNP); write `roundPoints(total).toFixed(2)` strings via guarded UPDATE `WHERE id = ? AND final = false` (row-count checked; already-final rows counted as skipped); finalize=true additionally sets final. Teams with NO lineup rows → total 0.00 + counted in report (`teamsWithoutLineups`). Result: {ok, leaguesScored, matchupsScored, skippedFinal, teamsWithoutLineups} | err.
- Route: POST, CRON_SECRET, season+week required, optional finalize bool, maxDuration 60.
- `computeStandings(matchups: readonly {homeTeamId, awayTeamId, homePoints, awayPoints, final}[]): Standing[]` — pure; only FINAL matchups count; W/L/T, PF/PA (Number()-parse the strings — the seam note); sort wins desc, PF desc, name asc applied by the caller with names. TDD (~8 tests incl. ties, no-final-games empty standings, string-points parsing).
- League home: standings panel (all zeros pre-season is correct and expected).
- Live verification: dry-run–style — run scoreWeek for 2026 wk1 with a TEMPORARY report-only invocation? The job as spec'd writes. Add `dryRun: true` option (compute + report, no writes) — cheap, honest, and operationally useful forever (report totals before finalizing). Live: dryRun 2026 wk1 → all 0.00 totals, teamsWithoutLineups = 24 minus however many lineups exist post-walkthrough. NO non-dry-run live execution this phase (decision #4).

### Final: whole-phase Opus review + walkthrough + merge

Review focus: lock-rule correctness (the diff semantics — the classic bug is allowing a locked player to be benched by swapping the SLOT rather than the player), lineup save atomicity, scoreWeek × final interplay, DST handling in kickoff conversion, eligibility matrix vs settings/playerSync cross-references actually closed. Exit criteria:

- validateLineup + eligibility fully TDD'd; lineup_slots invariants live; nfl_games backfilled (544 team-rows, DST-correct spot-check).
- saveLineup enforces owner-only + full validation; UI mobile-first with locked-state rendering.
- scoreWeek dry-run live against 2026 wk1 (all-zero totals expected + honest report); standings engine TDD'd; standings panel renders.
- `npm run check` green; grandfather untouched.
- **User walkthrough:** set Rookie Fever's week-1 lineup on a phone-width window; verify eligible-only pickers (no QB offered in RB slots, no taxi players offered); save; reload; confirm persisted. Locks can't be live-tested in July (no kickoffs ≤ now in-season) — verify the locked-state UI via the read path if any 2026 preseason kickoff… none before Aug; note honestly as deferred to the Aug 7 probe.

**Carried:** Aug 7 preseason probe now covers THREE things: poll latency, scoreWeek write path, live lock behavior. Deploy TODOs unchanged. Commissioner lineup-override → Phase 7 commish tools.
