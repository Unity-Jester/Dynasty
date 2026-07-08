import { describe, it, expect } from 'vitest';
import { validateTradeProposal, planTradeExecution } from '../validateTrade';
import type { TradeValidationInput } from '../validateTrade';
import type { TradePayload } from '../payloads';
import type { RosterMemberShape } from '../../roster';
import { DEFAULT_SUPERFLEX_PPR } from '../../settings';

// Real (v4) UUIDs — see payloads.test.ts for why placeholders don't parse.
const TEAM_A = 'fec87dff-3bea-4b16-81f7-0d133be322d6';
const TEAM_B = '7a12800b-cde6-45a6-8f67-a68fdb0ec7f0';
const PICK_A1 = 'd9041df6-17b3-4252-98e2-ebebe2f7c466';
const PICK_A2 = '0d4de9dc-59f5-4a3f-9d43-cbb0f7cbcbc0';
const PICK_B1 = '5b0a3a8e-6a0f-4b57-9a3e-2f1c02d6a111';

const activeMembers = (prefix: string, count: number): RosterMemberShape[] =>
  Array.from({ length: count }, (_, i) => ({
    playerId: `${prefix}${i}`,
    status: 'active' as const,
  }));

const payload = (overrides: Partial<TradePayload> = {}): TradePayload => ({
  kind: 'trade',
  proposingTeamId: TEAM_A,
  counterpartyTeamId: TEAM_B,
  give: { playerIds: ['a0'], pickIds: [] },
  receive: { playerIds: ['b0'], pickIds: [] },
  ...overrides,
});

// Default fixture: team A owns players a0..a9 and picks A1 (2027), A2 (2029);
// team B owns players b0..b9 and pick B1 (2027). DEFAULT_SUPERFLEX_PPR gives a
// 32-player capacity with a 25-player active pool, 4 taxi, 3 IR.
const makeInput = (overrides: Partial<TradeValidationInput> = {}): TradeValidationInput => ({
  payload: payload(),
  proposingRoster: activeMembers('a', 10),
  counterpartyRoster: activeMembers('b', 10),
  proposingPicks: [
    { id: PICK_A1, season: 2027 },
    { id: PICK_A2, season: 2029 },
  ],
  counterpartyPicks: [{ id: PICK_B1, season: 2027 }],
  settings: DEFAULT_SUPERFLEX_PPR,
  currentSeason: 2026,
  currentWeek: 3,
  playerPositions: new Map<string, string>(),
  ...overrides,
});

describe('validateTradeProposal', () => {
  it('accepts a simple player-for-player trade', () => {
    expect(validateTradeProposal(makeInput())).toEqual({ ok: true });
  });

  it('rejects a trade where both teams are the same (same_team)', () => {
    const input = makeInput({ payload: payload({ counterpartyTeamId: TEAM_A }) });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'same_team' });
  });

  it('rejects a trade where both sides are empty (empty_trade)', () => {
    const input = makeInput({
      payload: payload({
        give: { playerIds: [], pickIds: [] },
        receive: { playerIds: [], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'empty_trade' });
  });

  it('accepts a one-sided gift trade (only give non-empty) — NOT empty_trade', () => {
    const input = makeInput({
      payload: payload({
        give: { playerIds: ['a0'], pickIds: [] },
        receive: { playerIds: [], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toEqual({ ok: true });
  });

  it('rejects a give player not on the proposing roster (asset_not_owned)', () => {
    const input = makeInput({
      payload: payload({ give: { playerIds: ['stranger'], pickIds: [] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'asset_not_owned' });
  });

  it('rejects a receive player not on the counterparty roster (asset_not_owned)', () => {
    const input = makeInput({
      payload: payload({ receive: { playerIds: ['stranger'], pickIds: [] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'asset_not_owned' });
  });

  it('rejects a give pick the proposing team does not currently own (asset_not_owned)', () => {
    const input = makeInput({
      // PICK_B1 belongs to the counterparty, not the proposer.
      payload: payload({ give: { playerIds: [], pickIds: [PICK_B1] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'asset_not_owned' });
  });

  it('rejects a receive pick the counterparty does not currently own (asset_not_owned)', () => {
    const input = makeInput({
      payload: payload({ receive: { playerIds: [], pickIds: [PICK_A1] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'asset_not_owned' });
  });

  it('accepts a pick at exactly currentSeason + futurePickYears (window boundary)', () => {
    // futurePickYears = 3, currentSeason = 2026 → 2029 is the last legal season.
    const input = makeInput({
      payload: payload({ give: { playerIds: [], pickIds: [PICK_A2] } }),
    });
    expect(validateTradeProposal(input)).toEqual({ ok: true });
  });

  it('rejects a pick one season past the window (pick_out_of_window)', () => {
    const input = makeInput({
      proposingPicks: [{ id: PICK_A2, season: 2030 }],
      payload: payload({ give: { playerIds: [], pickIds: [PICK_A2] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({
      ok: false,
      error: 'pick_out_of_window',
    });
  });

  it('accepts a trade at exactly the deadline week (boundary)', () => {
    const settings = {
      ...DEFAULT_SUPERFLEX_PPR,
      trades: { ...DEFAULT_SUPERFLEX_PPR.trades, deadlineWeek: 10 },
    };
    expect(validateTradeProposal(makeInput({ settings, currentWeek: 10 }))).toEqual({ ok: true });
  });

  it('rejects a trade one week past the deadline (deadline_passed)', () => {
    const settings = {
      ...DEFAULT_SUPERFLEX_PPR,
      trades: { ...DEFAULT_SUPERFLEX_PPR.trades, deadlineWeek: 10 },
    };
    expect(validateTradeProposal(makeInput({ settings, currentWeek: 11 }))).toMatchObject({
      ok: false,
      error: 'deadline_passed',
    });
  });

  it('never rejects on deadline when deadlineWeek is null', () => {
    // DEFAULT_SUPERFLEX_PPR has deadlineWeek: null.
    expect(validateTradeProposal(makeInput({ currentWeek: 18 }))).toEqual({ ok: true });
  });

  it('rejects when arriving players overflow the counterparty (receiving side capacity)', () => {
    // Counterparty at the full 25-player active pool; nets +1 active → 26.
    const input = makeInput({
      counterpartyRoster: activeMembers('b', 25),
      payload: payload({
        give: { playerIds: ['a0', 'a1'], pickIds: [] },
        receive: { playerIds: ['b0'], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'capacity' });
  });

  it('rejects when arriving players overflow the proposing side (mirror capacity)', () => {
    const input = makeInput({
      proposingRoster: activeMembers('a', 25),
      payload: payload({
        give: { playerIds: ['a0'], pickIds: [] },
        receive: { playerIds: ['b0', 'b1'], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'capacity' });
  });

  it('accepts when a departing taxi player is replaced by an arriving ACTIVE player that still fits', () => {
    // Proposer: 24 active + 1 taxi. Gives the taxi player, receives an active
    // player. The taxi departure frees NO active-pool room (different bucket),
    // but 24 + 1 = 25 active still fits the pool exactly.
    const input = makeInput({
      proposingRoster: [...activeMembers('a', 24), { playerId: 'tx0', status: 'taxi' as const }],
      payload: payload({
        give: { playerIds: ['tx0'], pickIds: [] },
        receive: { playerIds: ['b0'], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toEqual({ ok: true });
  });

  it('rejects when a departing taxi player cannot make room for an arriving active player', () => {
    // Proposer already at 25 active; trading a taxi player away frees taxi
    // space, not active-pool space, so the arriving player overflows to 26.
    const input = makeInput({
      proposingRoster: [...activeMembers('a', 25), { playerId: 'tx0', status: 'taxi' as const }],
      payload: payload({
        give: { playerIds: ['tx0'], pickIds: [] },
        receive: { playerIds: ['b0'], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'capacity' });
  });

  it('precedence: same_team wins over empty_trade when both apply', () => {
    const input = makeInput({
      payload: payload({
        counterpartyTeamId: TEAM_A,
        give: { playerIds: [], pickIds: [] },
        receive: { playerIds: [], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'same_team' });
  });

  it('precedence: asset_not_owned wins over pick_out_of_window for an unowned out-of-window pick', () => {
    const input = makeInput({
      // PICK_B1 is out of window (2031 > 2029) AND not the proposer's.
      counterpartyPicks: [{ id: PICK_B1, season: 2031 }],
      payload: payload({ give: { playerIds: [], pickIds: [PICK_B1] } }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'asset_not_owned' });
  });

  it('precedence: deadline_passed wins over capacity when both apply', () => {
    const settings = {
      ...DEFAULT_SUPERFLEX_PPR,
      trades: { ...DEFAULT_SUPERFLEX_PPR.trades, deadlineWeek: 5 },
    };
    const input = makeInput({
      settings,
      currentWeek: 6,
      counterpartyRoster: activeMembers('b', 25),
      payload: payload({
        give: { playerIds: ['a0', 'a1'], pickIds: [] },
        receive: { playerIds: ['b0'], pickIds: [] },
      }),
    });
    expect(validateTradeProposal(input)).toMatchObject({ ok: false, error: 'deadline_passed' });
  });
});

describe('planTradeExecution', () => {
  const rosters = {
    proposingRoster: activeMembers('a', 5),
    counterpartyRoster: activeMembers('b', 5),
  };

  it('produces exactly the payload moves with correct from/to teams', () => {
    const p = payload({
      give: { playerIds: ['a0', 'a1'], pickIds: [PICK_A1] },
      receive: { playerIds: ['b0'], pickIds: [PICK_B1] },
    });
    const plan = planTradeExecution(p, rosters);
    expect(plan.playerMoves).toEqual([
      { playerId: 'a0', fromTeamId: TEAM_A, toTeamId: TEAM_B },
      { playerId: 'a1', fromTeamId: TEAM_A, toTeamId: TEAM_B },
      { playerId: 'b0', fromTeamId: TEAM_B, toTeamId: TEAM_A },
    ]);
    expect(plan.pickMoves).toEqual([
      { pickId: PICK_A1, toTeamId: TEAM_B },
      { pickId: PICK_B1, toTeamId: TEAM_A },
    ]);
  });

  it('handles a picks-only trade (no player moves)', () => {
    const p = payload({
      give: { playerIds: [], pickIds: [PICK_A1] },
      receive: { playerIds: [], pickIds: [] },
    });
    const plan = planTradeExecution(p, rosters);
    expect(plan.playerMoves).toEqual([]);
    expect(plan.pickMoves).toEqual([{ pickId: PICK_A1, toTeamId: TEAM_B }]);
  });

  it('throws an invariant error when a give player is missing from the proposing roster', () => {
    const p = payload({ give: { playerIds: ['ghost'], pickIds: [] } });
    expect(() => planTradeExecution(p, rosters)).toThrow(/Invariant/);
  });

  it('throws an invariant error when a receive player is missing from the counterparty roster', () => {
    const p = payload({ receive: { playerIds: ['ghost'], pickIds: [] } });
    expect(() => planTradeExecution(p, rosters)).toThrow(/Invariant/);
  });
});

// Duplicate ids within one side are rejected by the TradeAssets schema; these
// payloads are constructed literally (bypassing parsing) to pin the engine's
// defense-in-depth invariant — without it a duplicate would double-count in
// the capacity simulation and duplicate moves in the execution plan.
describe('duplicate assets bypassing schema validation', () => {
  it('validateTradeProposal trips an invariant on a duplicate give playerId', () => {
    const input = makeInput({
      payload: payload({ give: { playerIds: ['a0', 'a0'], pickIds: [] } }),
    });
    expect(() => validateTradeProposal(input)).toThrow(/Invariant.*duplicate playerIds/);
  });

  it('planTradeExecution trips an invariant on a duplicate receive pickId', () => {
    const p = payload({ receive: { playerIds: [], pickIds: [PICK_B1, PICK_B1] } });
    const rosters = {
      proposingRoster: activeMembers('a', 5),
      counterpartyRoster: activeMembers('b', 5),
    };
    expect(() => planTradeExecution(p, rosters)).toThrow(/Invariant.*duplicate pickIds/);
  });
});
