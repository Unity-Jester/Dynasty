// Shared "which NFL week are we in" helpers. Extracted from the lineup page's
// query module (Phase 7) so server actions — trades, waivers — derive the
// current week from the same source of truth (nfl_games kickoffs) as the
// lineup editor, rather than importing from a page directory.
//
// Deliberately PURE: they take a `fetchWeekKickoffs` reader so callers can
// wire them to either the pooled db (getKickoffs) or an in-transaction read,
// and so they are unit-testable without a database. No 'server-only' banner
// for the same reason (the DB wiring lives at the call sites).

// The regular season is weeks 1..(startWeek - 1); bounded by the NFL week
// ceiling used elsewhere (Rule 2).
const MAX_WEEKS_TO_SCAN = 18;

type FetchWeekKickoffs = (week: number) => Promise<ReadonlyMap<string, string>>;

/**
 * Shared scan: the first week in [1, lastRegularWeek] whose kickoffs are not
 * ALL in the past (i.e. still has at least one game yet to start, or has no
 * games recorded yet — July has none, so week 1 is "open"). Returns null when
 * EVERY regular-season week has fully kicked off. Bounded loop over a fixed,
 * small week range (Rule 2); `fetchWeekKickoffs` is called at most
 * MAX_WEEKS_TO_SCAN times.
 */
async function scanForOpenWeek(
  lastRegularWeek: number,
  now: Date,
  fetchWeekKickoffs: FetchWeekKickoffs,
): Promise<number | null> {
  const cap = Math.min(lastRegularWeek, MAX_WEEKS_TO_SCAN);
  for (let week = 1; week <= cap; week += 1) {
    const kickoffs = await fetchWeekKickoffs(week);
    if (kickoffs.size === 0) {
      return week; // no games recorded yet — treat as open
    }
    let allPast = true;
    for (const iso of kickoffs.values()) {
      if (new Date(iso).getTime() > now.getTime()) {
        allPast = false;
        break;
      }
    }
    if (!allPast) {
      return week;
    }
  }
  return null;
}

/**
 * The default week for the lineup editor to land on. Falls back to week 1
 * when every regular-season week has fully kicked off (the page must still
 * render SOMETHING); trade logic must NOT use this fallback — see
 * currentTradeWeek.
 */
export async function firstOpenWeek(
  lastRegularWeek: number,
  now: Date,
  fetchWeekKickoffs: FetchWeekKickoffs,
): Promise<number> {
  const open = await scanForOpenWeek(lastRegularWeek, now, fetchWeekKickoffs);
  return open ?? 1;
}

/**
 * The current week as trade logic sees it: same scan as firstOpenWeek, but a
 * fully-kicked-off regular season resolves to lastRegularWeek + 1 ("past every
 * regular week") instead of wrapping to week 1. Two money-path behaviors hang
 * on this distinction:
 *  - the trade deadline (currentWeek > deadlineWeek) stays PASSED after the
 *    regular season ends, rather than silently reopening as "week 1";
 *  - the lineup-cleanup window (weeks >= currentWeek) becomes empty for a
 *    finished season instead of nulling the whole season's lineup history.
 */
export async function currentTradeWeek(
  lastRegularWeek: number,
  now: Date,
  fetchWeekKickoffs: FetchWeekKickoffs,
): Promise<number> {
  const open = await scanForOpenWeek(lastRegularWeek, now, fetchWeekKickoffs);
  return open ?? lastRegularWeek + 1;
}
