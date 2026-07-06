import { z } from 'zod';

// Stat keys follow Sleeper's naming so imported scoring settings map 1:1.
export const SCORING_STAT_KEYS = [
  'pass_yd', 'pass_td', 'pass_int', 'pass_2pt',
  'rush_yd', 'rush_td', 'rush_2pt',
  'rec', 'rec_yd', 'rec_td', 'rec_2pt',
  'fum_lost', 'bonus_rec_te',
  // extend deliberately; unknown keys are rejected, not ignored
] as const;

// Lineup slots, not player positions — see ROSTERABLE_POSITIONS in playerSync.ts;
// Phase 6 needs an explicit position→eligible-slots mapping, do not assume these lists align.
export const ROSTER_SLOTS = [
  'QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
  'BENCH', 'TAXI', 'IR',
] as const;
export type RosterSlot = (typeof ROSTER_SLOTS)[number];

const NON_STARTER_SLOTS: readonly RosterSlot[] = ['BENCH', 'TAXI', 'IR'];
const MAX_SLOT_COUNT = 40;

const RosterSlotEntry = z.object({
  slot: z.enum(ROSTER_SLOTS),
  // count >= 1: omit the entry instead of count 0 (one canonical representation)
  count: z.number().int().min(1).max(MAX_SLOT_COUNT),
});

const Bonus = z.object({
  stat: z.enum(SCORING_STAT_KEYS),
  threshold: z.number().positive(),
  points: z.number().finite(),
});

const Scoring = z.object({
  rules: z.partialRecord(z.enum(SCORING_STAT_KEYS), z.number().finite()),
  bonuses: z.array(Bonus).max(50),
});

const TIEBREAKER_MODES = ['reverse_standings', 'rolling'] as const;

const Waivers = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('faab'),
    budget: z.number().int().positive().max(10_000),
    tiebreaker: z.enum(TIEBREAKER_MODES),
  }),
  z.object({
    mode: z.literal('priority'),
    order: z.enum(TIEBREAKER_MODES),
  }),
]);

const Trades = z.object({
  reviewMode: z.enum(['none', 'commissioner', 'league_vote']),
  futurePickYears: z.number().int().min(0).max(3),
  deadlineWeek: z.number().int().min(1).max(18).nullable(),
});

// TODO(Phase 8): cross-field validation — playoffs.teams <= teamCount, and the
// bracket must fit between startWeek and week 18.
const Playoffs = z.object({
  teams: z.number().int().min(2).max(16),
  startWeek: z.number().int().min(14).max(17),
});

export const LeagueSettingsSchema = z
  .object({
    teamCount: z.number().int().min(4).max(32),
    rosterSlots: z
      .array(RosterSlotEntry)
      .max(ROSTER_SLOTS.length)
      .refine(
        (slots) => new Set(slots.map((s) => s.slot)).size === slots.length,
        { message: 'Roster slots must be unique; merge duplicate entries' },
      ),
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
