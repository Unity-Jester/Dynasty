# Phase 8: PWA, Notifications, Playoffs & Deploy — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The platform becomes a phone-installable PWA that pushes lineup/trade/waiver notifications, knows how to run a playoff bracket to a champion, and is deployed to production with the job crons live — everything the league needs before the September dress rehearsal (Phase 9).

**Architecture:** Playoffs are pure engine logic (`generateBracket`/`advanceBracket`) persisted as ordinary `matchups` rows and driven by scoreWeek's existing finalize path — no parallel scoring system. Push is a `push_subscriptions` table + a bounded `web-push` send helper; every trigger is fire-and-forget AFTER the owning transaction commits (notifications must never block or fail a money path). The PWA is a hand-rolled minimal service worker (push + install only, no offline cache — stale-cache bugs are worse than no cache) plus a manifest. Deploy is Vercel hobby + the existing GitHub Actions crons switched on.

**Tech Stack:** Existing stack + `web-push` (already installed, Phase 1). No new dependencies. NO `next-pwa` (hand-rolled SW).

**Prerequisite gate (before merge of this phase, ideally before Task 1): the PINNED Phase 7 walkthrough** — two-account trade → commish approve, dueling FAAB claims → process now, force-drop + commish lineup edit, activity feed — plus the ledger trust-but-verify pass against the DB. Phase 8's walkthrough extends it (see Final section). If anything fails, fixing it preempts this plan.

---

## Decisions locked now (product behavior — these ARE the spec)

1. **Bracket sizes 2/4/6/8** (`settings.playoffs.teams`), byes = nextPow2 − teams (6-team → seeds 1–2 bye). One week per round, no two-week championship, no reseeding after rounds (fixed bracket — Sleeper default), no consolation bracket (post-MVP, documented in UI copy).
2. **Seeding = end-of-regular-season standings order** (the canonical `computeStandings` sort: wins desc → PF desc → name). Head-to-head tiebreakers are post-MVP. Seeds are computed from final regular-season matchups ONLY and are stable for the whole bracket.
3. **Playoff ties: higher seed advances.** (Points tie on a final playoff matchup → the better-seeded team wins; documented in UI.)
4. **Bracket generation trigger:** when scoreWeek FINALIZES the last regular-season week (max scheduled matchup week < `playoffs.startWeek`), the same transaction creates round-1 playoff matchups and sets `seasons.phase='playoffs'`. Gap weeks (reg season ends wk13, startWeek 15 → idle wk14) are legal and produce no matchups. Finalizing the championship week records `seasons.championTeamId` and sets `phase='complete'`.
5. **Cross-field settings validation** (closes the `TODO(Phase 8)` in settings.ts): `playoffs.teams <= teamCount` and `playoffs.teams ∈ {2,4,6,8}`. Existing leagues re-validate on next settings write, not retroactively.
6. **Notifications are per-device opt-in, all-or-nothing.** No per-event preference UI in MVP (documented). Three event families: trade activity (offer received; your trade accepted/vetoed/processed), waiver results (your claims' outcomes after a run), lineup deadline (empty starter slot with kickoff approaching).
7. **Notification sends are fire-and-forget**: called after the DB transaction commits, `void`-ed with a why-comment (Rule 7), individually try/caught, NEVER awaited on a user-facing path's critical section, NEVER able to fail the mutation. A dead subscription (410/404 from the push service) is deleted on the spot.
8. **Lineup reminders**: hourly cron (inert until deploy) checks leagues in-season: teams with ≥1 EMPTY starter slot for the current week where the week's first not-yet-kicked-off game is within 12 hours → one push per team per week (deduped via `notification_log`).
9. **SW scope:** push + notification-click (focus/open the app at a target URL) + the install-required fetch handler no-op. No precache, no runtime cache.
10. **Deploy target:** Vercel hobby, domain `MyFFDynasty.app`, jobs stay on GitHub Actions cron (5-min granularity). Crons get enabled in this phase — each workflow's `TODO(deploy)` gate ("needs a current-week/season derivation") is now satisfiable: the job routes already no-op cleanly out of season/week (verify per-route in Task 8, fix where untrue). Branded email templates + DMARC tightening: Task 8 documents; execution is a stretch goal with the user.

## Task tiering

| Task | Implementer | Spec review |
|---|---|---|
| 1. Playoff engine (bracket gen/advance) + settings cross-validation | **opus** | sonnet (adversarial) |
| 2. Playoff integration: finalize hook, phase transitions, champion | **opus** | sonnet |
| 3. Bracket UI | sonnet | haiku |
| 4. Push schema + send helper | sonnet | sonnet |
| 5. PWA shell (manifest/SW/registration/subscribe UI) | sonnet | sonnet |
| 6. Notification triggers + lineup-reminder job | sonnet | sonnet |
| 7. Lineup seam fix (locked departed player) — Phase 7 carry-over | sonnet | sonnet |
| 8. Deploy readiness (vercel config, maxDuration, cron enablement) | sonnet | sonnet |
| Final: whole-phase review + walkthroughs + DEPLOY + merge | **opus** | — |

---

### Task 1: Playoff engine + settings cross-field validation (Opus, adversarial TDD)

**Files:** `src/engine/playoffs.ts` (+ test ~18); `src/engine/settings.ts` (cross-field refine + tests).

Settings first (TDD): add the `.refine`s per decision #5; update the settings editor's zod error surfacing if a new message needs mapping (check `src/app/l/[leagueId]/settings/`).

```ts
generateBracket(input: {
  playoffs: LeagueSettings['playoffs'];
  standings: readonly Standing[];      // final regular-season standings, canonical order
  season: number;
}): { ok: true; value: { seeds: SeededTeam[]; round1: BracketPairing[] } } | { ok: false; error: string }
// SeededTeam = { teamId, seed }  (seed 1-based, standings order)
// BracketPairing = { week, homeTeamId, awayTeamId, homeSeed, awaySeed } — home = better seed.
// 6 teams: wk startWeek pairings 3v6, 4v5; seeds 1-2 idle (NO matchup rows for byes).

advanceBracket(input: {
  playoffs: LeagueSettings['playoffs'];
  seeds: readonly SeededTeam[];
  finishedWeek: number;                 // the playoff week just finalized
  results: readonly { homeTeamId, awayTeamId, homePoints, awayPoints }[]; // that week's playoff matchups
}): { ok: true; value: { pairings: BracketPairing[]; championTeamId: string | null } } | { ok: false; error: string }
// Winner: higher points; tie → better seed (decision #3). Byes rejoin in round 2
// (6-team: wk+1 = 1 v worst-surviving, 2 v other; standard fantasy re-pairing is
// FIXED-bracket: 1 plays winner(4v5), 2 plays winner(3v6) — implement FIXED, document).
// Final round result → championTeamId non-null, pairings [].
```

Pure; invariants ≥2 per function (team count sanity, no duplicate teams, seeds contiguous, results cover exactly the expected pairings); bounds MAX_PLAYOFF_TEAMS 8, MAX_ROUNDS 3. Tests must include: 4-team and 6-team full-bracket walkthroughs to a champion; 8-team round 1; tie → higher seed advances; byes get no round-1 rows and correct round-2 pairing; results missing a pairing → error; duplicate team in standings → invariant; 2-team single-final; determinism (same input → same output, standings order is the only order used); settings refine accept/reject boundary cases (teams=teamCount ok, teams>teamCount rejected, teams=5 rejected).

### Task 2: Playoff integration — finalize hook, phase transitions, champion (Opus)

**Files:** migration (`seasons.championTeamId` uuid nullable FK + `matchups.isPlayoff` boolean default false — needed so playoff weeks are distinguishable from any future reg-season length change); `src/server/jobs/scoreWeek.ts` (finalize path hook); `src/server/playoffs/` helpers if split needed.

- Read scoreWeek's existing finalize flow FIRST (how a week becomes `final=true`, where standings are computed). Hook (same tx as finalize): after finalizing week W — (a) if W is the last regular-season week (derive: max scheduled non-playoff matchup week < `playoffs.startWeek`): compute final standings → `generateBracket` → insert round-1 matchups (`isPlayoff=true`, points null) → `seasons.phase='playoffs'`; (b) if W is a playoff week (`isPlayoff` on W's matchups): load that week's final playoff results + seeds (recompute reg-season standings — deterministic per decision #2) → `advanceBracket` → insert next round OR set `championTeamId` + `phase='complete'`. Guarded UPDATEs; idempotency: re-finalizing must not double-insert (existence check + unique indexes already guard team-week pairs).
- scoreWeek must SCORE playoff weeks exactly like regular weeks (verify it already does — matchups are matchups; fix if any reg-season assumption breaks).
- Engine failure in the hook → typed abort, finalize tx rolls back (a bad bracket must not strand a half-final week) — document this choice in code.
- Live verification: dry-run against the real league DB (read-only script): confirm last-regular-week derivation says wk13 and the imported league's `playoffs` config produces a sane hypothetical bracket; confirm actual Sleeper playoff settings for the league match `settings.playoffs` (if they don't, fix the imported settings row NOW and note it).

### Task 3: Bracket UI

**Files:** `src/app/l/[leagueId]/playoffs/page.tsx` (+ components ≤150 each); nav link "Playoffs" (visible always; page self-explains pre-playoffs).

Sections: pre-playoffs (phase='regular'): "Playoffs begin week N — current seeding if the season ended today" (live standings order, bye line for top seeds); active (phase='playoffs'): bracket by round (matchup cards with seeds, scores, winners bolded, byes shown); complete: champion banner + final bracket. Copy notes: fixed bracket, ties → higher seed, no consolation (coming later). Reuse matchup-card styling from the existing matchups page. Empty/degraded states throughout.

### Task 4: Push schema + send helper

**Files:** schema append + migrations (+RLS, house pattern); `src/server/push/sendPush.ts`; `.env.example`.

```ts
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  endpoint: text('endpoint').notNull(),           // unique index
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint),
           index('push_subscriptions_profile_idx').on(t.profileId)]);

export const notificationLog = pgTable('notification_log', {   // dedup ledger (decision #8)
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => profiles.id),
  kind: text('kind', { enum: ['trade_offer', 'trade_result', 'waiver_result', 'lineup_reminder'] }).notNull(),
  dedupeKey: text('dedupe_key').notNull(),        // e.g. `lineup:<teamId>:<season>:<week>`; unique index (kind, dedupeKey)
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`sendPushToProfiles(profileIds, payload {title, body, url}, dedupe?: {kind, key})`: zod-validate payload; if dedupe given, INSERT the log row first — 23505 → skip silently (already sent); load subscriptions bounded (MAX_SUBS_PER_SEND 100); `webpush.sendNotification` per sub, individually try/caught; 404/410 → delete that subscription row; returns counts {sent, failed, pruned}. VAPID from env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) — invariant at first use, `.env.example` documented, generation command in the file comment (`npx web-push generate-vapid-keys`). TDD the pure parts (payload schema, dedupe-key builders — extract as `src/engine/notifications.ts` if any real logic accrues; do NOT unit-test webpush I/O).

### Task 5: PWA shell — manifest, SW, registration, subscribe UI

**Files:** `public/manifest.webmanifest`, `public/sw.js`, `public/icons/*` (generate a simple wordmark set 192/512 + maskable), `src/app/layout.tsx` (manifest link + theme-color via metadata/viewport export), `src/components/PushSubscribe.tsx` (or similar), server actions `subscribePush`/`unsubscribePush` in `src/server/actions/push.ts`, surfaced on the league home or a small `/settings`-adjacent spot (find the natural place; document choice).

- `sw.js`: `push` event → `showNotification(title, {body, data:{url}})`; `notificationclick` → focus-or-open `data.url`; minimal `fetch` no-op handler; a `SW_VERSION` const bumped by convention comment. NO caching logic.
- Registration: client component in the root layout registers `/sw.js` (feature-detected, silent on failure); subscribe UI: permission state machine (default/granted/denied shown honestly), subscribe → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → `subscribePush` action (zod endpoint/keys, upsert on endpoint); unsubscribe mirrors. Buttons follow house Tailwind style; copy explains what you'll be notified about (decision #6 families).
- iOS: installable + push requires iOS 16.4+ and the app added to Home Screen — detect standalone display-mode and surface a hint ("Install: Share → Add to Home Screen") when uninstalled on mobile Safari; keep it one small dismissible banner component.
- Manual verification is on the phone during the walkthrough; in-code verification: `npm run check` + a dev-server smoke (SW registers, manifest served, Lighthouse-installable basics — verify with preview tools, headless is fine).

### Task 6: Notification triggers + lineup-reminder job

**Files:** touchpoints in `src/server/actions/trades.ts` (or a thin `src/server/push/notifyTrades.ts` to keep trades.ts under caps), `src/server/jobs/runWaivers.ts`, new `src/server/jobs/lineupReminders.ts` + route `/api/jobs/lineup-reminders` + dispatch-only workflow (cron commented: `0 * * * *` in-season).

- Trade offer: after `proposeTrade` commits → notify counterparty team's owner (skip unowned). Trade result: after accept-execute/veto/processed-via-review commits → notify the OTHER party (and proposer on veto). All post-commit, fire-and-forget per decision #7; dedupe not needed (one event per transition — the guarded state machine already guarantees single fire).
- Waiver results: at the end of each league's successful run tx (AFTER commit), group decisions by team → one push per owner ("2 claims won, 1 outbid"), dedupe key `waiver:<leagueId>:<transactionId-of-first-claim>` (or run-scoped equivalent — design deterministic, document).
- Lineup reminders per decision #8: job scans in-season leagues (bounded 50): current week via `currentTradeWeek`-family helpers; teams whose saved lineup for that week has an empty STARTER slot (reuse lineup queries; absent lineup row = all slots empty = definitely remind); first unstarted kickoff within 12h; owner has ≥1 subscription; dedupe `lineup:<teamId>:<season>:<week>`. Route POST + CRON_SECRET + optional leagueId (copy run-waivers route). Result counts {leaguesScanned, remindersSent, skipped}.
- NO notification writes inside any money-path tx. Verify by reading each call site (the spec reviewer will).

### Task 7: Lineup seam fix — locked departed player (Phase 7 carry-over)

**Files:** `src/server/actions/lineup.ts` (`loadValidationInputs` in `src/server/lineup/lineupActionQueries.ts`) + engine test.

The bug (from Phase 7 review, chip `task_cb4f5993` — supersede it when this lands): after a mid-week trade/drop of an already-kicked-off player, his preserved current-week slot references a non-member; `validateLineup` returns `not_on_roster`, blocking ALL lineup saves for that team that week. Fix at the INPUT layer (do NOT touch `validateLineup` rules): in `loadValidationInputs`, players occupying CURRENT lineup slots whose NFL team is already locked this week but who are no longer members get injected as synthetic members (status 'active') AND added to `playerNflTeams`, so keeping them is valid and moving them OUT remains lock-blocked (their team is in `lockedNflTeams`). Weeks where they're unlocked stay invalid to keep (cleanup already nulled those). Engine tests: new fixture — departed locked player kept in slot → valid; attempt to move him into a different slot → locked error; departed UNlocked player in a slot → still `not_on_roster` (impossible state post-cleanup, but the rule must hold).

### Task 8: Deploy readiness (code side)

**Files:** `vercel.json` (or per-route `maxDuration` exports — investigate which the project needs on hobby; reconcile the `DEPLOY TODO` in `src/app/api/jobs/reconcile-stats/route.ts`), all six `.github/workflows/*.yml` cron enablement, `docs/deploy.md` (checklist), `.env.example` completeness pass.

- Per-route audit: every `/api/jobs/*` route gets an explicit `maxDuration` justified by a comment (hobby cap 60s; reconcile-stats' TODO says 60 is tight — measure locally with a timed run against the real DB and either accept with evidence or split the job's batching; document the measurement).
- Cron enablement: for each workflow, verify the route no-ops cleanly out of season (offseason/no-current-week → 200 with skipped counts, not 400/500) — fix routes where untrue; then UNCOMMENT the cron lines. Crons live on the default branch only — they activate when this phase merges; note that in each file ("inert until merged + secrets set").
- `docs/deploy.md`: Vercel project setup (envs incl. VAPID + CRON_SECRET + DATABASE_URL pooled), GitHub Actions secrets (`CRON_SECRET`, `APP_BASE_URL`), domain/DNS for MyFFDynasty.app, Supabase auth redirect URLs for production, email deliverability notes (Hotmail junk risk — safe-sender instructions for league mates; DMARC tightening + branded Supabase email template as stretch), and the smoke checklist (login, league pages, one dispatch-run of each job against prod with dry-run where supported).
- Nothing in this task performs the deploy. `npm run check` green; the workflows' cron uncommenting is the deliberate "goes live on merge" switch — call it out in the commit message.

### Final: whole-phase Opus review + walkthroughs + DEPLOY + merge

Review focus: notification fire-and-forget discipline (grep every sendPush call site — none inside a tx, all `void`-ed with why-comments, all failure-isolated); playoff finalize hook atomicity + idempotency (re-run scoreWeek finalize on an already-final week — no double bracket); bracket engine vs integration seam (seeds recomputation determinism); SW/manifest correctness; cron enablement audit (each route's out-of-season behavior verified); no money-path regression (trades/waivers untouched except the trade-notify call sites + Task 7's input-layer fix).

**Walkthrough (user, on the real phone where possible):**
1. FIRST: the pinned Phase 7 two-account walkthrough + ledger verification (prerequisite gate).
2. Phase 8: install the PWA on the phone (both iOS hint path and desktop); subscribe to push on two accounts; propose a trade → counterparty's device gets the offer push; accept+approve → proposer gets the result push; submit dueling waiver claims → process now → both devices get their outcomes; empty a starter slot → dispatch lineup-reminders manually → reminder arrives (12h window mocked by choosing the right week or a temporary dispatch parameter — design for testability); playoffs: on a THROWAWAY test league with a 2-week schedule, run a season to completion via scoreWeek to watch bracket → champion (do NOT touch the real league's matchups).
3. DEPLOY (user-assisted, follows docs/deploy.md): Vercel project + domain + envs, GitHub secrets, merge to master (activates crons), prod smoke: log in on the phone via the real domain, install PWA, receive one real push, dispatch one job against prod.
4. Ledger/DB verification of everything the walkthrough created; then merge --no-ff (if not already merged as part of deploy step ordering — decide at the time: deploy from master post-merge is the default), push, delete branch, update memory.

**Carried forward:** Aug 7 preseason probe (live locks + scoreWeek writes + poll latency + finalize — now exercised against PROD); Phase 9 = migration rehearsal + Week 1 shadow-validation; post-MVP ledger: instant FA, league voting, 3-team trades, consolation bracket, head-to-head tiebreakers, notification preferences, draft rooms (spring 2027); Phase 7 leftovers (b) assertSeasonWeek twin hardening and (c) stuck-`accepted` reconciliation job remain code-comment TODOs.
