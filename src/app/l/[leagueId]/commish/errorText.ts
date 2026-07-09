import type { CommishForceAddError, CommishForceDropError } from '@/server/actions/commish';

// One entry per error variant per action. TypeScript enforces exhaustiveness
// via the Record types below — a new error code fails to compile without a
// friendly headline here (same discipline as the players/trades errorText.ts).

const SHARED_TEXT = {
  invalid_input: 'Something was wrong with that request. Reload the page and try again.',
  unauthenticated: 'Your session expired. Sign in again and try again.',
  not_found: 'This team, league, or player could not be found.',
  not_creator: 'Only the league commissioner can use this tool.',
  invalid_settings: "This league's settings failed validation. Check settings and try again.",
  conflict: 'Someone else changed this roster at the same time. Reload and try again.',
  db_error: 'A database error occurred. Try again in a moment.',
} as const;

export const COMMISH_FORCE_ADD_ERROR_TEXT: Record<CommishForceAddError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_creator: SHARED_TEXT.not_creator,
  invalid_settings: SHARED_TEXT.invalid_settings,
  player_rostered: 'That player is already rostered in this league.',
  over_capacity: "That team's roster is already at capacity.",
  taxi_full: "That team's taxi squad is full.",
  ir_full: "That team's IR is full.",
  conflict: SHARED_TEXT.conflict,
  db_error: SHARED_TEXT.db_error,
};

export const COMMISH_FORCE_DROP_ERROR_TEXT: Record<CommishForceDropError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_creator: SHARED_TEXT.not_creator,
  not_rostered: 'That player is not on this roster. Reload and try again.',
  invalid_settings: SHARED_TEXT.invalid_settings,
  conflict: SHARED_TEXT.conflict,
  db_error: SHARED_TEXT.db_error,
};

function withDetail(headline: string, detail: string | undefined): string {
  return detail ? `${headline} (${detail})` : headline;
}

export function commishForceAddErrorMessage(error: CommishForceAddError, detail: string | undefined): string {
  return withDetail(COMMISH_FORCE_ADD_ERROR_TEXT[error], detail);
}

export function commishForceDropErrorMessage(error: CommishForceDropError, detail: string | undefined): string {
  return withDetail(COMMISH_FORCE_DROP_ERROR_TEXT[error], detail);
}
