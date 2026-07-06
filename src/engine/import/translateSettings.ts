import { z } from 'zod';
import { invariant } from '../../lib/invariant';
import {
  LeagueSettingsSchema,
  SCORING_STAT_KEYS,
  type LeagueSettings,
  type RosterSlotEntryT,
  type RosterSlot,
} from '../settings';
import { firstZodIssueMessage } from '../zodIssue';

// Fixed upper bounds for loops over external (Sleeper API) data — Rule 2.
const MAX_ROSTER_POSITIONS = 60;
const MAX_SCORING_KEYS = 200;

const MIN_PLAYOFF_WEEK = 14;
const MAX_PLAYOFF_WEEK = 17;
const DEFAULT_FAAB_BUDGET = 100;
const FUTURE_PICK_YEARS = 3;

// Sleeper roster_positions strings that map 1:1 to a LeagueSettings roster slot.
const DIRECT_SLOT_MAP: Readonly<Record<string, RosterSlot>> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  FLEX: 'FLEX',
  K: 'K',
  DEF: 'DEF',
  SUPER_FLEX: 'SUPER_FLEX',
  BN: 'BENCH',
};

const RawLeagueInput = z.object({
  total_rosters: z.number().int(),
  roster_positions: z.array(z.string()).max(MAX_ROSTER_POSITIONS),
  scoring_settings: z.record(z.string(), z.number()).refine(
    (rec) => Object.keys(rec).length <= MAX_SCORING_KEYS,
    { message: `scoring_settings has more than ${MAX_SCORING_KEYS} keys` },
  ),
  settings: z.object({
    taxi_slots: z.number().int().nullish(),
    reserve_slots: z.number().int().nullish(),
    waiver_type: z.number().int().nullish(),
    waiver_budget: z.number().int().nullish(),
    trade_deadline: z.number().int().nullish(),
    trade_review_days: z.number().int().nullish(),
    playoff_teams: z.number().int().nullish(),
    playoff_week_start: z.number().int().nullish(),
  }),
});

export type TranslateSettingsResult =
  | { ok: true; value: { settings: LeagueSettings; warnings: string[] } }
  | { ok: false; error: string };

const SCORING_KEY_SET: ReadonlySet<string> = new Set(SCORING_STAT_KEYS);

function translateRosterSlots(
  positions: readonly string[],
  taxiSlots: number,
  reserveSlots: number,
  warnings: string[],
): RosterSlotEntryT[] {
  invariant(positions.length <= MAX_ROSTER_POSITIONS, 'roster_positions exceeds the parsed bound');

  const counts = new Map<RosterSlot, number>();
  for (const position of positions) {
    const slot = DIRECT_SLOT_MAP[position];
    if (!slot) {
      warnings.push(`Unknown roster position "${position}" — skipped`);
      continue;
    }
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }

  const entries: RosterSlotEntryT[] = [];
  for (const [slot, count] of counts) {
    entries.push({ slot, count });
  }
  if (taxiSlots > 0) entries.push({ slot: 'TAXI', count: taxiSlots });
  if (reserveSlots > 0) entries.push({ slot: 'IR', count: reserveSlots });
  return entries;
}

function translateScoringRules(
  scoringSettings: Readonly<Record<string, number>>,
  warnings: string[],
): LeagueSettings['scoring']['rules'] {
  const keys = Object.keys(scoringSettings);
  invariant(keys.length <= MAX_SCORING_KEYS, 'scoring_settings exceeds the parsed bound');

  const rules: Record<string, number> = {};
  for (const key of keys) {
    const value = scoringSettings[key];
    invariant(value !== undefined, `scoring_settings key "${key}" vanished mid-iteration`);
    if (value === 0) continue;
    if (!SCORING_KEY_SET.has(key)) {
      warnings.push(`Unsupported scoring stat "${key}" — dropped`);
      continue;
    }
    rules[key] = value;
  }
  return rules as LeagueSettings['scoring']['rules'];
}

function translateWaivers(
  waiverType: number,
  waiverBudget: number,
  warnings: string[],
): LeagueSettings['waivers'] | null {
  if (waiverType === 2) {
    if (waiverBudget > 0) {
      return { mode: 'faab', budget: waiverBudget, tiebreaker: 'reverse_standings' };
    }
    warnings.push(`waiver_budget was not positive — defaulted to ${DEFAULT_FAAB_BUDGET}`);
    return { mode: 'faab', budget: DEFAULT_FAAB_BUDGET, tiebreaker: 'reverse_standings' };
  }
  if (waiverType === 0) return { mode: 'priority', order: 'rolling' };
  if (waiverType === 1) return { mode: 'priority', order: 'reverse_standings' };
  return null;
}

function translateTrades(tradeReviewDays: number, tradeDeadline: number): LeagueSettings['trades'] {
  const reviewMode = tradeReviewDays > 0 ? 'league_vote' : 'none';
  // 99 (and 0/absent) are Sleeper's "no deadline" sentinels — documented, no warning.
  const deadlineWeek = tradeDeadline >= 1 && tradeDeadline <= 18 ? tradeDeadline : null;
  return { reviewMode, futurePickYears: FUTURE_PICK_YEARS, deadlineWeek };
}

function translatePlayoffs(
  playoffTeams: number,
  playoffWeekStart: number,
  warnings: string[],
): LeagueSettings['playoffs'] {
  let startWeek = playoffWeekStart;
  if (startWeek < MIN_PLAYOFF_WEEK || startWeek > MAX_PLAYOFF_WEEK) {
    const clamped = Math.min(Math.max(startWeek, MIN_PLAYOFF_WEEK), MAX_PLAYOFF_WEEK);
    warnings.push(`playoff_week_start ${startWeek} was out of range — clamped to ${clamped}`);
    startWeek = clamped;
  }
  return { teams: playoffTeams, startWeek };
}

type RawLeague = z.infer<typeof RawLeagueInput>;

// Builds the pre-final-gate candidate settings object, or an error string when
// a field has no valid mapping (currently: only an unrecognized waiver_type).
// Split out of translateSettings to keep that function's branching under the
// complexity cap (Rule 1) — this helper owns all the field-by-field mapping.
function buildCandidate(
  raw: RawLeague,
  warnings: string[],
): { ok: true; candidate: Record<string, unknown> } | { ok: false; error: string } {
  const rosterSlots = translateRosterSlots(
    raw.roster_positions,
    raw.settings.taxi_slots ?? 0,
    raw.settings.reserve_slots ?? 0,
    warnings,
  );
  const rules = translateScoringRules(raw.scoring_settings, warnings);

  const waiverType = raw.settings.waiver_type ?? 2;
  const waivers = translateWaivers(waiverType, raw.settings.waiver_budget ?? 0, warnings);
  if (!waivers) {
    return { ok: false, error: `Unrecognized waiver_type "${waiverType}"` };
  }

  const trades = translateTrades(raw.settings.trade_review_days ?? 0, raw.settings.trade_deadline ?? 0);
  const playoffs = translatePlayoffs(
    raw.settings.playoff_teams ?? 2,
    raw.settings.playoff_week_start ?? MIN_PLAYOFF_WEEK,
    warnings,
  );

  return {
    ok: true,
    candidate: {
      teamCount: raw.total_rosters,
      rosterSlots,
      scoring: { rules, bonuses: [] },
      waivers,
      trades,
      playoffs,
    },
  };
}

/**
 * Translates a raw Sleeper league JSON payload into Dynasty's LeagueSettings
 * shape. zod-parses only the fields this function reads (trust boundary);
 * the rest of the Sleeper payload is ignored. Non-fatal translation issues
 * (unknown roster slots, unsupported scoring keys, clamped values) become
 * warnings rather than errors — the import still succeeds.
 */
export function translateSettings(input: unknown): TranslateSettingsResult {
  const parsed = RawLeagueInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstZodIssueMessage(parsed.error) };
  }

  const warnings: string[] = [];
  const built = buildCandidate(parsed.data, warnings);
  if (!built.ok) {
    return built;
  }

  const validated = LeagueSettingsSchema.safeParse(built.candidate);
  if (!validated.success) {
    return { ok: false, error: firstZodIssueMessage(validated.error) };
  }
  return { ok: true, value: { settings: validated.data, warnings } };
}
