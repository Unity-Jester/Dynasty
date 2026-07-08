import type {
  CancelTradeError,
  ProposeTradeError,
  ReviewTradeError,
  RespondToTradeError,
} from '@/server/actions/trades';

// One entry per error variant per action. TypeScript enforces exhaustiveness
// via the Record types below — a new error code fails to compile without a
// friendly headline here (same discipline as the lineup page's errorText.ts).

const SHARED_TEXT = {
  invalid_input: 'Something was wrong with that request. Reload the page and try again.',
  unauthenticated: 'Your session expired. Sign in again and try again.',
  not_found: 'This trade or team could not be found.',
  invalid_payload: "This trade's data could not be read. Contact your commissioner.",
  invalid_status: 'This trade was already handled — reload the page to see its current state.',
  invalid_settings: "This league's settings failed validation. Ask your commissioner to check settings.",
  conflict: 'Someone else made changes to this trade at the same time. Reload and try again.',
  db_error: 'A database error occurred. Try again in a moment.',
} as const;

export const PROPOSE_TRADE_ERROR_TEXT: Record<ProposeTradeError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_owner: 'Only the owner of your team can propose this trade.',
  wrong_league: 'Both teams must belong to this league.',
  invalid_settings: SHARED_TEXT.invalid_settings,
  same_team: "You can't trade with your own team.",
  empty_trade: 'Select at least one player or pick to trade.',
  asset_not_owned: 'One of the selected assets is no longer owned by that team. Reload and try again.',
  pick_out_of_window: "One of the selected picks is too far in the future for this league's trade window.",
  deadline_passed: "This season's trade deadline has passed.",
};

export const RESPOND_TRADE_ERROR_TEXT: Record<RespondToTradeError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_owner: "Only your team's owner can respond to this trade.",
  invalid_payload: SHARED_TEXT.invalid_payload,
  invalid_status: 'Someone else already acted on this trade. Reload the page to see its current state.',
  invalid_settings: SHARED_TEXT.invalid_settings,
  validation_failed: 'This trade no longer passes validation.',
  conflict: SHARED_TEXT.conflict,
  db_error: SHARED_TEXT.db_error,
};

export const CANCEL_TRADE_ERROR_TEXT: Record<CancelTradeError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_owner: 'Only the proposer can cancel this trade.',
  invalid_payload: SHARED_TEXT.invalid_payload,
  invalid_status: SHARED_TEXT.invalid_status,
};

export const REVIEW_TRADE_ERROR_TEXT: Record<ReviewTradeError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_creator: 'Only the league commissioner can review trades.',
  invalid_payload: SHARED_TEXT.invalid_payload,
  invalid_status: SHARED_TEXT.invalid_status,
  invalid_settings: SHARED_TEXT.invalid_settings,
  validation_failed: 'This trade no longer passes validation.',
  conflict: SHARED_TEXT.conflict,
  db_error: SHARED_TEXT.db_error,
};

function withDetail(headline: string, detail: string | undefined): string {
  return detail ? `${headline} (${detail})` : headline;
}

export function proposeTradeErrorMessage(error: ProposeTradeError, detail: string | undefined): string {
  return withDetail(PROPOSE_TRADE_ERROR_TEXT[error], detail);
}

export function cancelTradeErrorMessage(error: CancelTradeError, detail: string | undefined): string {
  return withDetail(CANCEL_TRADE_ERROR_TEXT[error], detail);
}

/**
 * `validation_failed` carries its own explanatory detail from the engine
 * (e.g. "capacity: proposing team is over the bench limit") — surfaced
 * verbatim under the friendly headline, same convention as the lineup page's
 * `locked_change`.
 */
export function respondTradeErrorMessage(error: RespondToTradeError, detail: string | undefined): string {
  const headline = RESPOND_TRADE_ERROR_TEXT[error];
  if (!detail) return headline;
  if (error === 'validation_failed') return `${headline}: ${detail}`;
  return withDetail(headline, detail);
}

/**
 * `validation_failed` at approve time leaves the trade pending_review — the
 * commissioner can retry later once rosters change, or veto it now.
 */
export function reviewTradeErrorMessage(error: ReviewTradeError, detail: string | undefined): string {
  const headline = REVIEW_TRADE_ERROR_TEXT[error];
  if (error === 'validation_failed') {
    const why = detail ? `: ${detail}` : '';
    return `${headline}${why} You can retry once rosters change, or veto this trade.`;
  }
  return withDetail(headline, detail);
}

export function respondSuccessMessage(status: 'rejected' | 'pending_review' | 'processed'): string {
  switch (status) {
    case 'rejected':
      return 'Trade rejected.';
    case 'pending_review':
      return 'Trade sent to the commissioner for review.';
    case 'processed':
      return 'Trade processed — rosters have been updated.';
  }
}

export function reviewSuccessMessage(status: 'processed' | 'vetoed'): string {
  return status === 'processed' ? 'Trade approved and processed — rosters have been updated.' : 'Trade vetoed.';
}
