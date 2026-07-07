import { describe, it, expect } from 'vitest';
import { computeStandings, type MatchupResult, type Standing } from '../standings';

// Convenience: a final matchup with clean 2dp string points (the shape
// scoreWeek writes — roundPoints(total).toFixed(2)).
function m(
  home: string,
  away: string,
  homePoints: string | null,
  awayPoints: string | null,
  final = true,
): MatchupResult {
  return { homeTeamId: home, awayTeamId: away, homePoints, awayPoints, final };
}

function byTeam(standings: readonly Standing[]): Map<string, Standing> {
  return new Map(standings.map((s) => [s.teamId, s]));
}

describe('computeStandings', () => {
  it('returns an empty array for no matchups', () => {
    const result = computeStandings([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('ignores non-final matchups entirely (a scheduled-but-unplayed week)', () => {
    const result = computeStandings([m('a', 'b', null, null, false)]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No team appears in any FINAL matchup, so standings are empty.
    expect(result.value).toEqual([]);
  });

  it('accounts wins/losses across three final matchups', () => {
    // a beats b, a beats c, b beats c.
    const result = computeStandings([
      m('a', 'b', '110.00', '100.00'),
      m('a', 'c', '120.00', '90.00'),
      m('b', 'c', '105.00', '95.00'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = byTeam(result.value);
    expect(t.get('a')).toMatchObject({ wins: 2, losses: 0, ties: 0 });
    expect(t.get('b')).toMatchObject({ wins: 1, losses: 1, ties: 0 });
    expect(t.get('c')).toMatchObject({ wins: 0, losses: 2, ties: 0 });
    // Every team that appeared in a final matchup is present, none extra.
    expect(result.value.length).toBe(3);
  });

  it('records a tie for exactly-equal points', () => {
    const result = computeStandings([m('a', 'b', '100.00', '100.00')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = byTeam(result.value);
    expect(t.get('a')).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(t.get('b')).toMatchObject({ wins: 0, losses: 0, ties: 1 });
  });

  it('accumulates points for / against across matchups', () => {
    const result = computeStandings([
      m('a', 'b', '110.00', '100.00'),
      m('a', 'c', '120.50', '90.25'),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = byTeam(result.value);
    // a: PF = 110 + 120.5 = 230.5, PA = 100 + 90.25 = 190.25
    expect(t.get('a')).toMatchObject({ pointsFor: 230.5, pointsAgainst: 190.25 });
    expect(t.get('b')).toMatchObject({ pointsFor: 100, pointsAgainst: 110 });
    expect(t.get('c')).toMatchObject({ pointsFor: 90.25, pointsAgainst: 120.5 });
  });

  it('Number()-parses the point strings (the numeric-as-string schema seam)', () => {
    const result = computeStandings([m('a', 'b', '107.92', '107.91')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = byTeam(result.value);
    // 107.92 > 107.91 => a wins by a hundredth; PF parsed as numbers, not strings.
    expect(t.get('a')).toMatchObject({ wins: 1, losses: 0, ties: 0, pointsFor: 107.92 });
    expect(t.get('b')).toMatchObject({ wins: 0, losses: 1, ties: 0, pointsFor: 107.91 });
  });

  it('errors on a final matchup with a null side (an impossible state scoreWeek never writes)', () => {
    const result = computeStandings([m('a', 'b', '110.00', null)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Names the offending matchup so an operator can find it.
    expect(result.error).toContain('a');
  });

  it('errors on a non-numeric point string (NaN after Number-parse)', () => {
    const result = computeStandings([m('a', 'b', '110.00', 'not-a-number')]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('b');
  });
});
