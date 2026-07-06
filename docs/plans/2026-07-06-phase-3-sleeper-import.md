# Phase 3: Sleeper One-Time Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A commissioner enters their Sleeper league ID, reviews a dry-run report, confirms, and gets a fully hosted Dynasty league: translated settings, teams, rosters (active/taxi/IR), and a complete future-pick asset base with trades applied.

**Architecture:** Pure translation engines in `src/engine/import/` turn captured Sleeper JSON into our domain rows (fixture-driven TDD — this is the most fixture-heavy phase). One orchestrator in `src/server/import/` fetches live Sleeper data, runs the translators, and either returns a dry-run report or executes everything in a single transaction. Idempotency is DB-enforced: a partial unique index on `leagues.sleeper_league_id`. History does NOT migrate — the hosted league links out to the existing analytics views via its stored `sleeperLeagueId` (they render live from Sleeper already; re-hosting history is pure cost).

**Tech Stack:** Existing stack, no new dependencies. Reuses `src/lib/sleeper.ts` fetchers (`getLeague`, `getLeagueUsers`, `getLeagueRosters`) + one new fetcher (`getTradedPicks` — endpoint `/league/<id>/traded_picks`, missing today).

**Naming hazard (read first):** `src/lib/types.ts` exports a Sleeper-shaped `LeagueSettings` interface that collides with our engine's `LeagueSettings` in `src/engine/settings.ts`. In import code, alias the Sleeper one: `import type { LeagueSettings as SleeperLeagueSettings } from '@/lib/types'`. Never let the two meet unaliased in one file.

**Coding rules:** CODING_STANDARDS.md mandatory. All Sleeper payloads are zod-parsed in the engine translators (the `src/lib/types.ts` interfaces are assertions, not validation — same rule as Phase 2's playerSync). Typed results, named `MAX_*` bounds, complexity ≤10.

---

## Decisions locked now (so tasks don't relitigate)

1. **History**: link-out, not migration. The league home gets a "League history" link to `/league/<sleeperLeagueId>/history` when `sleeperLeagueId` is set. Zero new tables.
2. **Idempotency**: one hosted league per Sleeper league, enforced by partial unique index. Re-import → `already_imported` error. (Deleting and re-importing a botched league is a manual DB operation this phase — acceptable for one league.)
3. **Owners**: imported teams are created UNCLAIMED with invite tokens (Phase 1 claim flow is the account-linking mechanism — proven in walkthroughs). Team names come from Sleeper user metadata (`team_name` → `display_name` → `Team <roster_id>`). No email entry UI.
4. **Roster violations don't block**: the import mirrors Sleeper reality. `validateRosterCounts` runs per roster in the dry-run and its violations surface as warnings (its first real caller). Legality is enforced on future transactions, not on imported state.
5. **Unmatched players skip with warnings**: roster player IDs missing from our `players` table (retired/edge IDs) would violate the FK — dry-run lists them, execution skips them, the report says so. Run `/api/jobs/sync-players` immediately before a real import.
6. **Pick base is materialized in full**: every team owns its own future picks for the next `FUTURE_PICK_YEARS = 3` seasons × `DEFAULT_ROOKIE_ROUNDS = 4` rounds; Sleeper's `traded_picks` then reassign `currentTeamId`. Trades (Phase 7) need the complete asset base, not just the traded slice. Rounds beyond 4 in traded_picks data widen the base for that year (warning noted).
7. **Test-data cleanup**: executing a real import happens in the phase-end walkthrough; the 3 seeded test roster rows on Team 1 (from Phase 2) belong to the OLD hand-made league, which stays as-is (it's the user's sandbox). The import creates a NEW hosted league from Sleeper.

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. pick_assets table + import-idempotency index | sonnet | controller self |
| 2. getTradedPicks fetcher + fixture capture | sonnet | controller self |
| 3. translateSettings engine | sonnet | sonnet |
| 4. translateRosters + translatePicks engines | sonnet | sonnet |
| 5. Import orchestrator (dry-run + execute) | **opus** | sonnet |
| 6. Import wizard UI + history link | sonnet | haiku |
| Final whole-phase review | **opus** | — |

**User input needed at Task 2:** the real Sleeper league ID (or Sleeper username to look it up). Fixtures are captured from the actual league being migrated.

---

### Task 1: `pick_assets` table + idempotency index

**Files:** Modify `src/server/schema.ts`; generated + custom migrations.

```ts
// Tradeable future rookie picks. The full base is materialized at import
// (every team owns its own next-3-years picks); trades reassign currentTeamId.
export const pickAssets = pgTable('pick_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  season: integer('season').notNull(), // draft year, e.g. 2027
  round: integer('round').notNull(),
  originalTeamId: uuid('original_team_id').notNull().references(() => teams.id),
  currentTeamId: uuid('current_team_id').notNull().references(() => teams.id),
}, (t) => [
  // One asset per (league, year, round, original owner) — the pick's identity.
  uniqueIndex('pick_assets_identity_uq').on(t.leagueId, t.season, t.round, t.originalTeamId),
  index('pick_assets_current_team_idx').on(t.currentTeamId),
]);
```

Plus, in the same task: partial unique index migration `leagues_sleeper_league_uq ON leagues (sleeper_league_id) WHERE sleeper_league_id IS NOT NULL` (idempotency-as-invariant), and RLS enable for `pick_assets` (standard custom migration + comment). Generate → read SQL → migrate live → verify via pg_indexes → `npm run check` → commit `feat(db): pick assets + one-import-per-sleeper-league invariant`.

---

### Task 2: `getTradedPicks` fetcher + fixture capture

**Files:** Modify `src/lib/sleeper.ts` (one fetcher, matching file idiom); Create `src/engine/import/__fixtures__/` (league.json, users.json, rosters.json, tradedPicks.json) + `scripts/capture-import-fixtures.ts`.

1. Add to sleeper.ts (mirrors existing fetchers exactly):
```ts
export async function getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return fetchSleeper<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`);
}
```
   with `SleeperTradedPick` added to `src/lib/types.ts`: `{ season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }` (roster_id = original owner's roster, owner_id = current).
2. `scripts/capture-import-fixtures.ts`: takes a league ID argv, fetches league/users/rosters/traded_picks, writes pretty-printed JSON into the fixtures dir. **ASK THE COORDINATOR for the real league ID before running** — it comes from the user. Sanitize nothing structural, but note fixtures contain real display names (user consented — it's their league).
3. Run it against the real league; commit fixtures + script + fetcher: `feat(import): traded-picks fetcher + real-league fixtures`.
4. NOTE for the eslint file-size cap: sleeper.ts is grandfathered but MUST NOT grow its violation count — adding ~5 lines to a 560-line grandfathered file is fine (file-size rule is off for it), but do not add new rule violations.

---

### Task 3: `translateSettings` engine (fixture-driven TDD)

**Files:** Create `src/engine/import/translateSettings.ts`; Test `src/engine/import/__tests__/translateSettings.test.ts`.

`translateSettings(input: unknown): TranslateResult<{ settings: LeagueSettings; warnings: string[] }>` — parses the RAW Sleeper league JSON (zod: only fields used) and produces our `LeagueSettings`:

- **teamCount** ← `total_rosters` (4–32 else err).
- **rosterSlots** ← count `roster_positions` entries: QB/RB/WR/TE/K/DEF/FLEX map 1:1; `SUPER_FLEX` → SUPER_FLEX; `BN` → BENCH; unknown position strings (e.g. `IDP_FLEX`, `REC_FLEX`) → warning + skipped. TAXI count ← `settings.taxi_slots` (not in roster_positions); IR ← `settings.reserve_slots`. Omit zero-count slots (our schema rejects count 0).
- **scoring.rules** ← intersect `scoring_settings` with `SCORING_STAT_KEYS`, dropping zero values; every nonzero key we DON'T support → warning `unsupported scoring stat 'st_td' (2 pts) — not imported`. `bonus_rec_te` maps into rules (TE premium) — but our schema treats it as a rules key, matching Sleeper.
- **scoring.bonuses** ← empty (Sleeper's flat keys have no threshold bonuses; warning-free).
- **waivers** ← `settings.waiver_type`: 2 → `{mode:'faab', budget: settings.waiver_budget || 100, tiebreaker:'reverse_standings'}`; 0 → `{mode:'priority', order:'rolling'}`; 1 → `{mode:'priority', order:'reverse_standings'}`; other → err.
- **trades** ← `{ reviewMode: settings.trade_review_days > 0 ? 'league_vote' : 'none', futurePickYears: 3, deadlineWeek: settings.trade_deadline in 1..18 ? it : null }` (Sleeper uses 99 for "none").
- **playoffs** ← `{ teams: settings.playoff_teams, startWeek: clamp(settings.playoff_week_start, 14, 17) }` — clamping adds a warning when it changes the value.
- Final gate: run the produced object through `LeagueSettingsSchema.safeParse`; failure → err with the first issue (reuse `firstZodIssueMessage`).

Tests (write first, red): fixture-based happy path asserting the REAL league's known values (fill in exact expectations after reading the captured fixture — the implementer reads the fixture and derives expectations from Sleeper's UI-visible settings, listing them in the test as literals); synthetic cases for: unknown roster position warning; unsupported scoring key warning; waiver_type 2/0/1 mapping; trade_deadline 99 → null; playoff week clamp warning; total_rosters 3 → err; non-object → err. ~10 tests. Commit `feat(engine): Sleeper league settings translation`.

---

### Task 4: `translateRosters` + `translatePicks` engines (fixture-driven TDD)

**Files:** Create `src/engine/import/translateRosters.ts`, `src/engine/import/translatePicks.ts`; tests for each.

**translateRosters(input: unknown, opts: { knownPlayerIds: ReadonlySet<string>; settings: LeagueSettings })** → `{ ok, value: { teams: TeamPlan[]; warnings: string[] } }` where `TeamPlan = { rosterId: number; name: string; members: { playerId: string; status: 'active'|'taxi'|'ir' }[] }`:
- Input: `{ rosters: unknown; users: unknown }` (both raw fixtures). zod-parse minimal shapes.
- Status: in `taxi[]` → taxi; in `reserve[]` → ir; else active. Player in BOTH taxi and reserve → warning, taxi wins (document).
- Unknown player IDs (not in knownPlayerIds) → skipped + warning naming the roster.
- Team name: users metadata `team_name` → `display_name` → `Team <roster_id>`; duplicate names get ` (2)` suffixed (warning).
- Per-team `validateRosterCounts(settings, members)` — violations become warnings prefixed with the team name (first caller!).
- Bounds: `MAX_IMPORT_TEAMS = 32`, `MAX_IMPORT_ROSTER = 100` per team.

**translatePicks(input: unknown, opts: { rosterIds: readonly number[]; currentSeason: number })** → `{ ok, value: { picks: PickPlan[]; warnings: string[] } }` where `PickPlan = { season: number; round: number; originalRosterId: number; currentRosterId: number }`:
- Materialize the base: every rosterId × seasons `currentSeason+1 .. currentSeason+FUTURE_PICK_YEARS` × rounds `1..DEFAULT_ROOKIE_ROUNDS`.
- zod-parse traded_picks; entries for seasons ≤ currentSeason → skipped (already drafted); rounds > DEFAULT_ROOKIE_ROUNDS → widen that season's base for all teams + warning; apply `owner_id` as currentRosterId onto the matching base entry; a traded pick referencing an unknown rosterId → warning + skipped.
- Invariants: base size ≤ 32×3×6; every traded application matched exactly one base entry.

Tests: fixture happy paths (real league's actual traded picks — implementer derives literal expectations from the fixture, e.g. "Team X owns Team Y's 2027 2nd") + synthetic: taxi/reserve overlap; unknown player skip; duplicate team names; pick base count = teams×years×rounds; traded pick reassignment; past-season skip; round widening. ~12 tests across both files. Two commits.

---

### Task 5: Import orchestrator (Opus)

**Files:** Create `src/server/import/sleeperImport.ts`; Create `src/server/actions/import.ts`.

`runSleeperImport(sleeperLeagueId: string, mode: 'dry_run' | 'execute', userId: string): Promise<ImportResult>`:
- Fetch league/users/rosters/tradedPicks (existing fetchers + Task 2's), plus `knownPlayerIds` from our players table (bounded select of ids only, LIMIT 30000 — matches engine cap).
- Run all three translators; any `err` → typed failure carrying which stage.
- **Dry-run** returns a report: league name/season, settings summary + warnings, per-team member counts + statuses, pick base size + trades applied count, ALL warnings, and `blockers` (currently: sleeper league already imported — checked via bounded select).
- **Execute**: re-run everything fresh (no trust in a stale dry-run), then ONE transaction: insert league (sleeperLeagueId set, createdBy = userId, status 'setup') → season (year = Number(league.season), phase 'offseason', settings) → teams (with invite tokens, keeping a rosterId→teamId map) → rosterMembers batched (acquiredVia 'import', BATCH pattern from syncPlayers, batch 500) → pickAssets batched. Unique-violation on the sleeper index → `already_imported` (race-safe, same 23505 mapping idiom as claims).
- Server action `importSleeperLeague(input: unknown)`: zod `{ sleeperLeagueId: z.string().regex(/^\d+$/).max(30), mode: z.enum(['dry_run','execute']) }`, auth required, calls orchestrator with user id. Typed result → UI.
- Post-execute invariant checks inside the transaction: team count matches translator output; rosterMembers inserted = plan minus skips; pick count = base size.

Live verification: dry-run against the REAL league id (read-only by construction) — report the output. Do NOT execute (that's the user's walkthrough moment). `npm run check` green. Commits: orchestrator, then action.

---

### Task 6: Import wizard UI + history link

**Files:** Create `src/app/l/import/page.tsx` + `ImportWizard.tsx` (+ small report components ≤150 lines each); Modify `src/app/l/page.tsx` (add "Import from Sleeper" button next to Create league); Modify `src/app/l/[leagueId]/page.tsx` (when `league.sleeperLeagueId`, render a "League history →" link to `/league/<sleeperLeagueId>/history`).

Wizard: input (league ID; note "find it in Sleeper → League Settings") → dry-run report (settings summary, teams table with member counts, pick summary, warnings list in amber, blockers in red disabling confirm) → Confirm button → execute → redirect `/l/<newLeagueId>`. Handle every error code with friendly text. Logged-out → middleware already bounces (route is under /l).

Verify: check + build green; logged-out curl 307; dry-run through the UI happens in the walkthrough. Commit `feat: Sleeper import wizard + history link-out`.

---

### Final: whole-phase Opus review + walkthrough + merge

Review focus: translator seams (does translateSettings output always satisfy the settings editor's expectations? do skipped players leave dangling references in pick/roster plans?), transaction atomicity, dry-run/execute divergence risk, fixture freshness. Exit criteria:

- Dry-run of the real league produces a clean report (warnings understood, no blockers).
- **Walkthrough:** user executes the real import, sees their actual rosters (~300 members) on team pages, future picks with real trades applied, invite links ready for 11 league mates, history link works. Claim/settings flows still green on the imported league.
- 12/12 translator+engine test files green in `npm run check`; grandfather list untouched.

**Carried risks:** Sleeper stats endpoint still unvalidated (Phase 4 spike is next); no deployed env (Actions cron inert); email deliverability on Microsoft inboxes (walkthrough instructions must say "check Junk").
