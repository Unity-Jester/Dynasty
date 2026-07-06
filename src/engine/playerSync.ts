import { z } from 'zod';
import { invariant } from '@/lib/invariant';

// Player positions, not lineup slots — see ROSTER_SLOTS in settings.ts; Phase 6
// needs an explicit position→eligible-slots mapping, do not assume these lists align.
export const ROSTERABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const MAX_SLEEPER_PLAYERS = 30_000; // Sleeper's map is ~11k; 30k = something is wrong

// Systemic-failure tripwire: a Sleeper schema change would fail almost every
// row; without this, ~11k skips would still return ok:true and look like
// routine noise. The entry-count floor keeps small fixtures on the
// skip-don't-fail path.
const MAX_SKIP_RATIO = 0.5;
const MIN_ENTRIES_FOR_RATIO_CHECK = 100;

// Validate only the fields we persist — Sleeper's rows carry ~40 others.
// full_name is absent on team DEF rows (only first_name/last_name), so all
// three name fields are optional here; resolveName enforces that at least
// one usable name part exists.
const RawPlayer = z.object({
  player_id: z.string().min(1),
  full_name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
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

// Sleeper omits full_name on team DEF rows; derive the display name from
// whichever parts exist. An unresolvable name makes the row invalid.
function resolveName(p: z.infer<typeof RawPlayer>): string | null {
  const full = (p.full_name ?? '').trim();
  if (full.length > 0) {
    return full;
  }
  const joined = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return joined.length > 0 ? joined : null;
}

type EntryOutcome =
  | { kind: 'row'; row: PlayerRow }
  | { kind: 'skipped' } // failed validation: an anomaly worth counting
  | { kind: 'filtered' }; // non-rosterable position: dropped by design

// Per-entry validate/filter/map. Split out of mapSleeperPlayers purely to
// keep that function's cyclomatic complexity under the Rule 1 ceiling.
function classifyEntry(entry: unknown): EntryOutcome {
  const parsed = RawPlayer.safeParse(entry);
  if (!parsed.success) {
    return { kind: 'skipped' };
  }
  const p = parsed.data;
  const fullName = resolveName(p);
  if (fullName === null) {
    return { kind: 'skipped' };
  }
  if (!(ROSTERABLE_POSITIONS as readonly string[]).includes(p.position)) {
    return { kind: 'filtered' };
  }
  return {
    kind: 'row',
    row: {
      sleeperId: p.player_id,
      fullName,
      position: p.position,
      nflTeam: p.team ?? null,
      status: p.status ?? 'unknown',
      injuryStatus: p.injury_status ?? null,
      yearsExp: p.years_exp ?? null,
    },
  };
}

export function mapSleeperPlayers(input: unknown): MapResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'players payload is not an object' };
  }
  const entries = Object.values(input);
  if (entries.length > MAX_SLEEPER_PLAYERS) {
    return { ok: false, error: `players payload exceeds MAX_SLEEPER_PLAYERS (${entries.length})` };
  }

  const rows: PlayerRow[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const outcome = classifyEntry(entry);
    if (outcome.kind === 'skipped') {
      skipped += 1;
    } else if (outcome.kind === 'row') {
      rows.push(outcome.row);
    }
  }
  invariant(rows.length + skipped <= entries.length, 'row accounting exceeded input size');
  if (entries.length >= MIN_ENTRIES_FOR_RATIO_CHECK && skipped / entries.length > MAX_SKIP_RATIO) {
    return { ok: false, error: `systemic parse failure: ${skipped}/${entries.length} rows skipped` };
  }
  return { ok: true, value: { rows, skipped } };
}
