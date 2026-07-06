import { invariant } from '@/lib/invariant';

// Single-use team-claim tokens: cryptographically random, URL-safe, and long
// enough that guessing is infeasible. Kept edge-safe — uses only Web Crypto
// (globalThis.crypto), never Node's Buffer.

const MIN_TOKEN_LENGTH = 32;

// Two dash-free UUIDv4s give 64 hex chars (256 bits of randomness), all in
// [0-9a-f] which is already URL-safe and well past the 32-char floor.
export function generateInviteToken(): string {
  const raw = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  invariant(raw.length >= MIN_TOKEN_LENGTH, 'invite token unexpectedly short');
  invariant(/^[A-Za-z0-9_-]+$/.test(raw), 'invite token is not URL-safe');
  return raw;
}

export type ClaimTeamInput = {
  team: { ownerId: string | null; inviteToken: string | null };
  presentedToken: string;
  userId: string;
  userTeamCountInLeague: number;
};

export type ClaimError =
  | 'already_claimed'
  | 'no_token'
  | 'token_mismatch'
  | 'user_has_team';

export type ClaimCheck = { ok: true } | { ok: false; error: ClaimError };

// Pure decision function for whether `userId` may claim `team` with the token
// they presented. Precedence is fixed and load-bearing (an owned team reports
// already_claimed even if the token also mismatches) so the caller never leaks
// which failure came first.
export function canClaimTeam(input: ClaimTeamInput): ClaimCheck {
  invariant(input.userId.length > 0, 'canClaimTeam requires a non-empty userId');
  invariant(
    input.presentedToken.length > 0,
    'canClaimTeam requires a non-empty presentedToken',
  );

  const { team } = input;
  if (team.ownerId !== null) {
    return { ok: false, error: 'already_claimed' };
  }
  if (team.inviteToken === null) {
    return { ok: false, error: 'no_token' };
  }
  if (team.inviteToken !== input.presentedToken) {
    return { ok: false, error: 'token_mismatch' };
  }
  if (input.userTeamCountInLeague > 0) {
    return { ok: false, error: 'user_has_team' };
  }
  return { ok: true };
}
