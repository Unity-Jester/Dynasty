import { invariant } from '@/lib/invariant';

// Fixed upper bounds (CODING_STANDARDS.md Rule 2/3). No real league approaches
// these; they exist purely to bound iteration over external data.
const MIN_TEAMS = 4;
const MAX_TEAMS = 32;
const MIN_WEEKS = 1;
const MAX_WEEKS = 25;

export interface Pairing {
  readonly home: string;
  readonly away: string;
}

export interface ScheduleWeek {
  readonly week: number;
  readonly pairings: readonly Pairing[];
}

export interface SchedulePlan {
  readonly weeks: readonly ScheduleWeek[];
}

export type ScheduleResult = { ok: true; value: SchedulePlan } | { ok: false; error: string };

function validate(teamIds: readonly string[], weeks: number): string | null {
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKS || weeks > MAX_WEEKS) {
    return `weeks must be an integer between ${MIN_WEEKS} and ${MAX_WEEKS} (got ${weeks})`;
  }
  if (teamIds.length < MIN_TEAMS || teamIds.length > MAX_TEAMS) {
    return `team count must be between ${MIN_TEAMS} and ${MAX_TEAMS} (got ${teamIds.length})`;
  }
  if (teamIds.length % 2 !== 0) {
    return 'odd team count — byes not supported (documented MVP limitation)';
  }
  return null;
}

/**
 * Builds one week's pairings via the circle method: `fixed` stays in seat 0;
 * `rotated` (the other n-1 teams, already rotated by the caller for this
 * week) fills the remaining seats. Seat i pairs with seat (n-1-i).
 *
 * Home/away parity rule (documented, tested in schedule.test.ts): the seat-a
 * team (arr[i]) is home on odd weeks and away on even weeks — i.e. home/away
 * flips as a whole every week. This does not hit the theoretical tightest
 * per-team bound (floor/ceil of a single rotation) but empirically keeps
 * every team's home count within 2 of any other team's, and within
 * [floor(weeks/2)-1, ceil(weeks/2)+1] individually, for every team count
 * 4-32 and week count 1-25 (verified by the balance test). A perfectly tight
 * bound for every team simultaneously requires a more elaborate per-team
 * alternation scheme; this simpler global flip was chosen for clarity given
 * the MVP has no fairness requirement beyond "roughly even".
 */
function buildWeekPairings(
  week: number,
  fixed: string,
  rotated: readonly string[],
): readonly Pairing[] {
  const arr = [fixed, ...rotated];
  const n = arr.length;
  const homeIsSeatA = week % 2 === 1;

  const pairings: Pairing[] = [];
  const seenThisWeek = new Set<string>();
  for (let i = 0; i < n / 2; i += 1) {
    const seatA = arr[i];
    const seatB = arr[n - 1 - i];
    invariant(seatA !== undefined && seatB !== undefined, `week ${week} seat ${i} is undefined`);

    const home = homeIsSeatA ? seatA : seatB;
    const away = homeIsSeatA ? seatB : seatA;
    invariant(home !== away, `week ${week} produced a self-pairing for team ${home}`);

    invariant(!seenThisWeek.has(home), `week ${week}: team ${home} appears twice`);
    invariant(!seenThisWeek.has(away), `week ${week}: team ${away} appears twice`);
    seenThisWeek.add(home);
    seenThisWeek.add(away);

    pairings.push({ home, away });
  }
  return pairings;
}

/**
 * Deterministic round-robin schedule generator (circle method). Sorts a COPY
 * of `teamIds` lexicographically before scheduling — the caller's original
 * order never matters and is never mutated. Odd team counts are rejected
 * (bye weeks are out of MVP scope). Weeks beyond a full rotation (n-1)
 * continue rotating: the cycle repeats, structurally reproducing earlier
 * weeks' pairings (home/away may flip depending on week parity — see
 * `buildWeekPairings`).
 */
export function generateRoundRobin(teamIds: readonly string[], weeks: number): ScheduleResult {
  const validationError = validate(teamIds, weeks);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const sorted = [...teamIds].sort();
  const n = sorted.length;
  const fixed = sorted[0];
  invariant(fixed !== undefined, 'sorted team list unexpectedly empty after validation');
  const rotating = sorted.slice(1);
  const rotationSize = n - 1;

  const scheduleWeeks: ScheduleWeek[] = [];
  for (let w = 1; w <= weeks; w += 1) {
    const shift = (w - 1) % rotationSize;
    const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];
    const pairings = buildWeekPairings(w, fixed, rotated);

    invariant(
      pairings.length === n / 2,
      `week ${w} has ${pairings.length} pairings, expected ${n / 2}`,
    );

    scheduleWeeks.push({ week: w, pairings });
  }

  invariant(scheduleWeeks.length === weeks, 'generated week count diverged from requested weeks');

  return { ok: true, value: { weeks: scheduleWeeks } };
}
