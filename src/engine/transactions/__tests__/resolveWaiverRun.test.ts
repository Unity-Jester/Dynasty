import { describe, it, expect } from 'vitest';
import { InvariantError } from '../../../lib/invariant';
import { resolveWaiverRun } from '../resolveWaiverRun';
import type { ResolveWaiverRunInput, WaiverClaimInput } from '../resolveWaiverRun';
import type { LeagueSettings } from '../../settings';
import { DEFAULT_SUPERFLEX_PPR } from '../../settings';
import type { Standing } from '../../standings';
import type { RosterMemberShape } from '../../roster';

// ---- Fixture builders -------------------------------------------------------

const CLK = '2026-09-01T10:00:00Z';

const claim = (
  over: Partial<WaiverClaimInput> &
    Pick<WaiverClaimInput, 'transactionId' | 'teamId' | 'addPlayerId'>,
): WaiverClaimInput => ({
  dropPlayerId: null,
  bid: null,
  createdAt: CLK,
  ...over,
});

const activeMembers = (prefix: string, count: number): RosterMemberShape[] =>
  Array.from({ length: count }, (_, i) => ({ playerId: `${prefix}${i}`, status: 'active' as const }));

const standing = (teamId: string, wins: number, pointsFor: number): Standing => ({
  teamId,
  wins,
  losses: 0,
  ties: 0,
  pointsFor,
  pointsAgainst: 0,
});

const faabWaivers = (
  tiebreaker: 'reverse_standings' | 'rolling',
  budget = 100,
): LeagueSettings['waivers'] => ({ mode: 'faab', budget, tiebreaker });

const priorityWaivers = (order: 'reverse_standings' | 'rolling'): LeagueSettings['waivers'] => ({
  mode: 'priority',
  order,
});

// Rosters map where every listed team starts with an EMPTY roster (has capacity).
const emptyRosters = (...teamIds: string[]): Map<string, readonly RosterMemberShape[]> =>
  new Map(teamIds.map((t) => [t, []]));

const run = (over: Partial<ResolveWaiverRunInput>) =>
  resolveWaiverRun({
    waivers: faabWaivers('reverse_standings'),
    claims: [],
    standings: [],
    rosters: new Map(),
    faabRemaining: new Map(),
    waiverPriority: new Map(),
    settings: DEFAULT_SUPERFLEX_PPR,
    ...over,
  });

const decisionFor = (
  result: ReturnType<typeof resolveWaiverRun>,
  txId: string,
): { transactionId: string; outcome: string; reason?: string } => {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  const d = result.value.decisions.find((x) => x.transactionId === txId);
  if (!d) throw new Error(`no decision for ${txId}`);
  return d;
};

// ---- Tests ------------------------------------------------------------------

describe('resolveWaiverRun — FAAB core', () => {
  it('awards the higher bid and rejects the lower as "outbid"', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [
        claim({ transactionId: 'lo', teamId: 'A', addPlayerId: 'P', bid: 5 }),
        claim({ transactionId: 'hi', teamId: 'B', addPlayerId: 'P', bid: 20 }),
      ],
      standings: [standing('A', 1, 10), standing('B', 1, 10)],
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    expect(decisionFor(result, 'hi')).toEqual({ transactionId: 'hi', outcome: 'awarded' });
    expect(decisionFor(result, 'lo')).toEqual({
      transactionId: 'lo',
      outcome: 'rejected',
      reason: 'outbid',
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.newFaab.get('B')).toBe(80);
    expect(result.value.newFaab.get('A')).toBe(100);
  });

  it('breaks an equal-bid tie by reverse_standings (worse team = fewer wins wins)', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [
        claim({ transactionId: 'good', teamId: 'A', addPlayerId: 'P', bid: 10 }),
        claim({ transactionId: 'bad', teamId: 'B', addPlayerId: 'P', bid: 10 }),
      ],
      // A is the BETTER team (more wins) -> B (worse) should win the tie.
      standings: [standing('A', 5, 100), standing('B', 2, 100)],
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    expect(decisionFor(result, 'bad').outcome).toBe('awarded');
    // Equal bid -> the loser was NOT outbid; it is player_taken.
    expect(decisionFor(result, 'good')).toEqual({
      transactionId: 'good',
      outcome: 'rejected',
      reason: 'player_taken',
    });
  });

  it('breaks a reverse_standings tie on equal wins by fewer pointsFor', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [
        claim({ transactionId: 'hiPF', teamId: 'A', addPlayerId: 'P', bid: 10 }),
        claim({ transactionId: 'loPF', teamId: 'B', addPlayerId: 'P', bid: 10 }),
      ],
      standings: [standing('A', 3, 200), standing('B', 3, 50)],
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    // B has fewer points -> worse -> wins.
    expect(decisionFor(result, 'loPF').outcome).toBe('awarded');
    expect(decisionFor(result, 'hiPF').reason).toBe('player_taken');
  });

  it('breaks an equal-bid tie by rolling priority (lower number wins)', () => {
    const result = run({
      waivers: faabWaivers('rolling'),
      claims: [
        claim({ transactionId: 'p2', teamId: 'B', addPlayerId: 'P', bid: 10 }),
        claim({ transactionId: 'p1', teamId: 'A', addPlayerId: 'P', bid: 10 }),
      ],
      // Standings would favor A (more wins) as "better"; rolling must IGNORE them.
      standings: [standing('A', 9, 999), standing('B', 0, 0)],
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    expect(decisionFor(result, 'p1').outcome).toBe('awarded');
    expect(decisionFor(result, 'p2').reason).toBe('player_taken');
  });

  it('falls back to waiver priority order when reverse_standings has empty standings (preseason)', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [
        claim({ transactionId: 'b', teamId: 'B', addPlayerId: 'P', bid: 10 }),
        claim({ transactionId: 'a', teamId: 'A', addPlayerId: 'P', bid: 10 }),
      ],
      standings: [], // preseason
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    // No standings -> priority order: A (1) beats B (2).
    expect(decisionFor(result, 'a').outcome).toBe('awarded');
    expect(decisionFor(result, 'b').reason).toBe('player_taken');
  });

  it('rejects a claim whose bid exceeds budget remaining AFTER an earlier award', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [
        // A wins P1 for 70, leaving 30. Then A's bid of 50 on P2 is unaffordable.
        claim({ transactionId: 'first', teamId: 'A', addPlayerId: 'P1', bid: 70 }),
        claim({ transactionId: 'second', teamId: 'A', addPlayerId: 'P2', bid: 50 }),
      ],
      standings: [],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'first').outcome).toBe('awarded');
    expect(decisionFor(result, 'second')).toEqual({
      transactionId: 'second',
      outcome: 'rejected',
      reason: 'insufficient_funds',
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.newFaab.get('A')).toBe(30);
  });

  it('allows a bid exactly equal to the remaining budget', () => {
    const result = run({
      claims: [claim({ transactionId: 't', teamId: 'A', addPlayerId: 'P', bid: 100 })],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 't').outcome).toBe('awarded');
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.newFaab.get('A')).toBe(0);
  });

  it('treats a zero bid as a valid winning claim on an uncontested player', () => {
    const result = run({
      claims: [claim({ transactionId: 'z', teamId: 'A', addPlayerId: 'P', bid: 0 })],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 0]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'z').outcome).toBe('awarded');
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.newFaab.get('A')).toBe(0);
  });
});

describe('resolveWaiverRun — capacity & drops', () => {
  it('rejects an add that overflows the roster when no drop is provided (roster_full)', () => {
    const result = run({
      claims: [claim({ transactionId: 'full', teamId: 'A', addPlayerId: 'NEW', bid: 5 })],
      // 25 active fills the active pool exactly; a 26th active overflows it.
      rosters: new Map([['A', activeMembers('a', 25)]]),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'full')).toEqual({
      transactionId: 'full',
      outcome: 'rejected',
      reason: 'roster_full',
    });
  });

  it('awards the same claim WHEN a valid drop frees capacity', () => {
    const result = run({
      claims: [
        claim({ transactionId: 'swap', teamId: 'A', addPlayerId: 'NEW', dropPlayerId: 'a0', bid: 5 }),
      ],
      rosters: new Map([['A', activeMembers('a', 25)]]),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'swap').outcome).toBe('awarded');
  });

  it('rejects a claim whose drop player is not on the (simulated) roster (invalid_drop)', () => {
    const result = run({
      claims: [
        claim({
          transactionId: 'gone',
          teamId: 'A',
          addPlayerId: 'NEW',
          dropPlayerId: 'traded-away',
          bid: 5,
        }),
      ],
      rosters: new Map([['A', activeMembers('a', 3)]]),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'gone')).toEqual({
      transactionId: 'gone',
      outcome: 'rejected',
      reason: 'invalid_drop',
    });
  });

  it("lets a team's second award see the roster state left by its first (drop frees room across claims)", () => {
    const result = run({
      claims: [
        // First: swap in N1 dropping a0 -> 25 active still.
        claim({ transactionId: 'c1', teamId: 'A', addPlayerId: 'N1', dropPlayerId: 'a0', bid: 30 }),
        // Second: add N2 dropping a1 -> 25 active still. Both must fit.
        claim({ transactionId: 'c2', teamId: 'A', addPlayerId: 'N2', dropPlayerId: 'a1', bid: 20 }),
      ],
      rosters: new Map([['A', activeMembers('a', 25)]]),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'c1').outcome).toBe('awarded');
    expect(decisionFor(result, 'c2').outcome).toBe('awarded');
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.newFaab.get('A')).toBe(50);
  });

  it('rejects a second add for the same team when the first award filled the last slot', () => {
    const result = run({
      claims: [
        claim({ transactionId: 'c1', teamId: 'A', addPlayerId: 'N1', bid: 10 }),
        claim({ transactionId: 'c2', teamId: 'A', addPlayerId: 'N2', bid: 5 }),
      ],
      // 24 active: first add -> 25 (full), second add -> 26 overflow.
      rosters: new Map([['A', activeMembers('a', 24)]]),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(decisionFor(result, 'c1').outcome).toBe('awarded');
    expect(decisionFor(result, 'c2').reason).toBe('roster_full');
  });
});

describe('resolveWaiverRun — rolling rotation', () => {
  it('rotates the winner to the back, changing a later tie in the SAME run', () => {
    const result = run({
      waivers: faabWaivers('rolling'),
      claims: [
        // X wins P1 uncontested (bid 10) -> X rotates behind Y.
        claim({ transactionId: 'x1', teamId: 'X', addPlayerId: 'P1', bid: 10 }),
        // Then X and Y tie at 5 on P2; after rotation Y is ahead -> Y wins.
        claim({ transactionId: 'x2', teamId: 'X', addPlayerId: 'P2', bid: 5 }),
        claim({ transactionId: 'y2', teamId: 'Y', addPlayerId: 'P2', bid: 5 }),
      ],
      rosters: emptyRosters('X', 'Y'),
      faabRemaining: new Map([['X', 100], ['Y', 100]]),
      waiverPriority: new Map([['X', 1], ['Y', 2]]),
    });
    expect(decisionFor(result, 'x1').outcome).toBe('awarded');
    expect(decisionFor(result, 'y2').outcome).toBe('awarded');
    expect(decisionFor(result, 'x2').reason).toBe('player_taken');
    if (!result.ok) throw new Error('unreachable');
    // Rolling renumbers by final queue order: after X then Y both won,
    // queue is [X, Y] again (X went back, then Y went back) -> X=1, Y=2.
    expect(result.value.newPriority.get('X')).toBe(1);
    expect(result.value.newPriority.get('Y')).toBe(2);
  });

  it('does NOT rotate on a rejected claim (priority preserved for the next claim)', () => {
    const result = run({
      waivers: priorityWaivers('rolling'),
      claims: [
        // X's first claim is rejected (invalid_drop) -> X keeps priority.
        claim({ transactionId: 'xreject', teamId: 'X', addPlayerId: 'PX', dropPlayerId: 'ghost' }),
        // Contest for P: X vs Y. X still priority 1 -> X wins.
        claim({ transactionId: 'xwin', teamId: 'X', addPlayerId: 'P' }),
        claim({ transactionId: 'ywin', teamId: 'Y', addPlayerId: 'P' }),
      ],
      standings: [],
      rosters: emptyRosters('X', 'Y'),
      waiverPriority: new Map([['X', 1], ['Y', 2]]),
      faabRemaining: new Map(),
    });
    expect(decisionFor(result, 'xreject').reason).toBe('invalid_drop');
    expect(decisionFor(result, 'xwin').outcome).toBe('awarded');
    expect(decisionFor(result, 'ywin').reason).toBe('player_taken');
  });
});

describe('resolveWaiverRun — priority mode', () => {
  it('uses reverse_standings order and rejects the loser as player_taken (no bids)', () => {
    const result = run({
      waivers: priorityWaivers('reverse_standings'),
      claims: [
        claim({ transactionId: 'better', teamId: 'A', addPlayerId: 'P' }),
        claim({ transactionId: 'worse', teamId: 'B', addPlayerId: 'P' }),
      ],
      standings: [standing('A', 6, 100), standing('B', 1, 100)],
      rosters: emptyRosters('A', 'B'),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
      faabRemaining: new Map(),
    });
    expect(decisionFor(result, 'worse').outcome).toBe('awarded');
    expect(decisionFor(result, 'better').reason).toBe('player_taken');
  });

  it('processes a team\'s multiple claims independently in the rolling global order', () => {
    const result = run({
      waivers: priorityWaivers('rolling'),
      claims: [
        claim({ transactionId: 'x_p1', teamId: 'X', addPlayerId: 'P1', createdAt: '2026-09-01T10:00:00Z' }),
        claim({ transactionId: 'x_p2', teamId: 'X', addPlayerId: 'P2', createdAt: '2026-09-01T10:05:00Z' }),
        claim({ transactionId: 'z_p3', teamId: 'Z', addPlayerId: 'P3' }),
      ],
      standings: [],
      rosters: emptyRosters('X', 'Z'),
      waiverPriority: new Map([['X', 1], ['Z', 2]]),
      faabRemaining: new Map(),
    });
    // X wins P1 (priority 1), rotates behind Z. Z then outranks X, wins P3.
    // X (now last) wins P2. All three awarded, but the ORDER interleaves.
    expect(decisionFor(result, 'x_p1').outcome).toBe('awarded');
    expect(decisionFor(result, 'z_p3').outcome).toBe('awarded');
    expect(decisionFor(result, 'x_p2').outcome).toBe('awarded');
    if (!result.ok) throw new Error('unreachable');
    // Rotations: X wins (-> back), Z wins (-> back), X wins (-> back).
    // Final queue [Z, X] -> Z=1, X=2 (X rotated twice, Z once).
    expect(result.value.newPriority.get('Z')).toBe(1);
    expect(result.value.newPriority.get('X')).toBe(2);
  });
});

describe('resolveWaiverRun — outbid vs player_taken & data drift', () => {
  it('rejects as player_taken (not outbid) when the add player is already on another roster (data drift)', () => {
    const result = run({
      claims: [claim({ transactionId: 'drift', teamId: 'A', addPlayerId: 'owned', bid: 50 })],
      // Player "owned" is already on team B's roster (e.g. commish force-add after submission).
      rosters: new Map([['A', []], ['B', [{ playerId: 'owned', status: 'active' as const }]]]),
      faabRemaining: new Map([['A', 100], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    expect(decisionFor(result, 'drift')).toEqual({
      transactionId: 'drift',
      outcome: 'rejected',
      reason: 'player_taken',
    });
  });

  it('reports insufficient_funds (not outbid) when a losing claim also cannot afford its bid', () => {
    const result = run({
      claims: [
        claim({ transactionId: 'winner', teamId: 'B', addPlayerId: 'P', bid: 80 }),
        // A bids 50 but only has 30 -> unaffordable AND will be beaten.
        claim({ transactionId: 'broke', teamId: 'A', addPlayerId: 'P', bid: 50 }),
      ],
      standings: [],
      rosters: emptyRosters('A', 'B'),
      faabRemaining: new Map([['A', 30], ['B', 100]]),
      waiverPriority: new Map([['A', 1], ['B', 2]]),
    });
    expect(decisionFor(result, 'winner').outcome).toBe('awarded');
    expect(decisionFor(result, 'broke').reason).toBe('insufficient_funds');
  });
});

describe('resolveWaiverRun — output maps & determinism', () => {
  it('echoes every input faab/priority team in the output maps', () => {
    const result = run({
      claims: [claim({ transactionId: 't', teamId: 'A', addPlayerId: 'P', bid: 10 })],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 100], ['B', 55], ['C', 0]]),
      waiverPriority: new Map([['A', 1], ['B', 2], ['C', 3]]),
    });
    if (!result.ok) throw new Error('unreachable');
    expect([...result.value.newFaab.keys()].sort()).toEqual(['A', 'B', 'C']);
    expect(result.value.newFaab.get('B')).toBe(55);
    expect([...result.value.newPriority.keys()].sort()).toEqual(['A', 'B', 'C']);
  });

  it('returns empty decisions and untouched maps for zero claims', () => {
    const result = run({
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.decisions).toEqual([]);
    expect(result.value.newFaab.get('A')).toBe(100);
    expect(result.value.newPriority.get('A')).toBe(1);
  });

  it('produces IDENTICAL decisions and output maps regardless of input claim order (FAAB rolling)', () => {
    const claims: WaiverClaimInput[] = [
      claim({ transactionId: 't1', teamId: 'X', addPlayerId: 'P1', bid: 10 }),
      claim({ transactionId: 't2', teamId: 'X', addPlayerId: 'P2', bid: 5 }),
      claim({ transactionId: 't3', teamId: 'Y', addPlayerId: 'P2', bid: 5 }),
      claim({ transactionId: 't4', teamId: 'Z', addPlayerId: 'P1', bid: 8 }),
      claim({ transactionId: 't5', teamId: 'Y', addPlayerId: 'P3', bid: 5, createdAt: '2026-09-02T00:00:00Z' }),
    ];
    const base: Partial<ResolveWaiverRunInput> = {
      waivers: faabWaivers('rolling'),
      standings: [],
      rosters: emptyRosters('X', 'Y', 'Z'),
      faabRemaining: new Map([['X', 100], ['Y', 100], ['Z', 100]]),
      waiverPriority: new Map([['X', 1], ['Y', 2], ['Z', 3]]),
    };
    const forward = run({ ...base, claims });
    const reversed = run({ ...base, claims: [...claims].reverse() });
    const shuffled = run({ ...base, claims: [claims[2], claims[0], claims[4], claims[1], claims[3]] });
    if (!forward.ok || !reversed.ok || !shuffled.ok) throw new Error('unreachable');

    const norm = (r: typeof forward) => ({
      decisions: [...r.value.decisions].sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
      faab: [...r.value.newFaab.entries()].sort(),
      priority: [...r.value.newPriority.entries()].sort(),
    });
    expect(norm(reversed)).toEqual(norm(forward));
    expect(norm(shuffled)).toEqual(norm(forward));
  });
});

describe('resolveWaiverRun — invariants & contract', () => {
  it('returns an error result for a null bid in FAAB mode', () => {
    const result = run({
      waivers: faabWaivers('reverse_standings'),
      claims: [claim({ transactionId: 'nobid', teamId: 'A', addPlayerId: 'P', bid: null })],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toMatch(/null or invalid bid/i);
  });

  it('throws InvariantError when duplicate transactionIds appear', () => {
    expect(() =>
      run({
        claims: [
          claim({ transactionId: 'dup', teamId: 'A', addPlayerId: 'P1', bid: 1 }),
          claim({ transactionId: 'dup', teamId: 'A', addPlayerId: 'P2', bid: 1 }),
        ],
        rosters: emptyRosters('A'),
        faabRemaining: new Map([['A', 100]]),
        waiverPriority: new Map([['A', 1]]),
      }),
    ).toThrow(InvariantError);
  });

  it('throws InvariantError when a rolling claim has no waiver priority entry', () => {
    expect(() =>
      run({
        waivers: faabWaivers('rolling'),
        claims: [claim({ transactionId: 't', teamId: 'A', addPlayerId: 'P', bid: 1 })],
        rosters: emptyRosters('A'),
        faabRemaining: new Map([['A', 100]]),
        waiverPriority: new Map(), // A missing
      }),
    ).toThrow(InvariantError);
  });

  it('never lets a FAAB balance go below zero and gives every claim exactly one decision', () => {
    const result = run({
      claims: [
        claim({ transactionId: 'a', teamId: 'A', addPlayerId: 'P1', bid: 60 }),
        claim({ transactionId: 'b', teamId: 'A', addPlayerId: 'P2', bid: 60 }),
        claim({ transactionId: 'c', teamId: 'A', addPlayerId: 'P3', bid: 5 }),
      ],
      rosters: emptyRosters('A'),
      faabRemaining: new Map([['A', 100]]),
      waiverPriority: new Map([['A', 1]]),
    });
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.decisions).toHaveLength(3);
    expect([...result.value.newFaab.values()].every((v) => v >= 0)).toBe(true);
    // a wins (60, leaves 40); b unaffordable (60>40); c wins (5, leaves 35).
    expect(decisionFor(result, 'a').outcome).toBe('awarded');
    expect(decisionFor(result, 'b').reason).toBe('insufficient_funds');
    expect(decisionFor(result, 'c').outcome).toBe('awarded');
    expect(result.value.newFaab.get('A')).toBe(35);
  });
});
