# Phase 7: Transactions — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** League members trade players and future picks, claim waiver players under FAAB or priority rules, and the commissioner gets audited override tools — the full transactional life of a dynasty league.

**Architecture:** One `transactions` table is the audit ledger for everything (typed jsonb payloads, zod discriminated union — rules-as-data, house style). Pure engines decide (`validateTradeProposal`, `resolveWaiverRun` — the heaviest pure logic since scoring); actions/jobs execute atomically with the established idioms (typed results, gate chains, guarded writes, DB-invariant backstops — the one-player-per-league unique index earns its keep this phase). Every mutation of rosters/picks flows through a transaction row: propose→accept→execute for trades, claim→run→award for waivers, direct-but-audited for commish actions.

**Tech Stack:** Existing stack, zero new dependencies. Reuses: `validateRosterCounts`, `computeStandings`, `rosterMembers`/`pickAssets` tables + their invariant indexes, lineup-cleanup patterns, `LeagueSettingsSchema.waivers/trades` config.

**This is the biggest phase (~2 weeks on the original calendar): 8 tasks + final review.**

---

## Decisions locked now (product behavior — read carefully, these ARE the spec)

1. **Two-team trades only.** Three-team trades are post-MVP (note in UI copy: "multi-team trades coming later").
2. **Traded players arrive as `active` status.** Taxi/IR status does not transfer (matches Sleeper). Acceptance requires BOTH post-trade rosters to pass `validateRosterCounts` — no forced-drop flow; an over-capacity acceptance fails with a clear error telling the receiver to cut first.
3. **Review modes:** `none` → executes on acceptance. `commissioner` → acceptance parks it `pending_review`; commissioner approves (executes) or vetoes. **`league_vote` behaves as `commissioner` for MVP** — the commissioner acts as the league's proxy; true voting is post-MVP (documented in UI copy AND the settings editor's reviewMode description; the imported league is league_vote, so the user-as-commissioner reviews trades — acceptable, and they can flip to `none` in settings).
4. **Trade deadline:** enforced only when `settings.trades.deadlineWeek` is non-null (the real league: null). Current week derives from `nfl_games` (reuse the firstOpenWeek helper logic, exported properly this phase).
5. **Executing a trade (or waiver drop) cleans lineups:** any lineup_slots rows referencing a moved/dropped player for the CURRENT season's current-or-future weeks are nulled in the same transaction (bounded UPDATE) — no ghost starters. Past weeks untouched (history).
6. **Pick trading:** any `pick_assets` row whose `currentTeamId` is the offering team is tradeable. Transfer = update `currentTeamId`. `settings.trades.futurePickYears` bounds which seasons are offerable (season ≤ currentSeason + futurePickYears).
7. **Waivers MVP: all adds are waiver claims; no instant free agency.** Claims sit `pending` until a waiver run processes them. The commissioner can trigger a run anytime ("Process waivers now" button → the job); the cron (inert until deploy) runs Wed 08:00 UTC in-season. Instant FA pickup is post-MVP (documented). Unclaimed players remain claimable in the next run.
8. **Waiver state on teams (migration):** `teams.faabRemaining` (int, nullable — lazily initialized to `settings.waivers.budget` on a team's first run participation; backfilled NOW for the imported league's 12 teams at $500) and `teams.waiverPriority` (int, backfilled alphabetically by name per league; new leagues initialize at creation order going forward — createLeague/import touch-ups included).
9. **Waiver resolution semantics** (the engine's contract): process claims in award order — FAAB: bid desc, tie → tiebreaker (`reverse_standings`: worse team wins; `rolling`: better waiverPriority number = earlier pick... lower number wins); priority mode: order per `order` config. `reverse_standings` with ZERO final matchups falls back to waiverPriority order (documented — preseason reality). Per award: validate claimant capacity (with their drop applied); insufficient FAAB → reject('insufficient_funds'); player already awarded this run → reject('player_taken'); capacity fail → reject('roster_full'); winner pays bid, rolling mode rotates winner to back. A team's multiple claims process independently in the global order.
10. **Commissioner tools (audited):** force add/drop (validated — commish cannot exceed capacity either) and **commish lineup edit** (bypasses ownership AND locks, NOT shape/eligibility/roster-membership — Sleeper parity; implemented as an `asCommissioner` param on saveLineup's gate, allowed only when caller is league creator, audited as a `commish` transaction). Reverse-transaction is post-MVP (the ledger makes it buildable later). EVERY commish mutation writes a transaction row.
11. **Transaction statuses:** trades: `pending → cancelled | rejected | accepted → processed | pending_review → processed | vetoed`. Waivers: `pending → cancelled | processed | rejected` (with reason in payload). Commish: `processed` immediately. Status transitions are guarded UPDATEs (WHERE status = expected, row-count checked — the race idiom).

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. transactions table + teams waiver columns + payload schemas | sonnet | sonnet |
| 2. trade validation engine | sonnet | sonnet |
| 3. trade actions (propose/respond/review/execute) | **opus** | sonnet |
| 4. trade UI | sonnet | haiku |
| 5. resolveWaiverRun engine | **opus** | sonnet (adversarial) |
| 6. waiver actions + run-waivers job | **opus** | sonnet |
| 7. waiver UI (player browse + claims) | sonnet | haiku |
| 8. commish tools + transaction log | sonnet | sonnet |
| Final whole-phase review | **opus** | — |

---

### Task 1: `transactions` table + teams waiver columns + payload schemas

**Files:** schema append + migrations (+RLS); `src/engine/transactions/payloads.ts` (+ test).

```ts
// The audit ledger: every roster/pick mutation flows through a row here.
// payload is a zod discriminated union (engine/transactions/payloads.ts) —
// parse on every read, never cast (Rule 5).
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  type: text('type', { enum: ['trade', 'waiver_claim', 'commish'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'accepted', 'pending_review', 'processed', 'rejected', 'cancelled', 'vetoed'],
  }).notNull(),
  payload: jsonb('payload').notNull(),
  createdBy: uuid('created_by').notNull().references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  index('transactions_league_status_idx').on(t.leagueId, t.status),
  index('transactions_league_created_idx').on(t.leagueId, t.createdAt),
]);
```

Teams columns (same migration round): `faabRemaining: integer('faab_remaining')` (nullable), `waiverPriority: integer('waiver_priority')` (nullable). **Backfill migration (custom SQL):** for the imported league — faab_remaining = 500 for all teams; waiver_priority = row_number() over (partition by league_id order by name). Comment documents the lazy-init rule for future leagues + the createLeague/import touch-up (Task 6 adds the code side).

Payload schemas (zod discriminated union on `kind`, TDD ~8 tests):
```ts
TradePayload: { kind: 'trade', proposingTeamId, counterpartyTeamId, give: { playerIds: string[] (≤15), pickIds: uuid[] (≤10) }, receive: { same shape }, note?: string ≤280 }
WaiverClaimPayload: { kind: 'waiver_claim', teamId, addPlayerId, dropPlayerId: string|null, bid: int 0..10000 | null, resolution?: { outcome: 'awarded'|'rejected', reason?: string } }
CommishPayload: { kind: 'commish', action: 'force_add'|'force_drop'|'lineup_edit', teamId, detail: Record<string,unknown> bounded }
```
`parseTransactionPayload(type, payload: unknown)` → typed result (type/kind cross-check enforced — a 'trade' row with a waiver payload → err).

### Task 2: Trade validation engine (TDD)

**Files:** `src/engine/transactions/validateTrade.ts` (+ test ~14).

`validateTradeProposal(input)` — pure; inputs: payload (parsed TradePayload), both teams' rosterMembers, both teams' owned pickAssets (ids + season), settings (trades config + rosterSlots), currentSeason, currentWeek, playerPositions (for nothing yet — capacity only; eligibility not relevant to trades). Checks (precedence): `same_team` (proposing === counterparty) → `empty_trade` (both sides empty) → `asset_not_owned` (every give playerId on proposing roster, every give pickId currently proposing's; mirror for receive/counterparty) → `pick_out_of_window` (pick season > currentSeason + futurePickYears) → `deadline_passed` (deadlineWeek non-null && currentWeek > deadlineWeek) → `capacity` (simulate the swap: both post-trade member lists through `validateRosterCounts`; traded-in players count as 'active' per decision #2 — taxi/ir statuses of DEPARTING players free their buckets, arriving players land active). Returns ok | {error, detail}. Also export `planTradeExecution(payload, rosters)` → the concrete move list ({playerId, fromTeam, toTeam}[], {pickId, toTeam}[]) — pure, consumed by Task 3's executor; invariant: moves cover exactly the payload's assets.

### Task 3: Trade actions (Opus)

**Files:** `src/server/actions/trades.ts`.

Actions (all zod → auth → gates → typed results, the lineup.ts template):
- `proposeTrade(input)`: proposer must OWN proposingTeamId; both teams same league; deadline+window+ownership+capacity via the engine (capacity checked at propose time as a WARNING-level pass — full validation re-runs at accept; comment why: rosters drift between propose and accept); insert transaction (pending, payload).
- `respondToTrade(input {transactionId, response: 'accept'|'reject'})`: responder must own counterparty team; guarded status transition pending→(accepted|rejected); on accept: RE-validate fully with fresh data → failure → status stays pending + typed error to the responder (not silently rejected); reviewMode none → execute inline; else → pending_review.
- `cancelTrade`: proposer only, pending only (guarded).
- `reviewTrade(input {transactionId, decision: 'approve'|'veto'})`: league creator only; pending_review only (guarded); approve → execute; veto → vetoed.
- `executeTrade(tx, transactionRow)` (internal): inside ONE db.transaction — re-validate against in-transaction reads (final authority), move rosterMembers (delete+insert teamId/status 'active'/acquiredVia 'trade'), update pickAssets.currentTeamId, null lineup_slots for moved players (current+future weeks, bounded), status→processed + resolvedAt (guarded). 23505 anywhere → 'conflict'. Post-invariants: moved counts match plan.
- Error union documented; every code UI-mapped in Task 4.

### Task 4: Trade UI

**Files:** `src/app/l/[leagueId]/trades/page.tsx` + components (≤150 each); nav link "Trades".

Page sections: **Propose** (counterparty team select → two asset pickers: my players/picks, their players/picks — grouped, bounded lists; note + submit); **Pending** (incoming: accept/reject buttons; outgoing: cancel; each renders both sides' assets with names); **Review queue** (creator only, when pending_review rows exist: approve/veto); **History** (processed/vetoed/rejected, last 20). All actions' error codes mapped. Empty states throughout.

### Task 5: `resolveWaiverRun` engine (Opus, adversarial TDD — the phase's hardest pure logic)

**Files:** `src/engine/transactions/resolveWaiverRun.ts` (+ test ~20).

```ts
resolveWaiverRun(input: {
  waivers: LeagueSettings['waivers'];
  claims: readonly { transactionId: string; teamId: string; addPlayerId: string; dropPlayerId: string | null; bid: number | null; createdAt: string }[];
  standings: readonly Standing[]; // may be empty (preseason)
  rosters: ReadonlyMap<string, readonly { playerId: string; status: 'active'|'taxi'|'ir' }[]>;
  faabRemaining: ReadonlyMap<string, number>;
  waiverPriority: ReadonlyMap<string, number>;
  settings: LeagueSettings; // for validateRosterCounts
}): { ok: true; value: { decisions: Decision[]; newFaab: Map<string, number>; newPriority: Map<string, number> } } | { ok: false; error: string }
// Decision = { transactionId, outcome: 'awarded' | 'rejected', reason?: 'outbid'|'player_taken'|'insufficient_funds'|'roster_full'|'invalid_drop' }
```
Semantics per decision #9. Deterministic total order: FAAB → bid desc, then tiebreaker, then createdAt asc, then transactionId asc (final determinism); priority → configured order, then createdAt, then id. Simulation state: rosters mutate as awards land (a team's second award sees its first); budgets decrement; rolling priority rotates ON AWARD only. invalid_drop = dropPlayerId not on (simulated) roster. Bounds MAX_CLAIMS 200; invariants: every claim gets exactly one decision; no player awarded twice; no budget below zero.
Tests must include: FAAB outbid; FAAB tie → reverse_standings (with real Standing fixtures); tie → rolling; preseason fallback (empty standings → priority order); insufficient funds (bid > remaining AFTER earlier award); player_taken; roster_full without drop, ok WITH drop; invalid_drop (player traded away between claim and run); rolling rotation (winner to back, affects later tie in SAME run); zero-bid claims valid in FAAB; multiple awards same team; determinism (shuffled claims → identical decisions).

### Task 6: Waiver actions + run-waivers job (Opus)

**Files:** `src/server/actions/waivers.ts`; `src/server/jobs/runWaivers.ts` + route `/api/jobs/run-waivers` + dispatch-only workflow (cron commented: `0 8 * * 3` in-season).

- `submitClaim(input)`: owner-only; player must be UNROSTERED in this league (bounded check; the one-player-per-league index backstops at award time); bid required iff FAAB mode (0 allowed), must be ≤ current faabRemaining (advisory — re-checked at run); dropPlayerId if provided must be on the claimant's roster; duplicate pending claim by same team for same player → 'duplicate_claim'; insert transaction (pending).
- `cancelClaim`: owner, pending only (guarded).
- `runWaivers(leagueId?)` job: per league with pending waiver_claims (bounded 50 leagues): load claims/rosters/standings (computeStandings on final matchups)/budgets (lazy-init nulls to settings budget)/priorities → `resolveWaiverRun` → ONE db.transaction per league: apply awards (insert rosterMembers acquiredVia 'waiver', delete drops, null dropped players' lineup slots current+future, decrement faab, rotate priorities, per-claim guarded status update pending→processed/rejected with resolution in payload). One league's failure doesn't block others (counted). Route: POST, CRON_SECRET, optional leagueId. ALSO an owner-facing commissioner action `processWaiversNow(leagueId)` (creator-only) that invokes the same job logic for their league — powers the UI button.
- Result counts: {leaguesProcessed, awarded, rejected, skippedLeagues}.

### Task 7: Waiver UI

**Files:** `src/app/l/[leagueId]/players/page.tsx` (+ components); nav link "Players".

Unrostered-player browser: search by name (bounded ilike, limit 50) + position filter chips; each row: name/pos/team + "Claim" → modal (bid input when FAAB with remaining shown; optional drop select from own roster; submit → submitClaim errors mapped). **My claims** section (pending: bid/drop shown, cancel; recent resolutions with reasons). League waiver state strip: mode, my faabRemaining (or priority position), next run note + commissioner's "Process waivers now" button (creator only) with confirmation.

### Task 8: Commish tools + transaction log

**Files:** `src/server/actions/commish.ts`; `src/app/l/[leagueId]/commish/page.tsx` (+ components); `src/app/l/[leagueId]/activity/page.tsx`; saveLineup modification (small): `asCommissioner?: boolean` — when true and caller is league creator: skip not_owner gate AND pass `lockedNflTeams: new Set()` into validateLineup (bypass locks, keep all other rules); on success ALSO write a commish transaction (lineup_edit, audited). Lineup page: creator viewing another team gets an "Edit as commissioner" affordance (amber-styled, clearly labeled).
- `commishForceAdd(input {teamId, playerId})` / `commishForceDrop(input {teamId, playerId})`: creator-only; validated (capacity via validateRosterCounts, unrostered check for add); atomic with lineup cleanup on drop; audit rows (processed).
- Commish page (creator-only): pending trade reviews count/link, process-waivers button (shared component with Task 7), force add/drop forms (player search reuse), link to activity.
- Activity page (all members): transaction feed, newest first, bounded 50, rendered per type (trade: both sides; waiver: award/reject + reason; commish: action + team) — names resolved via bounded joins. This is the league's audit trail made visible.

### Final: whole-phase Opus review + walkthrough + merge

Review focus: the transaction table as single source of truth (does ANY roster/pick mutation path bypass the ledger?), trade execute vs waiver award vs commish paths sharing lineup-cleanup semantics consistently, re-validation freshness (propose-time vs accept-time vs execute-time), waiver determinism, one-player-per-league index as the final backstop in ALL paths, status-transition guards everywhere.

**Walkthrough (two-account, like Phase 1's):** user claims a second team with the hotmail account → proposes a trade (players + a 2027 pick both ways) from Rookie Fever → accepts as the second team → reviews/approves as commissioner (league is league_vote→commissioner mode) → verifies rosters, picks pages, and lineup cleanup → submits waiver claims from both teams on the same unrostered player with different FAAB bids → "Process waivers now" → verifies award/outbid + budgets on the players page → commish force-drop + a commissioner lineup edit on the second team → activity feed shows every transaction. 

**Carried:** Aug 7 preseason probe unchanged; instant FA, league voting, 3-team trades, reverse-transaction all post-MVP (documented in copy); deploy TODOs unchanged.
