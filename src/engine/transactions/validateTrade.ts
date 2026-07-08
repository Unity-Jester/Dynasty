import { invariant } from '../../lib/invariant';
import type { LeagueSettings } from '../settings';
import type { RosterMemberShape } from '../roster';
import { validateRosterCounts } from '../roster';
import type { TradePayload } from './payloads';

// Fixed upper bounds mirroring the TradePayload schema caps (payloads.ts).
// Re-asserted here so this engine stands alone even if the caller skipped
// zod parsing — exceeding them is an impossible state, not an error result.
const MAX_TRADE_SIDE_PLAYERS = 15;
const MAX_TRADE_SIDE_PICKS = 10;

// Minimal pick shape for trade validation: identity + draft season. The full
// pick_assets row (round, originalTeamId) is irrelevant to legality here —
// ownership is expressed by WHICH list the pick appears in.
export interface TradePickShape {
  readonly id: string;
  readonly season: number;
}

export interface TradeValidationInput {
  readonly payload: TradePayload;
  readonly proposingRoster: readonly RosterMemberShape[];
  readonly counterpartyRoster: readonly RosterMemberShape[];
  /** Picks whose currentTeamId is the proposing team (decision #6). */
  readonly proposingPicks: readonly TradePickShape[];
  readonly counterpartyPicks: readonly TradePickShape[];
  readonly settings: LeagueSettings;
  readonly currentSeason: number;
  readonly currentWeek: number;
  /**
   * playerId → position. Reserved by the spec for future checks; trades are
   * capacity-only today (position eligibility is a lineup concern, not a
   * roster-membership one), so nothing reads it yet.
   */
  readonly playerPositions: ReadonlyMap<string, string>;
}

export type TradeValidationErrorCode =
  | 'same_team'
  | 'empty_trade'
  | 'asset_not_owned'
  | 'pick_out_of_window'
  | 'deadline_passed'
  | 'capacity';

export type TradeValidationResult =
  | { ok: true }
  | { ok: false; error: TradeValidationErrorCode; detail: string };

function isSideEmpty(side: TradePayload['give']): boolean {
  return side.playerIds.length === 0 && side.pickIds.length === 0;
}

function assertSideBounds(side: TradePayload['give'], label: string): void {
  invariant(
    side.playerIds.length <= MAX_TRADE_SIDE_PLAYERS,
    `${label} side has ${side.playerIds.length} players, over the ${MAX_TRADE_SIDE_PLAYERS} cap — payload bypassed schema validation`,
  );
  invariant(
    side.pickIds.length <= MAX_TRADE_SIDE_PICKS,
    `${label} side has ${side.pickIds.length} picks, over the ${MAX_TRADE_SIDE_PICKS} cap — payload bypassed schema validation`,
  );
}

/** First asset in `payload` not owned by its sending team, or null. */
function firstUnownedAsset(input: TradeValidationInput): string | null {
  const { payload } = input;
  const sides = [
    {
      label: 'give',
      assets: payload.give,
      players: new Set(input.proposingRoster.map((m) => m.playerId)),
      picks: new Set(input.proposingPicks.map((p) => p.id)),
      owner: 'proposing team',
    },
    {
      label: 'receive',
      assets: payload.receive,
      players: new Set(input.counterpartyRoster.map((m) => m.playerId)),
      picks: new Set(input.counterpartyPicks.map((p) => p.id)),
      owner: 'counterparty team',
    },
  ];
  for (const side of sides) {
    for (const playerId of side.assets.playerIds) {
      if (!side.players.has(playerId)) {
        return `${side.label} player ${playerId} is not on the ${side.owner}'s roster`;
      }
    }
    for (const pickId of side.assets.pickIds) {
      if (!side.picks.has(pickId)) {
        return `${side.label} pick ${pickId} is not currently owned by the ${side.owner}`;
      }
    }
  }
  return null;
}

/** First traded pick past the futurePickYears window, or null. Assumes ownership already validated. */
function firstPickOutOfWindow(input: TradeValidationInput): string | null {
  const lastLegalSeason = input.currentSeason + input.settings.trades.futurePickYears;
  const seasonById = new Map<string, number>();
  for (const pick of [...input.proposingPicks, ...input.counterpartyPicks]) {
    seasonById.set(pick.id, pick.season);
  }
  for (const pickId of [...input.payload.give.pickIds, ...input.payload.receive.pickIds]) {
    const season = seasonById.get(pickId);
    // Ownership was checked first (precedence), so every traded pick must
    // resolve in the owned-pick lists — a miss here is an impossible state.
    invariant(season !== undefined, `pick ${pickId} passed ownership but has no known season`);
    if (season > lastLegalSeason) {
      return `pick ${pickId} is for season ${season}, past the last tradeable season ${lastLegalSeason}`;
    }
  }
  return null;
}

/** Post-trade member list: departing players removed, arriving players land 'active' (decision #2). */
function simulateSwap(
  roster: readonly RosterMemberShape[],
  departingIds: readonly string[],
  arrivingIds: readonly string[],
): RosterMemberShape[] {
  const departing = new Set(departingIds);
  const kept = roster.filter((m) => !departing.has(m.playerId));
  const arriving = arrivingIds.map((playerId) => ({ playerId, status: 'active' as const }));
  return [...kept, ...arriving];
}

function checkCapacity(input: TradeValidationInput): TradeValidationResult {
  const { payload } = input;
  const postProposing = simulateSwap(
    input.proposingRoster,
    payload.give.playerIds,
    payload.receive.playerIds,
  );
  const postCounterparty = simulateSwap(
    input.counterpartyRoster,
    payload.receive.playerIds,
    payload.give.playerIds,
  );
  const proposingResult = validateRosterCounts(input.settings, postProposing);
  if (!proposingResult.ok) {
    return { ok: false, error: 'capacity', detail: `proposing team: ${proposingResult.detail}` };
  }
  const counterpartyResult = validateRosterCounts(input.settings, postCounterparty);
  if (!counterpartyResult.ok) {
    return {
      ok: false,
      error: 'capacity',
      detail: `counterparty team: ${counterpartyResult.detail}`,
    };
  }
  return { ok: true };
}

/**
 * Pure legality check for a two-team trade. Check order is a contract
 * (documented in the Phase 7 plan): same_team → empty_trade →
 * asset_not_owned → pick_out_of_window → deadline_passed → capacity.
 */
export function validateTradeProposal(input: TradeValidationInput): TradeValidationResult {
  const { payload } = input;
  assertSideBounds(payload.give, 'give');
  assertSideBounds(payload.receive, 'receive');
  invariant(
    Number.isInteger(input.currentSeason) && Number.isInteger(input.currentWeek),
    `currentSeason/currentWeek must be integers, got ${input.currentSeason}/${input.currentWeek}`,
  );

  if (payload.proposingTeamId === payload.counterpartyTeamId) {
    return { ok: false, error: 'same_team', detail: 'a team cannot trade with itself' };
  }

  if (isSideEmpty(payload.give) && isSideEmpty(payload.receive)) {
    return { ok: false, error: 'empty_trade', detail: 'both sides of the trade are empty' };
  }

  const unowned = firstUnownedAsset(input);
  if (unowned !== null) {
    return { ok: false, error: 'asset_not_owned', detail: unowned };
  }

  const outOfWindow = firstPickOutOfWindow(input);
  if (outOfWindow !== null) {
    return { ok: false, error: 'pick_out_of_window', detail: outOfWindow };
  }

  const { deadlineWeek } = input.settings.trades;
  if (deadlineWeek !== null && input.currentWeek > deadlineWeek) {
    return {
      ok: false,
      error: 'deadline_passed',
      detail: `week ${input.currentWeek} is past the week-${deadlineWeek} trade deadline`,
    };
  }

  return checkCapacity(input);
}

export interface TradePlayerMove {
  readonly playerId: string;
  readonly fromTeamId: string;
  readonly toTeamId: string;
}

export interface TradePickMove {
  readonly pickId: string;
  readonly toTeamId: string;
}

export interface TradeExecutionPlan {
  readonly playerMoves: readonly TradePlayerMove[];
  readonly pickMoves: readonly TradePickMove[];
}

export interface TradeRosters {
  readonly proposingRoster: readonly RosterMemberShape[];
  readonly counterpartyRoster: readonly RosterMemberShape[];
}

/**
 * Concrete move list for an accepted trade, consumed by the executor (Task 3).
 * Pure; runs AFTER validateTradeProposal, so a payload player missing from the
 * rosters is an impossible state → InvariantError, not a typed result.
 */
export function planTradeExecution(
  payload: TradePayload,
  rosters: TradeRosters,
): TradeExecutionPlan {
  assertSideBounds(payload.give, 'give');
  assertSideBounds(payload.receive, 'receive');

  const proposingIds = new Set(rosters.proposingRoster.map((m) => m.playerId));
  const counterpartyIds = new Set(rosters.counterpartyRoster.map((m) => m.playerId));

  const playerMoves: TradePlayerMove[] = [];
  for (const playerId of payload.give.playerIds) {
    invariant(
      proposingIds.has(playerId),
      `give player ${playerId} is not on the proposing roster — trade was not re-validated`,
    );
    playerMoves.push({
      playerId,
      fromTeamId: payload.proposingTeamId,
      toTeamId: payload.counterpartyTeamId,
    });
  }
  for (const playerId of payload.receive.playerIds) {
    invariant(
      counterpartyIds.has(playerId),
      `receive player ${playerId} is not on the counterparty roster — trade was not re-validated`,
    );
    playerMoves.push({
      playerId,
      fromTeamId: payload.counterpartyTeamId,
      toTeamId: payload.proposingTeamId,
    });
  }

  const pickMoves: TradePickMove[] = [
    ...payload.give.pickIds.map((pickId) => ({
      pickId,
      toTeamId: payload.counterpartyTeamId,
    })),
    ...payload.receive.pickIds.map((pickId) => ({
      pickId,
      toTeamId: payload.proposingTeamId,
    })),
  ];

  // Post-invariant: the plan covers exactly the payload's assets (spec contract).
  invariant(
    playerMoves.length === payload.give.playerIds.length + payload.receive.playerIds.length &&
      pickMoves.length === payload.give.pickIds.length + payload.receive.pickIds.length,
    'trade plan does not cover exactly the payload assets',
  );
  return { playerMoves, pickMoves };
}
