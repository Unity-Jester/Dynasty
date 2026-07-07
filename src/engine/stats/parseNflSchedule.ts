import { invariant } from '@/lib/invariant';
import { parseCSVLine } from '@/lib/utils';

// nflverse's `schedules` release (games.csv/.gz) spans every season since
// 1999 in one file; 7,550 rows observed live 2026-07-06. 10k is generous
// headroom and still a hard cap (Rule 2/3): exceeding it is a "source
// changed shape" signal, not routine growth.
const MAX_SCHEDULE_ROWS = 10_000;

export interface NflGameEntry {
  season: number;
  week: number;
  nflTeam: string;
  kickoffIso: string;
}

export interface ParseScheduleResult {
  games: NflGameEntry[];
  skipped: number;
}

// nflverse's schedule team codes are not always identical to ours (verified
// live 2026-07-06 against `players.nfl_team`): nflverse uses the bare `LA`
// for the Rams where our `players` table (sourced from Sleeper) uses `LAR`.
// This is the one live mismatch for the current 32-team league; nflverse
// also uses historical codes for relocated/renamed franchises in old
// seasons (e.g. `OAK`/`SD`/`STL`), which are out of scope for lineup locks
// on any season we'd actually run (no active roster plays for a defunct
// code) but are mapped here too for completeness and so a future
// wider-range query doesn't silently mismatch.
const TEAM_CODE_MAP: ReadonlyMap<string, string> = new Map([
  ['LA', 'LAR'], // Rams
  ['OAK', 'LV'], // Raiders, pre-2020 relocation
  ['SD', 'LAC'], // Chargers, pre-2017 relocation
  ['STL', 'LAR'], // Rams, pre-2016 relocation
]);

// Normalize an nflverse team code to our players.nfl_team convention. Total:
// codes not in the map pass through unchanged (the common case — 31 of 32
// current codes already match).
function normalizeTeamCode(code: string): string {
  return TEAM_CODE_MAP.get(code) ?? code;
}

// Convert an nflverse (gameday, gametime) pair — wall-clock US/Eastern by
// nflverse convention — to a UTC ISO-8601 string. No TZ database library:
// Intl.DateTimeFormat with timeZone 'America/New_York' gives us the
// Eastern-local rendering of a UTC instant, so we use the standard two-pass
// trick: (1) format the target wall-clock as if it were UTC to get a rough
// instant, (2) ask Intl what US/Eastern time THAT instant renders as, then
// (3) shift by the difference between the wall-clock we want and what we
// got back. The delta between passes is exactly the zone's current UTC
// offset (accounting for DST automatically, since Intl derives it from the
// IANA tz database for the specific date) — this converges in one
// correction because US zone offsets are whole hours only.
export function easternToUtcIso(dateStr: string, timeStr: string): string {
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(dateStr), 'dateStr must be YYYY-MM-DD');
  invariant(/^\d{2}:\d{2}$/.test(timeStr), 'timeStr must be HH:MM');

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Pass 1: treat the wall-clock as if it were already UTC (a guess).
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Ask what wall-clock time that guessed instant renders as in US/Eastern.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(guessMs));
  const byType: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') byType[part.type] = part.value;
  }
  const easternMs = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second),
  );

  // The guess rendered `easternMs` as its Eastern wall-clock; the true UTC
  // instant is offset from the guess by exactly how far off that rendering
  // was from the wall-clock we actually wanted.
  const correctedMs = guessMs + (guessMs - easternMs);
  return new Date(correctedMs).toISOString();
}

interface HeaderIndices {
  seasonIdx: number;
  weekIdx: number;
  gamedayIdx: number;
  gametimeIdx: number;
  homeIdx: number;
  awayIdx: number;
}

function findHeaderIndices(header: readonly string[]): HeaderIndices | null {
  const idx: HeaderIndices = {
    seasonIdx: header.indexOf('season'),
    weekIdx: header.indexOf('week'),
    gamedayIdx: header.indexOf('gameday'),
    gametimeIdx: header.indexOf('gametime'),
    homeIdx: header.indexOf('home_team'),
    awayIdx: header.indexOf('away_team'),
  };
  const allPresent =
    idx.seasonIdx !== -1 &&
    idx.weekIdx !== -1 &&
    idx.gamedayIdx !== -1 &&
    idx.gametimeIdx !== -1 &&
    idx.homeIdx !== -1 &&
    idx.awayIdx !== -1;
  return allPresent ? idx : null;
}

interface RowFields {
  week: number;
  gameday: string;
  gametime: string;
  homeTeam: string;
  awayTeam: string;
}

// Extract + validate the fields rowToGames needs. Split out purely to keep
// rowToGames' cyclomatic complexity under the Rule 1 ceiling.
function extractRowFields(fields: readonly string[], idx: HeaderIndices): RowFields | null {
  const week = Number(fields[idx.weekIdx]);
  const gameday = fields[idx.gamedayIdx] ?? '';
  const gametime = fields[idx.gametimeIdx] ?? '';
  const homeTeam = fields[idx.homeIdx] ?? '';
  const awayTeam = fields[idx.awayIdx] ?? '';
  const valid =
    Number.isInteger(week) &&
    gameday.length > 0 &&
    gametime.length > 0 &&
    homeTeam.length > 0 &&
    awayTeam.length > 0;
  return valid ? { week, gameday, gametime, homeTeam, awayTeam } : null;
}

// One CSV data row -> zero or two NflGameEntry (home + away), or a skip.
// Returns null when the row should be skipped (blank/missing gametime is
// the documented "TBD game" case; nflverse leaves it blank rather than
// omitting the row).
function rowToGames(fields: readonly string[], idx: HeaderIndices, season: number): NflGameEntry[] | null {
  if (Number(fields[idx.seasonIdx]) !== season) return null;

  const row = extractRowFields(fields, idx);
  if (row === null) return null;

  const kickoffIso = easternToUtcIso(row.gameday, row.gametime);
  return [
    { season, week: row.week, nflTeam: normalizeTeamCode(row.homeTeam), kickoffIso },
    { season, week: row.week, nflTeam: normalizeTeamCode(row.awayTeam), kickoffIso },
  ];
}

// Parse nflverse's `schedules` CSV (games.csv/.gz) into per-team kickoff
// entries for the requested season only. Each matching data row emits TWO
// entries (home_team + away_team, sharing the same UTC kickoff). Rows with a
// missing/blank gametime (TBD games) are skipped and counted, never guessed.
// Bounded by MAX_SCHEDULE_ROWS (Rule 2/3): a file that large signals a
// source shape change, not routine growth, and is rejected wholesale rather
// than silently truncated.
export function parseNflSchedule(csvText: string, season: number): ParseScheduleResult {
  invariant(typeof csvText === 'string', 'csvText must be a string');
  invariant(Number.isInteger(season) && season >= 1900 && season <= 2100, 'season outside sane window');

  const lines = csvText.split('\n').filter((l) => l.length > 0);
  if (lines.length <= 1) return { games: [], skipped: 0 };
  invariant(lines.length - 1 <= MAX_SCHEDULE_ROWS, `schedule CSV exceeds MAX_SCHEDULE_ROWS (${lines.length - 1})`);

  const header = parseCSVLine(lines[0] ?? '');
  const idx = findHeaderIndices(header);
  if (idx === null) return { games: [], skipped: 0 };

  const games: NflGameEntry[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCSVLine(lines[i] ?? '');
    if (Number(fields[idx.seasonIdx]) !== season) continue;
    const entries = rowToGames(fields, idx, season);
    if (entries === null) {
      skipped += 1;
      continue;
    }
    games.push(...entries);
  }

  invariant(games.length % 2 === 0, 'schedule parse emitted an odd number of team entries');
  invariant(games.every((g) => g.season === season), 'emitted a game entry outside the requested season');

  return { games, skipped };
}
