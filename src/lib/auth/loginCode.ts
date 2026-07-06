const LOGIN_CODE_PATTERN = /^\d{6}$/;
// Generous cap: a real code plus a few stray spaces; anything longer is junk
// and gets rejected before we bother normalizing it (bounded input, Rule 3).
const MAX_RAW_CODE_LENGTH = 32;

// Normalizes a user-typed 6-digit login code: trims and strips internal
// whitespace ("123 456" -> "123456"). Returns null for anything that is not
// exactly six digits after normalization - callers must branch on it.
export function normalizeLoginCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW_CODE_LENGTH) {
    return null;
  }
  const compact = raw.replace(/\s+/g, '');
  return LOGIN_CODE_PATTERN.test(compact) ? compact : null;
}
