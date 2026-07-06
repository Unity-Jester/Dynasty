import { invariant } from '@/lib/invariant';

// Tolerance for float noise between Sleeper's and nflverse's independently
// computed stat values (e.g. epa-derived fields round differently).
const EPSILON = 0.01;

export interface DiffStatLinesResult {
  changed: boolean;
  merged: Record<string, number>;
}

// Compare an existing (Sleeper) stat line against a corrected (nflverse,
// already mapped to Sleeper keys) stat line, restricted to `keys` — the set
// of Sleeper keys nflverse actually maps to. Keys outside that set (snap
// counts, pts_std, etc.) are never touched.
//
// A key present in `existing` but absent from `corrected` is left alone:
// nflverse only covers offense-ish stats, so its absence is not evidence
// the true value is zero — it just means nflverse doesn't track that key.
//
// The mirror case — absent in `existing`, (within EPSILON of) zero in
// `corrected` — is AGREEMENT, not a correction: Sleeper omits zero-valued
// stats while nflverse writes explicit zeros, and scoring treats absent as
// zero. Stamping such rows as changed would flip their source to 'nflverse',
// permanently freezing them against future Sleeper poll corrections (the
// poll's setWhere guard never overwrites nflverse rows). Only an absent key
// with a NONZERO corrected value is a genuine disagreement.
export function diffStatLines(
  existing: Record<string, number>,
  corrected: Record<string, number>,
  keys: readonly string[],
): DiffStatLinesResult {
  const merged: Record<string, number> = { ...existing };
  let changed = false;

  for (const key of keys) {
    if (!(key in corrected)) continue;
    const correctedValue = corrected[key];
    invariant(correctedValue !== undefined, 'corrected value missing despite key-in check');

    const existingValue = existing[key];
    // Absent existing + ~zero corrected = agreement (see doc comment above).
    const differs = existingValue === undefined
      ? Math.abs(correctedValue) > EPSILON
      : Math.abs(existingValue - correctedValue) > EPSILON;
    if (differs) {
      merged[key] = correctedValue;
      changed = true;
    }
  }

  invariant(
    Object.keys(existing).every((k) => k in merged),
    'merged dropped an existing key',
  );
  invariant(
    changed || Object.entries(merged).every(([k, v]) => existing[k] === v),
    'changed=false but merged differs from existing',
  );

  return { changed, merged };
}
