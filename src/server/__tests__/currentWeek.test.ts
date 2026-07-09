import { describe, expect, it } from 'vitest';
import { currentTradeWeek, firstOpenWeek } from '@/server/currentWeek';

const NOW = new Date('2026-10-15T17:00:00Z');
const PAST = '2026-09-01T17:00:00Z';
const FUTURE = '2026-12-25T17:00:00Z';

// Builds a fetcher from a per-week kickoff table; weeks absent from the table
// have no games recorded (empty map).
function fetcherFor(table: Record<number, string[]>) {
  const calls: number[] = [];
  const fetch = (week: number): Promise<ReadonlyMap<string, string>> => {
    calls.push(week);
    const isos = table[week] ?? [];
    return Promise.resolve(new Map(isos.map((iso, i) => [`T${week}-${i}`, iso])));
  };
  return { fetch, calls };
}

describe('firstOpenWeek', () => {
  it('returns the first week with a kickoff still in the future', async () => {
    const { fetch } = fetcherFor({ 1: [PAST, PAST], 2: [PAST, FUTURE], 3: [FUTURE] });
    await expect(firstOpenWeek(14, NOW, fetch)).resolves.toBe(2);
  });

  it('treats a week with no games recorded as open (July reality)', async () => {
    const { fetch } = fetcherFor({});
    await expect(firstOpenWeek(14, NOW, fetch)).resolves.toBe(1);
  });

  it('falls back to week 1 when every regular week has fully kicked off', async () => {
    const table: Record<number, string[]> = {};
    for (let w = 1; w <= 14; w += 1) table[w] = [PAST];
    const { fetch } = fetcherFor(table);
    await expect(firstOpenWeek(14, NOW, fetch)).resolves.toBe(1);
  });

  it('never scans past lastRegularWeek', async () => {
    const table: Record<number, string[]> = {};
    for (let w = 1; w <= 18; w += 1) table[w] = [PAST];
    const { fetch, calls } = fetcherFor(table);
    await firstOpenWeek(3, NOW, fetch);
    expect(Math.max(...calls)).toBe(3);
  });
});

describe('currentTradeWeek', () => {
  it('matches firstOpenWeek mid-season', async () => {
    const { fetch } = fetcherFor({ 1: [PAST], 2: [PAST], 3: [PAST, FUTURE] });
    await expect(currentTradeWeek(14, NOW, fetch)).resolves.toBe(3);
  });

  it('resolves a fully-kicked-off season to lastRegularWeek + 1, not week 1', async () => {
    const table: Record<number, string[]> = {};
    for (let w = 1; w <= 14; w += 1) table[w] = [PAST];
    const { fetch } = fetcherFor(table);
    // Deadline stays passed and the lineup-cleanup window stays empty for a
    // finished season — the week-1 wrap is a lineup-page-only convenience.
    await expect(currentTradeWeek(14, NOW, fetch)).resolves.toBe(15);
  });

  it('treats a season with no games recorded as week 1', async () => {
    const { fetch } = fetcherFor({});
    await expect(currentTradeWeek(14, NOW, fetch)).resolves.toBe(1);
  });
});
