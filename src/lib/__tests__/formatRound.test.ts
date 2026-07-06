import { describe, expect, it } from 'vitest';
import { formatRound } from '@/lib/formatRound';

describe('formatRound', () => {
  it('formats 1-3 with the irregular suffixes', () => {
    expect(formatRound(1)).toBe('1st');
    expect(formatRound(2)).toBe('2nd');
    expect(formatRound(3)).toBe('3rd');
  });

  it('formats 4 and up with th', () => {
    expect(formatRound(4)).toBe('4th');
    expect(formatRound(5)).toBe('5th');
    expect(formatRound(10)).toBe('10th');
  });

  it('keeps th through the teens (11-13 are not 11st/12nd/13rd)', () => {
    expect(formatRound(11)).toBe('11th');
    expect(formatRound(12)).toBe('12th');
    expect(formatRound(13)).toBe('13th');
  });

  it('resumes irregular suffixes after the teens', () => {
    expect(formatRound(21)).toBe('21st');
    expect(formatRound(22)).toBe('22nd');
    expect(formatRound(23)).toBe('23rd');
    expect(formatRound(24)).toBe('24th');
    expect(formatRound(30)).toBe('30th');
  });

  it('throws on out-of-range or non-integer input', () => {
    expect(() => formatRound(0)).toThrow();
    expect(() => formatRound(31)).toThrow();
    expect(() => formatRound(-1)).toThrow();
    expect(() => formatRound(1.5)).toThrow();
  });
});
