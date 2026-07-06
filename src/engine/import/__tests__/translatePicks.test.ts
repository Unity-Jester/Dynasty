import { describe, it, expect } from 'vitest';
import { translatePicks } from '../translatePicks';
import tradedPicksFixture from '../__fixtures__/tradedPicks.json';

const ROSTER_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const CURRENT_SEASON = 2026;

function baseOpts() {
  return { rosterIds: ROSTER_IDS, currentSeason: CURRENT_SEASON };
}

describe('translatePicks — real league fixture', () => {
  it('materializes a base of 144 picks (12 rosters x 3 seasons x 4 rounds) before considering trades', () => {
    const result = translatePicks({ tradedPicks: [] }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(144);
    expect(result.value.picks.every((p) => p.originalRosterId === p.currentRosterId)).toBe(true);
  });

  it('applies exactly the in-window fixture trades, reassigning exactly 77 picks', () => {
    const result = translatePicks({ tradedPicks: tradedPicksFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(144);
    const reassigned = result.value.picks.filter((p) => p.currentRosterId !== p.originalRosterId);
    expect(reassigned).toHaveLength(77);
  });

  it('reassigns the 2028 round-1 pick originally owned by roster 1 to roster 8', () => {
    const result = translatePicks({ tradedPicks: tradedPicksFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pick = result.value.picks.find(
      (p) => p.season === 2028 && p.round === 1 && p.originalRosterId === 1,
    );
    expect(pick).toBeDefined();
    expect(pick?.currentRosterId).toBe(8);
  });

  it('emits a summary warning for the 47 fixture trades in already-drafted (<=2026) seasons', () => {
    const result = translatePicks({ tradedPicks: tradedPicksFixture }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.value.warnings.find((w) => w.includes('47') && w.includes('already-drafted'));
    expect(warning).toBeDefined();
  });
});

describe('translatePicks — synthetic scenarios', () => {
  it('widens the base for a season with a round-5 traded pick, adding 12 picks for that season only, with a warning', () => {
    const tradedPicks = [{ season: '2027', round: 5, roster_id: 1, owner_id: 2 }];
    const result = translatePicks({ tradedPicks }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Base without widening: 144. Widening adds round 5 for all 12 rosters in 2027 only.
    expect(result.value.picks).toHaveLength(144 + 12);
    const round5Picks2027 = result.value.picks.filter((p) => p.season === 2027 && p.round === 5);
    expect(round5Picks2027).toHaveLength(12);
    const roundsInOtherSeasons = result.value.picks.filter((p) => p.season !== 2027 && p.round === 5);
    expect(roundsInOtherSeasons).toHaveLength(0);
    const applied = round5Picks2027.find((p) => p.originalRosterId === 1);
    expect(applied?.currentRosterId).toBe(2);
    expect(result.value.warnings.some((w) => w.includes('round 5') || w.includes('Round 5'))).toBe(true);
  });

  it('skips a trade referencing an unknown roster_id/owner_id and warns', () => {
    const tradedPicks = [{ season: '2027', round: 1, roster_id: 1, owner_id: 99 }];
    const result = translatePicks({ tradedPicks }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(144);
    const pick = result.value.picks.find((p) => p.season === 2027 && p.round === 1 && p.originalRosterId === 1);
    expect(pick?.currentRosterId).toBe(1);
    expect(result.value.warnings.some((w) => w.includes('99'))).toBe(true);
  });

  it('produces a pure base with no trades and no warnings when traded list is empty', () => {
    const result = translatePicks({ tradedPicks: [] }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(144);
    expect(result.value.warnings).toEqual([]);
  });

  it('returns err for non-array tradedPicks', () => {
    const result = translatePicks({ tradedPicks: 'nope' }, baseOpts());
    expect(result.ok).toBe(false);
  });

  it('returns err for non-object input', () => {
    const result = translatePicks('nope', baseOpts());
    expect(result.ok).toBe(false);
  });

  it('emits a separate summary warning for trades beyond the future pick window', () => {
    const tradedPicks = [{ season: '2031', round: 1, roster_id: 1, owner_id: 2 }];
    const result = translatePicks({ tradedPicks }, baseOpts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.picks).toHaveLength(144);
    const warning = result.value.warnings.find((w) => w.includes('1') && w.toLowerCase().includes('future'));
    expect(warning).toBeDefined();
  });
});
