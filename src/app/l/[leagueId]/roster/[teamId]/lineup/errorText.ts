import type { SaveLineupError } from '@/server/actions/lineup';

// One entry per SaveLineupError variant — the engine's 6 lineup-validation
// codes plus the action's 9 gate/persistence codes (15 total). TypeScript
// enforces exhaustiveness: this Record type will fail to compile if a code is
// ever added to SaveLineupError without a friendly headline here.
export const LINEUP_ERROR_TEXT: Record<SaveLineupError, string> = {
  // engine (validateLineup) codes
  shape_mismatch: 'That lineup shape doesn’t match this league’s starter slots. Reload the page and try again.',
  not_on_roster: 'One of the selected players is no longer on this roster.',
  not_active: 'One of the selected players is on taxi or IR and can’t start.',
  ineligible_position: 'One of the selected players can’t fill that slot.',
  duplicate_player: 'The same player is assigned to two slots. Fix the duplicate and save again.',
  locked_change: 'Locked lineup change',
  // action gate/persistence codes
  invalid_input: 'Something was wrong with the request. Reload the page and try again.',
  unauthenticated: 'Your session expired. Sign in again to save your lineup.',
  not_found: 'This team or league could not be found.',
  not_owner: 'Only the team owner can set this lineup.',
  wrong_season: 'This league has moved to a new season. Reload the page and try again.',
  invalid_settings: 'This league’s settings failed validation. Ask your commissioner to check settings.',
  week_out_of_range: 'That week is outside the regular season and can’t be edited here.',
  conflict: 'Someone else saved this lineup at the same time. Reload and try again.',
  db_error: 'A database error occurred. Try again in a moment.',
};

/**
 * Friendly text for a failed save. `locked_change` is the one code whose
 * action `detail` is itself a user-facing sentence (which NFL team locked,
 * and why) — it is surfaced verbatim under the friendly headline rather than
 * appended parenthetically like every other code.
 */
export function lineupErrorMessage(error: SaveLineupError, detail: string | undefined): string {
  const headline = LINEUP_ERROR_TEXT[error];
  if (!detail) return headline;
  if (error === 'locked_change') return `${headline}: ${detail}`;
  return `${headline} (${detail})`;
}
