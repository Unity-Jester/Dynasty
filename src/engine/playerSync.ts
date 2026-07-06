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
    if (!(ROSTERABLE_POSITIONS as readonly string[]).includes(parsed.data.position)) {
      continue; // non-rosterable position: filtered by design, not an anomaly
    }
    rows.push(toPlayerRow(parsed.data));
  }
  return { ok: true, value: { rows, skipped } };
}
