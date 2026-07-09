import { describe, it, expect } from 'vitest';
import {
  TradePayloadSchema,
  WaiverClaimPayloadSchema,
  CommishPayloadSchema,
  parseTransactionPayload,
} from '../payloads';

// Real (v4) UUIDs — zod's uuid() format enforces the RFC 4122 variant nibble,
// so hand-rolled placeholders like "1111-1111-1111" fail validation.
const TEAM_A = 'fec87dff-3bea-4b16-81f7-0d133be322d6';
const TEAM_B = '7a12800b-cde6-45a6-8f67-a68fdb0ec7f0';
const PICK_A = 'd9041df6-17b3-4252-98e2-ebebe2f7c466';

describe('TradePayloadSchema', () => {
  it('accepts a valid trade payload', () => {
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: ['4046'], pickIds: [PICK_A] },
      receive: { playerIds: ['1234'], pickIds: [] },
      note: 'straight up',
    };
    expect(TradePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a trade with more than 15 players on one side', () => {
    const tooMany = Array.from({ length: 16 }, (_, i) => `player-${i}`);
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: tooMany, pickIds: [] },
      receive: { playerIds: [], pickIds: [] },
    };
    expect(TradePayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a duplicate playerId within one side', () => {
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: ['4046', '4046'], pickIds: [] },
      receive: { playerIds: [], pickIds: [] },
    };
    expect(TradePayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a duplicate pickId within one side', () => {
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: [], pickIds: [PICK_A, PICK_A] },
      receive: { playerIds: [], pickIds: [] },
    };
    expect(TradePayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a note longer than 280 characters', () => {
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: [], pickIds: [] },
      receive: { playerIds: [], pickIds: [] },
      note: 'x'.repeat(281),
    };
    expect(TradePayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('WaiverClaimPayloadSchema', () => {
  it('accepts a valid waiver claim with a null bid and null drop', () => {
    const payload = {
      kind: 'waiver_claim',
      teamId: TEAM_A,
      addPlayerId: '4046',
      dropPlayerId: null,
      bid: null,
    };
    expect(WaiverClaimPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('accepts a bid of exactly 0', () => {
    const payload = {
      kind: 'waiver_claim',
      teamId: TEAM_A,
      addPlayerId: '4046',
      dropPlayerId: '1234',
      bid: 0,
    };
    expect(WaiverClaimPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects a bid over 10000', () => {
    const payload = {
      kind: 'waiver_claim',
      teamId: TEAM_A,
      addPlayerId: '4046',
      dropPlayerId: null,
      bid: 10_001,
    };
    expect(WaiverClaimPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts an optional resolution', () => {
    const payload = {
      kind: 'waiver_claim',
      teamId: TEAM_A,
      addPlayerId: '4046',
      dropPlayerId: null,
      bid: 50,
      resolution: { outcome: 'awarded' },
    };
    expect(WaiverClaimPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

describe('CommishPayloadSchema', () => {
  it('accepts a valid commish payload', () => {
    const payload = {
      kind: 'commish',
      action: 'force_add',
      teamId: TEAM_A,
      detail: { playerId: '4046' },
    };
    expect(CommishPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects an unrecognized commish action', () => {
    const payload = {
      kind: 'commish',
      action: 'delete_league',
      teamId: TEAM_A,
      detail: {},
    };
    expect(CommishPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('parseTransactionPayload', () => {
  it('returns ok for a matching type/kind pair', () => {
    const payload = {
      kind: 'trade',
      proposingTeamId: TEAM_A,
      counterpartyTeamId: TEAM_B,
      give: { playerIds: [], pickIds: [] },
      receive: { playerIds: [], pickIds: [] },
    };
    const result = parseTransactionPayload('trade', payload);
    expect(result.ok).toBe(true);
  });

  it('rejects a mismatched type/kind pair (trade row, waiver payload)', () => {
    const payload = {
      kind: 'waiver_claim',
      teamId: TEAM_A,
      addPlayerId: '4046',
      dropPlayerId: null,
      bid: null,
    };
    const result = parseTransactionPayload('trade', payload);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown payload garbage', () => {
    const result = parseTransactionPayload('trade', { kind: 'nonsense', foo: 'bar' });
    expect(result.ok).toBe(false);
  });
});
