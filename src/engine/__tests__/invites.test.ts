import { describe, it, expect } from 'vitest';
import { generateInviteToken, canClaimTeam } from '../invites';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,}$/;
const SAMPLE_SIZE = 100;

describe('generateInviteToken', () => {
  it('produces URL-safe tokens of at least 32 chars', () => {
    const token = generateInviteToken();
    expect(token).toMatch(TOKEN_SHAPE);
  });

  it('produces unique, URL-safe tokens across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const token = generateInviteToken();
      expect(token).toMatch(TOKEN_SHAPE);
      seen.add(token);
    }
    expect(seen.size).toBe(SAMPLE_SIZE);
  });
});

describe('canClaimTeam', () => {
  const base = {
    presentedToken: 'tok-123',
    userId: 'user-1',
    userTeamCountInLeague: 0,
  };

  it('allows claiming an unclaimed team with the matching token', () => {
    const result = canClaimTeam({
      ...base,
      team: { ownerId: null, inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a team that is already owned', () => {
    const result = canClaimTeam({
      ...base,
      team: { ownerId: 'someone-else', inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: false, error: 'already_claimed' });
  });

  it('rejects a team with no invite token', () => {
    const result = canClaimTeam({
      ...base,
      team: { ownerId: null, inviteToken: null },
    });
    expect(result).toEqual({ ok: false, error: 'no_token' });
  });

  it('rejects a token that does not match', () => {
    const result = canClaimTeam({
      ...base,
      presentedToken: 'wrong',
      team: { ownerId: null, inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: false, error: 'token_mismatch' });
  });

  it('rejects a user who already owns a team in the league', () => {
    const result = canClaimTeam({
      ...base,
      userTeamCountInLeague: 1,
      team: { ownerId: null, inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: false, error: 'user_has_team' });
  });

  it('prefers already_claimed over token_mismatch (precedence)', () => {
    const result = canClaimTeam({
      ...base,
      presentedToken: 'wrong',
      team: { ownerId: 'someone-else', inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: false, error: 'already_claimed' });
  });

  it('prefers no_token over token_mismatch when owner is null', () => {
    const result = canClaimTeam({
      ...base,
      presentedToken: 'wrong',
      team: { ownerId: null, inviteToken: null },
    });
    expect(result).toEqual({ ok: false, error: 'no_token' });
  });

  it('prefers token_mismatch over user_has_team', () => {
    const result = canClaimTeam({
      ...base,
      presentedToken: 'wrong',
      userTeamCountInLeague: 3,
      team: { ownerId: null, inviteToken: 'tok-123' },
    });
    expect(result).toEqual({ ok: false, error: 'token_mismatch' });
  });

  it('throws when userId is empty', () => {
    expect(() =>
      canClaimTeam({
        ...base,
        userId: '',
        team: { ownerId: null, inviteToken: 'tok-123' },
      }),
    ).toThrow();
  });

  it('throws when presentedToken is empty', () => {
    expect(() =>
      canClaimTeam({
        ...base,
        presentedToken: '',
        team: { ownerId: null, inviteToken: 'tok-123' },
      }),
    ).toThrow();
  });
});
