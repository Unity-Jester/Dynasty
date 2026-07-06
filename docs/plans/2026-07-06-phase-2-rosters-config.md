# Phase 2: Rosters & Config UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give hosted leagues a real player universe (synced daily from Sleeper), roster storage with the one-player-per-league invariant enforced at the DB layer, a pure roster-shape validator, and the full MFL-grade settings editor.

**Architecture:** Same shape as Phase 1 — pure logic in `src/engine/` (TDD, typed results), I/O in `src/server/` (bounded queries, zod at boundaries), UI as server components with small client islands. New pattern this phase: scheduled jobs as `POST /api/jobs/*` route handlers authenticated by `CRON_SECRET`, triggered by GitHub Actions cron (workflow ships now, activates when the app deploys; until then jobs run via local curl).

**Tech Stack:** Existing Phase 1 stack (Next.js 14, Drizzle/Supabase, zod, vitest). No new dependencies. Reuses `getAllPlayers()` from `src/lib/sleeper.ts` (24h-TTL cached fetch of Sleeper's ~11k-player map).

**Coding rules:** `CODING_STANDARDS.md` is mandatory (Power of Ten). Every loop over external data gets a named `MAX_*` cap. Parse Sleeper data with zod — the existing `SleeperPlayer` interface in `src/lib/types.ts` is a *type assertion*, not a validation; engine code must not trust it (Rule 5).

**Prior context an implementer needs:** `src/server/schema.ts` (profiles/leagues/seasons/teams), `src/engine/settings.ts` (`LeagueSettingsSchema`, `LeagueSettings`, `RosterSlot`, `starterSlotCount`), `src/server/actions/leagues.ts` (the typed-result server-action idiom — copy it), `src/app/l/[leagueId]/` (shell UI conventions), `.env.local` has a live `DATABASE_URL` + `CRON_SECRET`. Migration workflow: edit `src/server/schema.ts` → `npm run db:generate` → `set -a && source .env.local && set +a && npm run db:migrate`.

**Settings-edit policy (decided now, enforce in Task 7):** settings are freely editable by the league creator while `seasons.phase = 'offseason'`. Any other phase → the action refuses (`error: 'season_locked'`). Mid-season rule changes are a Phase 5+ concern (they interact with scoring recomputes); do not build them.

---

## Calendar note

Planned window Jul 13–19; starting ~1 week early. Slack accrues to Phase 5 (scoring), which gates the Aug 15 pivot decision.

## Task tiering (for the subagent-driven controller)

| Task | Implementer | Spec review | Notes |
|---|---|---|---|
| 1. players schema | sonnet | self (controller) | declarative transcription |
| 2. player sync engine | sonnet | sonnet | zod + mapping logic |
| 3. sync job route + workflow | sonnet | sonnet | auth boundary — review the secret check |
| 4. rosterMembers schema | sonnet | self (controller) | one new invariant index |
| 5. validateRosterCounts engine | sonnet | sonnet | pure money-path logic |
| 6. roster page (read-only) | sonnet | haiku | display only |
| 7. settings editor | **opus** | sonnet | biggest logic+UI surface, edit-lock policy |
| Final whole-phase review | **opus** | — | integration seams + exit criteria |

---

### Task 1: `players` table

**Files:**
- Modify: `src/server/schema.ts` (append)
- Create: `drizzle/` migration (generated)

**Step 1: Append to `src/server/schema.ts`:**

```ts
// NFL player universe, synced daily from Sleeper (/api/jobs/sync-players).
// sleeper_id is the natural PK — it's the join key for stats, rosters, and
// the Phase 3 importer alike.
export const players = pgTable('players', {
  sleeperId: text('sleeper_id').primaryKey(),
  fullName: text('full_name').notNull(),
  position: text('position').notNull(), // QB/RB/WR/TE/K/DEF — filtered at sync time
  nflTeam: text('nfl_team'), // null = free agent
  status: text('status').notNull().default('unknown'), // Active/Injured Reserve/...
  injuryStatus: text('injury_status'),
  yearsExp: integer('years_exp'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('players_position_idx').on(t.position),
]);
```

(`index` joins the existing `pgTable` imports from `drizzle-orm/pg-core`.)

**Step 2:** `npm run db:generate` → read the SQL (1 table, 1 index) → `set -a && source .env.local && set +a && npm run db:migrate`.

**Step 3:** `npm run check` green (schema is declarative; no new tests).

**Step 4: Commit** — `feat(db): players table for the synced NFL universe`

---

### Task 2: Player sync engine (pure, STRICT TDD)

**Files:**
- Create: `src/engine/playerSync.ts`
- Test: `src/engine/__tests__/playerSync.test.ts`

The engine half of the sync job: parse Sleeper's raw map (zod — do NOT trust the `SleeperPlayer` interface), filter to rosterable positions, map to row shape. The route handler (Task 3) owns all I/O.

**Step 1: Write the failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { mapSleeperPlayers, ROSTERABLE_POSITIONS } from '../playerSync';

const raw = {
  '4034': {
    player_id: '4034', full_name: 'Christian McCaffrey', position: 'RB',
    team: 'SF', status: 'Active', injury_status: null, years_exp: 9,
  },
  DEF_SF: {
    player_id: 'SF', full_name: 'San Francisco 49ers', position: 'DEF',
    team: 'SF', status: 'Active', injury_status: null, years_exp: 0,
  },
  '9999': {
    player_id: '9999', full_name: 'Some Longsnapper', position: 'LS',
    team: 'KC', status: 'Active', injury_status: null, years_exp: 3,
  },
  bad_row: { player_id: 'bad_row', position: 'QB' }, // missing required fields
};

describe('mapSleeperPlayers', () => {
  it('maps valid rosterable players to row shape', () => {
    const result = mapSleeperPlayers(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cmc = result.value.rows.find((r) => r.sleeperId === '4034');
    expect(cmc).toEqual({
      sleeperId: '4034', fullName: 'Christian McCaffrey', position: 'RB',
      nflTeam: 'SF', status: 'Active', injuryStatus: null, yearsExp: 9,
    });
  });

  it('keeps team DEF entries and drops non-rosterable positions (LS)', () => {
    const result = mapSleeperPlayers(raw);
    if (!result.ok) throw new Error('expected ok');
    const positions = result.value.rows.map((r) => r.position);
    expect(positions).toContain('DEF');
    expect(positions).not.toContain('LS');
  });

  it('counts and skips rows that fail validation instead of failing the sync', () => {
    const result = mapSleeperPlayers(raw);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.skipped).toBe(1); // bad_row
    expect(result.value.rows).toHaveLength(2); // CMC + DEF (LS filtered is not "skipped")
  });

  it('errs when the map exceeds MAX_SLEEPER_PLAYERS (bounded input)', () => {
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 30_001; i++) huge[`p${i}`] = raw['4034'];
    const result = mapSleeperPlayers(huge);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    expect(mapSleeperPlayers('nope').ok).toBe(false);
  });
});
```

**Step 2:** `npm test -- playerSync` → FAIL (module not found).

**Step 3: Implement `src/engine/playerSync.ts`:**

```ts
import { z } from 'zod';

export const ROSTERABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const MAX_SLEEPER_PLAYERS = 30_000; // Sleeper's map is ~11k; 30k = something is wrong

// Validate only the fields we persist — Sleeper's rows carry ~40 others.
const RawPlayer = z.object({
  player_id: z.string().min(1),
  full_name: z.string().min(1),
  position: z.string().min(1),
  team: z.string().nullish(),
  status: z.string().nullish(),
  injury_status: z.string().nullish(),
  years_exp: z.number().int().nullish(),
});

export interface PlayerRow {
  sleeperId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  status: string;
  injuryStatus: string | null;
  yearsExp: number | null;
}

export type MapResult =
  | { ok: true; value: { rows: PlayerRow[]; skipped: number } }
  | { ok: false; error: string };

export function mapSleeperPlayers(input: unknown): MapResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'players payload is not an object' };
  }
  const entries = Object.values(input);
  if (entries.length > MAX_SLEEPER_PLAYERS) {
    return { ok: false, error: `players payload exceeds MAX_SLEEPER_PLAYERS (${entries.length})` };
  }

  const rows: PlayerRow[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const parsed = RawPlayer.safeParse(entry);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const p = parsed.data;
    if (!(ROSTERABLE_POSITIONS as readonly string[]).includes(p.position)) {
      continue; // non-rosterable position: filtered by design, not an anomaly
    }
    rows.push({
      sleeperId: p.player_id,
      fullName: p.full_name,
      position: p.position,
      nflTeam: p.team ?? null,
      status: p.status ?? 'unknown',
      injuryStatus: p.injury_status ?? null,
      yearsExp: p.years_exp ?? null,
    });
  }
  return { ok: true, value: { rows, skipped } };
}
```

**Step 4:** `npm test -- playerSync` → 5 PASS. **Step 5:** `npm run check` green. **Step 6: Commit** — `feat(engine): Sleeper player map parser/filter for daily sync`

---

### Task 3: Sync job route + GitHub Actions workflow

**Files:**
- Create: `src/app/api/jobs/sync-players/route.ts`
- Create: `src/server/jobs/syncPlayers.ts`
- Create: `.github/workflows/sync-players.yml`
- Modify: `.env.example` (comment on CRON_SECRET usage, if not already clear)

**`src/server/jobs/syncPlayers.ts`** — the I/O half: calls `getAllPlayers()` (from `@/lib/sleeper`), runs `mapSleeperPlayers`, upserts in batches:

```ts
import 'server-only';
import { getDb } from '@/server/db';
import { players } from '@/server/schema';
import { getAllPlayers } from '@/lib/sleeper';
import { mapSleeperPlayers } from '@/engine/playerSync';
import { sql } from 'drizzle-orm';

const BATCH_SIZE = 500;
const MAX_BATCHES = 60; // 30k cap / 500 — matches MAX_SLEEPER_PLAYERS

export type SyncResult =
  | { ok: true; upserted: number; skipped: number }
  | { ok: false; error: string };

export async function syncPlayers(): Promise<SyncResult> {
  const raw = await getAllPlayers();
  const mapped = mapSleeperPlayers(raw);
  if (!mapped.ok) {
    return { ok: false, error: mapped.error };
  }
  const db = getDb();
  const { rows, skipped } = mapped.value;
  let upserted = 0;
  for (let batch = 0; batch < MAX_BATCHES && batch * BATCH_SIZE < rows.length; batch++) {
    const chunk = rows.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
    await db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.sleeperId,
        set: {
          fullName: sql`excluded.full_name`,
          position: sql`excluded.position`,
          nflTeam: sql`excluded.nfl_team`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          yearsExp: sql`excluded.years_exp`,
          updatedAt: sql`now()`,
        },
      });
    upserted += chunk.length;
  }
  return { ok: true, upserted, skipped };
}
```

**`src/app/api/jobs/sync-players/route.ts`** — POST only; constant-shape auth check:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { invariant } from '@/lib/invariant';
import { syncPlayers } from '@/server/jobs/syncPlayers';

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  invariant(typeof secret === 'string' && secret.length >= 32, 'CRON_SECRET not configured');
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await syncPlayers();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ upserted: result.upserted, skipped: result.skipped });
}
```

Set `export const maxDuration = 60;` (Vercel hobby allows 60s; ~22 batches of 500 fits comfortably).

**`.github/workflows/sync-players.yml`:**

```yaml
name: sync-players
on:
  schedule:
    - cron: '0 9 * * *' # daily, 09:00 UTC (~4am ET)
  workflow_dispatch: {}
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger player sync
        run: |
          curl --fail-with-body -sS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/jobs/sync-players"
```

Note in the workflow file: requires `APP_URL` + `CRON_SECRET` repo secrets; inert until the app deploys (Phase 8/9); until then run locally.

**Verification (live, local):**
```bash
set -a && source .env.local && set +a
npm run dev &   # or use the running preview server
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/sync-players
# expect: {"upserted":<about 2000-3000 after position filtering>,"skipped":<small>}
curl -s -X POST http://localhost:3000/api/jobs/sync-players   # expect 401
```
Then a read-only row count against the DB to confirm persistence. `npm run check` green.

**Commit** — `feat(jobs): daily player sync endpoint + Actions cron`

---

### Task 4: `rosterMembers` table with the one-player-per-league invariant

**Files:**
- Modify: `src/server/schema.ts` (append)
- Create: generated migration

**Step 1: Append:**

```ts
// A player's membership on a team. leagueId is deliberately denormalized from
// teams so the DB itself can enforce "one player per league" — the same
// index-as-invariant pattern as teams_league_owner_uq.
export const rosterMembers = pgTable('roster_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  playerId: text('player_id').notNull().references(() => players.sleeperId),
  status: text('status', { enum: ['active', 'taxi', 'ir'] }).notNull().default('active'),
  acquiredVia: text('acquired_via', {
    enum: ['import', 'draft', 'waiver', 'free_agent', 'trade', 'commish'],
  }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('roster_members_league_player_uq').on(t.leagueId, t.playerId),
  index('roster_members_team_idx').on(t.teamId),
]);
```

**Step 2:** generate + read SQL (FKs, unique index on (league_id, player_id), team index) + migrate live.
**Step 3:** `npm run check`; **Commit** — `feat(db): roster membership with one-player-per-league enforced by index`

---

### Task 5: `validateRosterCounts` engine (pure, STRICT TDD)

**Files:**
- Create: `src/engine/roster.ts`
- Test: `src/engine/__tests__/roster.test.ts`

Validates a team's roster *shape* against `LeagueSettings.rosterSlots` (lineup legality is Phase 6; this guards add/drop/import). Semantics:
- Total capacity = sum of ALL slot counts (starters + BENCH + TAXI + IR).
- `taxi`-status members ≤ TAXI count; `ir`-status members ≤ IR count.
- `active`-status members ≤ capacity − TAXI count − IR count (bench+starters pool).
- Returns `{ ok: true } | { ok: false; error: 'over_capacity' | 'taxi_full' | 'ir_full'; detail: string }` (first violation in that precedence order).
- ≥2 invariants: rosterSlots non-empty (settings already schema-validated upstream — invariant, not zod), member statuses are the known enum.

**Step 1 tests** (use `DEFAULT_SUPERFLEX_PPR`: capacity 32 = 10 starters + 15 bench + 4 taxi + 3 ir):

```ts
import { describe, it, expect } from 'vitest';
import { validateRosterCounts } from '../roster';
import { DEFAULT_SUPERFLEX_PPR } from '../settings';

const members = (active: number, taxi: number, ir: number) => [
  ...Array.from({ length: active }, (_, i) => ({ playerId: `a${i}`, status: 'active' as const })),
  ...Array.from({ length: taxi }, (_, i) => ({ playerId: `t${i}`, status: 'taxi' as const })),
  ...Array.from({ length: ir }, (_, i) => ({ playerId: `i${i}`, status: 'ir' as const })),
];

describe('validateRosterCounts', () => {
  it('accepts a full legal roster (25 active, 4 taxi, 3 ir)', () => {
    expect(validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(25, 4, 3)).ok).toBe(true);
  });
  it('rejects a 26th active player as over the active pool', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(26, 0, 0));
    expect(r).toMatchObject({ ok: false, error: 'over_capacity' });
  });
  it('rejects a 5th taxi member', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(10, 5, 0));
    expect(r).toMatchObject({ ok: false, error: 'taxi_full' });
  });
  it('rejects a 4th IR member', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(10, 0, 4));
    expect(r).toMatchObject({ ok: false, error: 'ir_full' });
  });
  it('accepts an empty roster', () => {
    expect(validateRosterCounts(DEFAULT_SUPERFLEX_PPR, []).ok).toBe(true);
  });
  it('precedence: over_capacity reported before taxi_full when both violated', () => {
    const r = validateRosterCounts(DEFAULT_SUPERFLEX_PPR, members(30, 6, 0));
    expect(r).toMatchObject({ ok: false, error: 'over_capacity' });
  });
});
```

**Steps 2–5:** red → implement (pure function, single bounded loop tallying statuses, precedence checks in order) → green → `npm run check` → **Commit** — `feat(engine): roster shape validation against league slot config`

---

### Task 6: Roster page (read-only)

**Files:**
- Create: `src/app/l/[leagueId]/roster/[teamId]/page.tsx` (+ small components as needed)
- Modify: `src/app/l/[leagueId]/LeagueNav.tsx` (no new top-level link; rosters reached from team cards)
- Modify: `src/app/l/[leagueId]/TeamsGrid.tsx` (team cards link to the roster page)

Server component: validate both route params as UUIDs (teamId) → notFound() on invalid/missing/mismatched league; fetch team (limit 1), roster members joined to players (limit 60, `MAX_ROSTER_DISPLAY`), group by status (active/taxi/ir), render grouped tables (player name, position, NFL team, injury tag). Empty state: "No players yet — rosters fill via import (Phase 3)". No mutations this phase.

Verify: `npm run check`; `npm run build`; curl the page logged-out → 307 to `/login?next=...` (regression-checks the Phase 1 middleware fix).
**Commit** — `feat: read-only team roster page grouped by active/taxi/IR`

---

### Task 7: Settings editor (the MFL-grade surface) — Opus task

**Files:**
- Create: `src/server/actions/settings.ts`
- Create: `src/app/l/[leagueId]/settings/page.tsx`
- Create: `src/app/l/[leagueId]/settings/SettingsEditor.tsx` (client; split into per-section components, each ≤150 lines: `RosterSlotsSection.tsx`, `ScoringSection.tsx`, `WaiversSection.tsx`, `TradesSection.tsx`, `PlayoffsSection.tsx`)
- Test: `src/engine/__tests__/settings.test.ts` — only if schema gaps surface; the schema itself does not change this phase.

**Server action `updateLeagueSettings(input: unknown)`** (copy the Task-5-Phase-1 idiom):
- zod-parse `{ leagueId: uuid, settings: LeagueSettingsSchema }` — the FULL document is submitted and re-validated every save (no patching).
- Auth → `unauthenticated`; not creator → `not_creator`; league missing → `not_found`.
- Current season `phase !== 'offseason'` → `season_locked`.
- Extra cross-check (server-side, beyond schema): `settings.teamCount` must equal the league's actual team row count → `team_count_mismatch` (team add/remove is not in scope; the editor shows teamCount read-only).
- Single UPDATE of `seasons.settings` (guarded `WHERE season.id = ? AND phase = 'offseason'`, row-count checked — same race pattern as claims).
- Typed result union; UI maps errors to friendly text.

**Editor UI:** server page fetches league+season+settings (creator check → non-creators get the read-only `SettingsSummary` view, reusing the Phase 1 component, expanded if trivial). Client editor: form state initialized from current settings; per-section fieldsets; single "Save settings" submit; zod errors from the action rendered inline at top. Scoring section renders one number input per `SCORING_STAT_KEYS` entry plus an add/remove list for bonuses (stat select, threshold, points — max 50 per schema). Roster slots: count steppers per slot type with live starter-count and total-capacity readouts (`starterSlotCount`). Waivers: FAAB/priority mode radio revealing mode-specific fields. **No new dependencies — plain controlled inputs.**

Verify: `npm run check`; `npm run build`; live: edit a value in the browser (preview server), save, reload, confirm persisted; attempt save as non-creator (incognito second account) → refused.
**Commits** — `feat(actions): season-locked league settings update` then `feat: MFL-grade settings editor UI`

---

### Final: whole-phase Opus review + merge

Same protocol as Phase 1: branch `phase-2-rosters-config` off master, review `master...HEAD` for integration seams (does the roster page handle a league whose players were never synced? does the settings editor's teamCount cross-check match createLeague's behavior? does the sync job's position filter align with `ROSTER_SLOTS` in settings.ts?), exit criteria below, then merge on user confirmation after a live walkthrough.

**Phase 2 exit criteria:**
- `players` table holds the synced Sleeper universe (~2–3k rosterable players) and the job endpoint refuses unauthenticated calls.
- `roster_members` exists with the league-player unique index live.
- `validateRosterCounts` fully tested (it gains its first caller in Phase 3's importer).
- The league creator can edit every `LeagueSettingsSchema` field in the UI during the offseason, non-creators can't, and in-season saves are refused.
- `npm run check` green throughout; grandfather list not grown.

**Standing risks carried into Phase 3:** Sleeper stats endpoint still unvalidated for live scoring (Phase 4 spike will confirm); no deployed environment yet — GitHub Actions cron stays inert until Vercel deploy (tracked for Phase 8).
