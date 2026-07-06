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

// Converts one already-validated raw entry to its row shape. Split out of
// mapSleeperPlayers purely to keep that function's cyclomatic complexity
// under the Rule 1 ceiling; behavior is unchanged.
function toPlayerRow(p: z.infer<typeof RawPlayer>): PlayerRow {
  return {
    sleeperId: p.player_id,
    fullName: p.full_name,
    position: p.position,
    nflTeam: p.team ?? null,
    status: p.status ?? 'unknown',
    injuryStatus: p.injury_status ?? null,
    yearsExp: p.years_exp ?? null,
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
    const parsed = RawPlayer.safeParse(entry);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    if (!(ROSTERABLE_POSITIONS as readonly string[]).includes(parsed.data.position)) {
      continue; // non-rosterable position: filtered by design, not an anomaly
    }
    rows.push(toPlayerRow(parsed.data));
  }
  invariant(rows.length + skipped <= entries.length, 'row accounting exceeded input size');
  if (entries.length >= MIN_ENTRIES_FOR_RATIO_CHECK && skipped / entries.length > MAX_SKIP_RATIO) {
    return { ok: false, error: `systemic parse failure: ${skipped}/${entries.length} rows skipped` };
  }
  return { ok: true, value: { rows, skipped } };
}
