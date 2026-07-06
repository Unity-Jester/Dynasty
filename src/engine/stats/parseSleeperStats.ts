import { invariant } from '@/lib/invariant';

// Sleeper's weekly stats map is ~2.5k entries; 10k = something is wrong (shape drift
// or a wrong endpoint), not routine growth.
const MAX_STAT_ENTRIES = 10_000;
// Real lines top out well under 100 numeric keys (wk17 fixture max: 92).
const MAX_KEYS_PER_LINE = 120;

// Systemic-failure tripwire (mirrors playerSync.ts): a Sleeper schema change would
// invalidate almost every line; without this, that would still return ok:true and
// look like routine skip noise. The entry-count floor keeps small fixtures/tests on
// the skip-don't-fail path. skippedUnknown is intentionally excluded — offseason
// weeks legitimately drop many ids that simply aren't in our `players` table yet.
const MAX_SKIP_RATIO = 0.5;
const MIN_ENTRIES_FOR_RATIO_CHECK = 100;

export interface StatLineInput {
  playerId: string;
  stats: Record<string, number>;
}

export type ParseStatsResult =
  | { ok: true; value: { lines: StatLineInput[]; skippedUnknown: number; skippedInvalid: number } }
  | { ok: false; error: string };

interface ParseStatsOpts {
  knownPlayerIds: ReadonlySet<string>;
}

type EntryOutcome =
  | { kind: 'line'; line: StatLineInput }
  | { kind: 'unknown' } // valid shape, but not a player we track
  | { kind: 'invalid' }; // bad value shape, zero numeric keys, or over the key cap

// Keep only finite-number entries from a raw value object. Non-numeric values
// (strings/null/booleans/nested objects) and non-finite numbers (NaN/Infinity)
// are dropped, not coerced — parse-don't-cast at the boundary.
function filterNumericStats(raw: Record<string, unknown>): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      stats[key] = value;
    }
  }
  return stats;
}

// Per-entry validate/filter/classify. Split out of parseSleeperStats purely to keep
// that function's cyclomatic complexity under the Rule 1 ceiling.
function classifyEntry(playerId: string, rawValue: unknown, knownPlayerIds: ReadonlySet<string>): EntryOutcome {
  if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) {
    return { kind: 'invalid' };
  }
  const stats = filterNumericStats(rawValue as Record<string, unknown>);
  const statKeyCount = Object.keys(stats).length;
  if (statKeyCount === 0 || statKeyCount > MAX_KEYS_PER_LINE) {
    return { kind: 'invalid' };
  }
  if (!knownPlayerIds.has(playerId)) {
    return { kind: 'unknown' };
  }
  return { kind: 'line', line: { playerId, stats } };
}

export function parseSleeperStats(input: unknown, opts: ParseStatsOpts): ParseStatsResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'stats payload is not an object' };
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_STAT_ENTRIES) {
    return { ok: false, error: `stats payload exceeds MAX_STAT_ENTRIES (${entries.length})` };
  }

  const lines: StatLineInput[] = [];
  let skippedUnknown = 0;
  let skippedInvalid = 0;
  for (const [playerId, rawValue] of entries) {
    const outcome = classifyEntry(playerId, rawValue, opts.knownPlayerIds);
    if (outcome.kind === 'line') {
      lines.push(outcome.line);
    } else if (outcome.kind === 'unknown') {
      skippedUnknown += 1;
    } else {
      skippedInvalid += 1;
    }
  }

  invariant(
    lines.length + skippedUnknown + skippedInvalid === entries.length,
    'stat line accounting did not add up to the entries processed',
  );
  invariant(
    lines.every((line) => opts.knownPlayerIds.has(line.playerId)),
    'emitted a stat line for a player id outside knownPlayerIds',
  );

  if (entries.length >= MIN_ENTRIES_FOR_RATIO_CHECK && skippedInvalid / entries.length > MAX_SKIP_RATIO) {
    return { ok: false, error: `systemic parse failure: ${skippedInvalid}/${entries.length} lines invalid` };
  }

  return { ok: true, value: { lines, skippedUnknown, skippedInvalid } };
}
