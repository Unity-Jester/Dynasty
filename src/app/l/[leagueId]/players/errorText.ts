import type { CancelClaimError, ProcessWaiversError, SubmitClaimError } from '@/server/actions/waivers';
import type { WaiverDecisionReason } from '@/engine/transactions/resolveWaiverRun';
import type { WaiverResolution } from './types';

// One entry per error variant per action. TypeScript enforces exhaustiveness
// via the Record types below — a new error code fails to compile without a
// friendly headline here (same discipline as the trades page's errorText.ts).

const SHARED_TEXT = {
  invalid_input: 'Something was wrong with that request. Reload the page and try again.',
  unauthenticated: 'Your session expired. Sign in again and try again.',
  not_found: 'This player, team, or claim could not be found. Reload the page and try again.',
  invalid_payload: "This claim's data could not be read. Contact your commissioner.",
  invalid_status: 'This claim was already resolved — reload the page to see its current state.',
  invalid_settings: "This league's settings failed validation. Ask your commissioner to check settings.",
} as const;

export const SUBMIT_CLAIM_ERROR_TEXT: Record<SubmitClaimError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_owner: 'Only the owner of your team can submit this claim.',
  invalid_settings: SHARED_TEXT.invalid_settings,
  player_rostered: 'That player is already rostered in this league.',
  bid_required: 'This league uses FAAB waivers — enter a bid amount (0 or more).',
  bid_not_allowed: 'This league uses priority waivers — bids are not used here.',
  insufficient_funds: 'That bid is more than your remaining FAAB budget.',
  invalid_drop: 'The player you selected to drop is not on your roster. Reload and try again.',
  duplicate_claim: 'You already have a pending claim for this player.',
};

export const CANCEL_CLAIM_ERROR_TEXT: Record<CancelClaimError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: SHARED_TEXT.not_found,
  not_owner: 'Only your team can cancel this claim.',
  invalid_payload: SHARED_TEXT.invalid_payload,
  invalid_status: SHARED_TEXT.invalid_status,
};

export const PROCESS_WAIVERS_ERROR_TEXT: Record<ProcessWaiversError, string> = {
  invalid_input: SHARED_TEXT.invalid_input,
  unauthenticated: SHARED_TEXT.unauthenticated,
  not_found: 'This league could not be found.',
  not_creator: 'Only the league commissioner can process waivers.',
};

function withDetail(headline: string, detail: string | undefined): string {
  return detail ? `${headline} (${detail})` : headline;
}

export function submitClaimErrorMessage(error: SubmitClaimError, detail: string | undefined): string {
  return withDetail(SUBMIT_CLAIM_ERROR_TEXT[error], detail);
}

export function cancelClaimErrorMessage(error: CancelClaimError, detail: string | undefined): string {
  return withDetail(CANCEL_CLAIM_ERROR_TEXT[error], detail);
}

export function processWaiversErrorMessage(error: ProcessWaiversError): string {
  return PROCESS_WAIVERS_ERROR_TEXT[error];
}

// Resolution reasons: the engine's own WaiverDecisionReason plus the two
// quarantine-only reasons runWaivers.ts attaches to claims that never reach
// the engine (bad payload / bid that no longer matches the league's mode).
// payloads.ts types `reason` as a bare string (not this union) since the
// engine and the job are the only writers — an unrecognized value still
// renders below, just without a friendly headline.
type KnownReason = WaiverDecisionReason | 'invalid_bid_for_mode' | 'invalid_payload';

const REASON_TEXT: Record<KnownReason, string> = {
  outbid: 'Another team placed a higher bid on this player.',
  player_taken: 'The player was already claimed or rostered by the time the run happened.',
  insufficient_funds: 'Your bid exceeded your FAAB budget at run time.',
  roster_full: 'Adding this player (with the selected drop) would have put your roster over its limit.',
  invalid_drop: 'The player you selected to drop was no longer on your roster at run time.',
  invalid_bid_for_mode: "This claim's bid no longer matched the league's waiver mode at run time.",
  invalid_payload: "This claim's data could not be read at run time.",
};

function isKnownReason(reason: string): reason is KnownReason {
  return Object.prototype.hasOwnProperty.call(REASON_TEXT, reason);
}

export function resolutionReasonText(resolution: WaiverResolution | null): string {
  if (resolution === null) {
    return 'Resolved.';
  }
  if (resolution.outcome === 'awarded') {
    return 'Awarded — the player was added to your roster.';
  }
  if (resolution.reason === undefined) {
    return 'Rejected.';
  }
  return isKnownReason(resolution.reason) ? REASON_TEXT[resolution.reason] : `Rejected (${resolution.reason}).`;
}
