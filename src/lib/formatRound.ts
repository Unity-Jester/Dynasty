import { invariant } from '@/lib/invariant';

// Draft rounds are small: Sleeper dynasty drafts top out well under 30 rounds,
// and translatePicks caps rounds at 10. Out-of-range input is a caller bug,
// so we fail loudly (invariant) rather than clamp and render a lie.
const MIN_ROUND = 1;
const MAX_ROUND = 30;

/**
 * Formats a draft round as an English ordinal: 1 → "1st", 2 → "2nd",
 * 3 → "3rd", 4 → "4th", 11 → "11th" (teens are always "th"), 21 → "21st".
 */
export function formatRound(round: number): string {
  invariant(Number.isInteger(round), 'formatRound requires an integer round');
  invariant(round >= MIN_ROUND && round <= MAX_ROUND, 'formatRound round out of range');

  const lastTwo = round % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${round}th`;
  }
  switch (round % 10) {
    case 1:
      return `${round}st`;
    case 2:
      return `${round}nd`;
    case 3:
      return `${round}rd`;
    default:
      return `${round}th`;
  }
}
