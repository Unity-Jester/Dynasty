const FALLBACK_PATH = '/l';
const MAX_NEXT_PATH_LENGTH = 2048;

// Open-redirect guard for the `next` return path threaded through the login
// flow. Only same-origin relative paths pass; everything else falls back to
// the app home. Validate at every boundary that touches the raw value.
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_PATH_LENGTH) {
    return FALLBACK_PATH;
  }
  // Must be a single-slash relative path: '//host' is protocol-relative,
  // backslashes get normalized to '/' by browsers, '://' smuggles a scheme.
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return FALLBACK_PATH;
  }
  if (raw.includes('\\') || raw.includes('://')) {
    return FALLBACK_PATH;
  }
  return raw;
}
