# Dynasty Platform MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the AGS analytics hub into a dynasty league hosting platform such that one real 12-team Superflex PPR league runs the full 2026 NFL season natively (spec: `.ouroboros/seed-dynasty-platform.yaml`).

**Architecture:** Next.js 14 App Router stays the whole application (UI + API routes + server actions). Supabase provides Postgres, auth, and (later) realtime for draft rooms; Drizzle ORM defines the schema in TypeScript. League rules are *data*: a zod-validated `LeagueSettings` document drives a pure-function scoring/roster/waiver engine in `src/engine/` that never touches I/O. Scheduled work (waiver runs, stat polling) is HTTP job endpoints triggered by GitHub Actions cron.

**Tech Stack:** Next.js 14, TypeScript strict, Tailwind, Supabase (Postgres + Auth + Realtime), Drizzle ORM, zod, vitest, web-push (VAPID), GitHub Actions cron. Vercel hobby + Supabase free tier = $0/mo.

**Coding rules:** Every task obeys `CODING_STANDARDS.md` (Power of Ten). Engine functions are pure, ≤60 lines, ≥2 runtime checks, bounded loops with named `MAX_*` caps. External data is zod-parsed, never cast. `npm run check` green before every commit.

---

## Locked architecture decisions (the seed deferred these to us)

| Decision | Choice | Why |
|---|---|---|
| Database + auth | **Supabase** (free tier) | One vendor covers Postgres, magic-link + Google auth, and realtime channels we'll need for live draft rooms in 2027. 500MB Postgres is ~100x one league's needs. |
| ORM | **Drizzle** | TypeScript-first schema (no codegen step), tiny runtime, plays well with serverless and with Rule 9 (no magic indirection). |
| Validation | **zod** | Already mandated by Rule 5: parse, don't cast, at every trust boundary. |
| NFL player universe | **Sleeper `/players/nfl`** | Free, already integrated in `src/lib/sleeper.ts`. |
| Weekly/live stats | **Sleeper stats endpoint** (`/stats/nfl/regular/{season}/{week}`), reconciled nightly against **nflverse** weekly CSVs | $0. Sleeper's endpoint is unofficial (TOS gray area — acceptable at passion-project scale, flagged as a risk). nflverse is the independent source of truth for correction. |
| Scheduled jobs | **GitHub Actions cron → `/api/jobs/*` with `CRON_SECRET`** | Vercel hobby cron is limited to daily; Actions gives 5-minute granularity free, which meets "minutes-level lag acceptable". |
| Push notifications | **web-push (VAPID) via PWA service worker** | Free, no vendor; satisfies "PWA that feels native" for 2026. |
| Engine placement | **`src/engine/` pure functions; I/O only in `src/server/`** | Purity makes the money-path (scoring, waivers, legality) unit-testable to the assertion density Rule 5 demands. |

**Two league kinds coexist:** existing analytics pages keep working for *Sleeper-backed* leagues (`/league/<sleeperLeagueId>`); *hosted* leagues live under `/l/<leagueId>` with their own data. The one-time importer converts the former into the latter.

---

## Calendar (today: Jul 6, 2026 → NFL Week 1: ~Sep 10, 2026)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1. Foundation | Jul 6–12 | Supabase + Drizzle + auth + league creation + invites |
| 2. Rosters & config UI | Jul 13–19 | Teams, roster storage, settings editor, league shell |
| 3. Sleeper import | Jul 20–26 | One-time migration: users, rosters, picks, history |
| 4. Stats ingestion | Jul 27–Aug 2 | Player sync, stat lines, nflverse reconciliation |
| 5. Scoring engine | Aug 3–9 | Rules-as-data scoring, matchups, standings |
| 6. Lineups | Aug 10–16 | Lineup setting, legality, lock times |
| **PIVOT GATE** | **Aug 15** | Native scoring trustworthy? If not: hybrid mode for 2026 |
| 7. Transactions | Aug 17–30 | Trades (players + picks), FAAB + priority waivers, commish tools |
| 8. PWA + polish | Aug 31–Sep 6 | Installable PWA, push notifications, playoffs config |
| 9. Migration + dress rehearsal | Sep 7–10 | Real league imported, Week 1 shadow-validated vs Sleeper |
| 10. Draft rooms | Post-season | Slow + live drafts before spring 2027 rookie draft |

Phases 2–10 each get their own `docs/plans/` file (written with superpowers:writing-plans) when they start. **This document fully details Phase 1** and scopes the rest, so no plan ever outgrows a context window.

---

# Phase 1: Foundation (fully detailed)

Prerequisite (human, one-time): create a Supabase project at supabase.com (free tier), then fill `.env.local` with the values Task 1 adds to `.env.example`. Enable Google as an auth provider in the Supabase dashboard (optional until Task 5).

### Task 1: Dependencies, env, and Drizzle wiring

**Files:**
- Modify: `package.json` (deps + `db:*` scripts)
- Create: `drizzle.config.ts`
- Create: `src/server/db.ts`
- Modify: `.env.example`

**Step 1: Install dependencies**

```bash
npm install drizzle-orm postgres zod @supabase/supabase-js @supabase/ssr web-push
npm install -D drizzle-kit @types/web-push
```

**Step 2: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/server/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Direct (non-pooled) connection string; only used by drizzle-kit locally.
    url: process.env.DATABASE_URL ?? '',
  },
});
```

**Step 3: Create `src/server/db.ts`** (server-only singleton, const holder per Rule 3/6)

```ts
import 'server-only';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { invariant } from '@/lib/invariant';
import * as schema from './schema';

const clientHolder: { value: ReturnType<typeof buildDb> | null } = { value: null };

function buildDb() {
  const url = process.env.DATABASE_URL;
  invariant(typeof url === 'string' && url.length > 0, 'DATABASE_URL is not set');
  // max: 1 — serverless functions must not hoard pooled connections.
  return drizzle(postgres(url, { max: 1, prepare: false }), { schema });
}

export function getDb() {
  if (!clientHolder.value) {
    clientHolder.value = buildDb();
  }
  return clientHolder.value;
}
```

**Step 4: Extend `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=            # Supabase "Transaction pooler" connection string
CRON_SECRET=             # random string; GitHub Actions sends it as Authorization: Bearer
```

**Step 5: Add scripts to `package.json`**

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

**Step 6: Verify** — Run: `npm run check`. Expected: green (nothing imports the new modules yet; `src/server/schema.ts` arrives in Task 3, so create it as an empty `export {}` placeholder if tsc complains).

**Step 7: Commit** — `git commit -m "feat: add Drizzle, Supabase, zod foundation deps and db client"`

---

### Task 2: LeagueSettings schema — league rules as data

The heart of the MFL-grade config engine. Pure zod, no I/O. TDD.

**Files:**
- Create: `src/engine/settings.ts`
- Test: `src/engine/__tests__/settings.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  LeagueSettingsSchema,
  DEFAULT_SUPERFLEX_PPR,
  starterSlotCount,
} from '../settings';

describe('LeagueSettingsSchema', () => {
  it('accepts the default 12-team Superflex PPR preset', () => {
    const parsed = LeagueSettingsSchema.safeParse(DEFAULT_SUPERFLEX_PPR);
    expect(parsed.success).toBe(true);
  });

  it('rejects a roster with zero starter slots', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      rosterSlots: [{ slot: 'BENCH', count: 20 }],
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown scoring stat keys', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      scoring: { rules: { not_a_stat: 1 }, bonuses: [] },
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects future pick trading beyond 3 years', () => {
    const bad = {
      ...DEFAULT_SUPERFLEX_PPR,
      trades: { ...DEFAULT_SUPERFLEX_PPR.trades, futurePickYears: 4 },
    };
    expect(LeagueSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('counts starter slots (excludes BENCH/TAXI/IR)', () => {
    expect(starterSlotCount(DEFAULT_SUPERFLEX_PPR.rosterSlots)).toBe(10);
  });
});
```

**Step 2: Run** `npm test -- settings` — Expected: FAIL (module not found).

**Step 3: Implement `src/engine/settings.ts`**

```ts
import { z } from 'zod';

// Stat keys follow Sleeper's naming so imported scoring settings map 1:1.
export const SCORING_STAT_KEYS = [
  'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost', 'bonus_rec_te',
  // extend deliberately; unknown keys are rejected, not ignored
] as const;

export const ROSTER_SLOTS = [
  'QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
  'BENCH', 'TAXI', 'IR',
] as const;
export type RosterSlot = (typeof ROSTER_SLOTS)[number];

const NON_STARTER_SLOTS: readonly RosterSlot[] = ['BENCH', 'TAXI', 'IR'];
const MAX_SLOT_COUNT = 40;

const RosterSlotEntry = z.object({
  slot: z.enum(ROSTER_SLOTS),
  count: z.number().int().min(0).max(MAX_SLOT_COUNT),
});

const Bonus = z.object({
  stat: z.enum(SCORING_STAT_KEYS),
  threshold: z.number().positive(),
  points: z.number().finite(),
});

const Scoring = z.object({
  rules: z.record(z.enum(SCORING_STAT_KEYS), z.number().finite()),
  bonuses: z.array(Bonus).max(50),
});

const Waivers = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('faab'),
    budget: z.number().int().positive().max(10_000),
    tiebreaker: z.enum(['reverse_standings', 'rolling']),
  }),
  z.object({
    mode: z.literal('priority'),
    order: z.enum(['reverse_standings', 'rolling']),
  }),
]);

const Trades = z.object({
  reviewMode: z.enum(['none', 'commissioner', 'league_vote']),
  futurePickYears: z.number().int().min(0).max(3),
  deadlineWeek: z.number().int().min(1).max(18).nullable(),
});

const Playoffs = z.object({
  teams: z.number().int().min(2).max(16),
  startWeek: z.number().int().min(14).max(17),
});

export const LeagueSettingsSchema = z
  .object({
    teamCount: z.number().int().min(4).max(32),
    rosterSlots: z.array(RosterSlotEntry).max(ROSTER_SLOTS.length),
    scoring: Scoring,
    waivers: Waivers,
    trades: Trades,
    playoffs: Playoffs,
  })
  .refine((s) => starterSlotCount(s.rosterSlots) > 0, {
    message: 'League must have at least one starter slot',
  });

export type LeagueSettings = z.infer<typeof LeagueSettingsSchema>;
export type RosterSlotEntryT = z.infer<typeof RosterSlotEntry>;

export function starterSlotCount(slots: readonly RosterSlotEntryT[]): number {
  let total = 0;
  for (const entry of slots) {
    if (!NON_STARTER_SLOTS.includes(entry.slot)) {
      total += entry.count;
    }
  }
  return total;
}

export const DEFAULT_SUPERFLEX_PPR: LeagueSettings = {
  teamCount: 12,
  rosterSlots: [
    { slot: 'QB', count: 1 },
    { slot: 'RB', count: 2 },
    { slot: 'WR', count: 3 },
    { slot: 'TE', count: 1 },
    { slot: 'FLEX', count: 2 },
    { slot: 'SUPER_FLEX', count: 1 },
    { slot: 'BENCH', count: 15 },
    { slot: 'TAXI', count: 4 },
    { slot: 'IR', count: 3 },
  ],
  scoring: {
    rules: {
      pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
      rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
      rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
      fum_lost: -2,
    },
    bonuses: [],
  },
  waivers: { mode: 'faab', budget: 100, tiebreaker: 'reverse_standings' },
  trades: { reviewMode: 'none', futurePickYears: 3, deadlineWeek: null },
  playoffs: { teams: 6, startWeek: 15 },
};
```

**Step 4: Run** `npm test -- settings` — Expected: PASS (5 tests).
**Step 5: Run** `npm run check` — Expected: green.
**Step 6: Commit** — `git commit -m "feat: LeagueSettings zod schema — league rules as data"`

---

### Task 3: Core database schema + first migration

**Files:**
- Create: `src/server/schema.ts`
- Create: `drizzle/` (generated migration)

**Step 1: Write `src/server/schema.ts`**

```ts
import {
  pgTable, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex,
} from 'drizzle-orm/pg-core';

// Mirrors Supabase auth.users (1:1); rows created by a claim/signup action.
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // = auth.users.id
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status', { enum: ['setup', 'active', 'archived'] }).notNull().default('setup'),
  createdBy: uuid('created_by').notNull().references(() => profiles.id),
  sleeperLeagueId: text('sleeper_league_id'), // set when imported
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  year: integer('year').notNull(),
  phase: text('phase', {
    enum: ['offseason', 'regular', 'playoffs', 'complete'],
  }).notNull().default('offseason'),
  currentWeek: integer('current_week').notNull().default(0),
  // zod-validated LeagueSettings document; parse on every read (Rule 5).
  settings: jsonb('settings').notNull(),
}, (t) => ({
  oneSeasonPerYear: uniqueIndex('seasons_league_year_uq').on(t.leagueId, t.year),
}));

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').references(() => profiles.id), // null until claimed
  inviteToken: text('invite_token'), // single-use claim token
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 2: Generate + apply migration**

Run: `npm run db:generate` then `npm run db:migrate`
Expected: migration SQL in `drizzle/`, applied against Supabase without error.

**Step 3: Enable RLS (Supabase SQL editor or migration):** `alter table profiles enable row level security;` etc. for all four tables, with a policy allowing service-role access only — app access goes through server code, not client-side Postgrest. (Client reads come later, deliberately.)

**Step 4: Run** `npm run check` — Expected: green.
**Step 5: Commit** — `git commit -m "feat: core schema — profiles, leagues, seasons, teams"`

---### Task 4: Auth wiring (Supabase magic link + Google)

**Files:**
- Create: `src/server/supabase.ts` (server client helper using `@supabase/ssr` cookies)
- Create: `src/app/login/page.tsx` (email input → magic link; Google button)
- Create: `src/app/auth/callback/route.ts` (code exchange, profile upsert)
- Create: `src/middleware.ts` (session refresh; `/l/*` requires session)

**Steps (abbreviated — this is glue, not logic):** follow the `@supabase/ssr` App Router recipe; the one *logic* piece is profile upsert on first login (display name from email prefix) — write a unit test for the pure `displayNameFromEmail(email)` helper first (TDD), e.g. `"jtyree2@gmail.com" → "jtyree2"`, rejecting empty results. Manual verification: `npm run dev`, log in via magic link, confirm `profiles` row exists. Commit: `"feat: Supabase auth with magic links and profile upsert"`.

---

### Task 5: League creation (server action) + invite claim flow

**Files:**
- Create: `src/server/actions/createLeague.ts`
- Create: `src/engine/invites.ts` + test (pure token helpers)
- Create: `src/app/l/new/page.tsx` (form: name, preset settings)
- Create: `src/app/join/[token]/page.tsx` + claim action
- Test: `src/engine/__tests__/invites.test.ts`

**TDD the pure parts** (`src/engine/invites.ts`): `generateInviteToken()` (crypto.randomUUID-based, 32+ chars), `canClaimTeam(team, userId)` → typed result `{ ok: true } | { ok: false; error: string }` covering: already-owned team, user already owns a team in this league, missing token. Then the server action: `createLeague(name, settings)` validates with `LeagueSettingsSchema.parse`, inserts league + season (year 2026) + `settings.teamCount` teams each with an invite token, inside one transaction. Claim action assigns `ownerId`, nulls the token. Manual verification: create league, open invite URL in incognito, claim a team. Commit each half separately.

---

### Task 6: League shell UI

**Files:**
- Create: `src/app/l/[leagueId]/layout.tsx` (nav: Home, Roster, Matchups, Trades, Waivers, Settings — reuse `Navigation.tsx` patterns)
- Create: `src/app/l/[leagueId]/page.tsx` (teams, claim status, settings summary)
- Create: `src/app/l/page.tsx` ("my leagues" — hosted leagues for the signed-in user; link to analytics leagues at `/league/*`)

Server components; data via `getDb()`; every query has an explicit `LIMIT`. Verify: `npm run check`, manual walkthrough. Commit: `"feat: hosted league shell and my-leagues page"`.

**Phase 1 exit criteria (maps to seed acceptance criteria 1–2):** a commissioner can create a hosted league with validated Superflex PPR settings, send 12 invite links, and members can claim teams — all behind auth, all green under `npm run check`.

---

# Phases 2–10 (scoped; each gets its own detailed plan at phase start)

### Phase 2: Rosters & config UI (Jul 13–19)
Tables: `players` (Sleeper universe, synced daily), `rosterMembers` (team ↔ player, status: active/taxi/IR). Settings editor UI covering every `LeagueSettingsSchema` field (the "MFL-grade" surface). Engine: `validateRosterCounts(settings, roster)` pure + tested. Job endpoint `/api/jobs/sync-players` + GitHub Actions workflow (daily) — reuses `getAllPlayers()` from `src/lib/sleeper.ts`.

### Phase 3: Sleeper one-time import (Jul 20–26)
`src/server/import/sleeper.ts`: given a Sleeper league ID → creates hosted league with translated settings (Sleeper scoring keys → ours — they match by design, Task 2), teams (owner emails entered by commissioner → invites), rosters, **traded future picks** (`pickAssets` table: year/round/originalTeam/currentTeam), and read-only history snapshots (reuse existing analytics fetchers). Import is idempotent behind a dry-run report the commissioner confirms. Engine tests on the pure translation functions with fixture JSON from the real league. *This is the module with the most fixture-driven TDD.*

### Phase 4: Stats ingestion (Jul 27–Aug 2)
Tables: `statLines` (playerId, season, week, stats jsonb, source, updatedAt). Job `/api/jobs/poll-stats` (every 5 min during game windows; bounded batch sizes) parsing Sleeper stats with zod; nightly `/api/jobs/reconcile-stats` pulls nflverse weekly CSV and writes corrections (source='nflverse' wins). Pure diff/merge functions TDD'd. Risk watch: if the Sleeper stats endpoint proves unstable, fallback order is nflverse-nightly-only (degrades to next-day scoring — still within seed tolerance if flagged to the league).

### Phase 5: Scoring engine (Aug 3–9)
The money path. `src/engine/scoring.ts`: `scoreStatLine(rules, bonuses, stats) → points` (pure, exhaustive tests incl. bonuses/thresholds/negative stats); `scoreLineup(settings, lineup, statLines)`; matchup + standings computation (reuse `seasonStats.ts` patterns for luck/all-play later). `matchups` table + schedule generator (round-robin with bounded loops). Golden-file test: score a real 2025 Sleeper week for your league from fixtures and match Sleeper's totals to the point.

### Phase 6: Lineups (Aug 10–16)
`lineups` table (teamId, week, slot assignments). Engine: `validateLineup(settings, roster, lineup, week)` — position eligibility incl. FLEX/SUPER_FLEX matrices, locked-player rules (game start times from schedule data), taxi/IR ineligibility. UI: lineup screen (mobile-first — this is the most-used page in the product). **Aug 15 PIVOT GATE:** golden-file scoring + lineup validation must be trustworthy; otherwise 2026 runs hybrid (Sleeper hosts, we mirror) per seed exit condition.

### Phase 7: Transactions (Aug 17–30)
`transactions` table with typed jsonb payloads (zod discriminated union: trade/waiver_claim/free_agent/commish). Trades: multi-asset (players + pick assets), review modes, accept/reject/counter UX. Waivers: engine `resolveWaiverRun(settings, claims, standings) → awarded/rejected` pure + heavily tested for both FAAB (budget, tiebreakers) and priority modes; job `/api/jobs/run-waivers` on the league's schedule. Commissioner tools: force-add/drop, edit lineup, reverse transaction — each an audited `commish` transaction.

### Phase 8: PWA + notifications + playoffs (Aug 31–Sep 6)
`next-pwa`-style manifest + service worker, install prompts, web-push subscriptions table + send helper; notify on: lineup deadline with empty slot, trade offer, waiver results. Playoff bracket generation from `settings.playoffs` + seed tiebreakers (engine, tested).

### Phase 9: Migration + dress rehearsal (Sep 7–10)
Run the real import against your league. Shadow-score Week 1: compare our live scores vs Sleeper hourly (script + report). League members installed the PWA and set Week 1 lineups. Success = seed acceptance criteria demonstrably working.

### Phase 10: Draft rooms (post-season, before spring 2027)
Slow drafts (pick clock in hours, push-notified) then live rooms on Supabase Realtime channels; mid-draft pick trading. Deliberately after the season — first real usage is the 2027 rookie draft.

---

## Standing risks

0. **Email deliverability on Microsoft inboxes** (observed Jul 6): magic links from
   mail.myffdynasty.app land in Hotmail/Outlook Junk — new domain, no reputation.
   Phase 9 migration instructions must tell members to check Junk and safe-sender
   the domain; consider DMARC tightening + branded templates in Phase 8.

1. **Sleeper stats endpoint is unofficial** — mitigated by nflverse reconciliation + Phase 4 fallback; worst case is next-day scoring, allowed by the seed.
2. **Solo-dev bus factor during the season** — mitigate by boring infra (managed everything), `npm run check` discipline, and the Phase 9 shadow-validation habit continuing through September.
3. **Free-tier limits** (Supabase pauses inactive projects; Actions cron jitter) — acceptable at one-league scale; revisit if outside leagues join (seed says growth is non-goal for 2026).
