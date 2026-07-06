import { describe, it, expect } from 'vitest';
import { normalizeLoginCode } from '../loginCode';

describe('normalizeLoginCode', () => {
  it('accepts a plain 6-digit code', () => {
    expect(normalizeLoginCode('123456')).toBe('123456');
  });

  it('strips internal spaces', () => {
    expect(normalizeLoginCode('123 456')).toBe('123456');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLoginCode('  123456  ')).toBe('123456');
  });

  it('rejects a too-short code', () => {
    expect(normalizeLoginCode('12345')).toBeNull();
  });

  it('rejects a too-long code', () => {
    expect(normalizeLoginCode('1234567')).toBeNull();
  });

  it('rejects letters', () => {
    expect(normalizeLoginCode('12a456')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(normalizeLoginCode('')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizeLoginCode(null)).toBeNull();
    expect(normalizeLoginCode(undefined)).toBeNull();
  });

  it('rejects absurdly long input without normalizing it', () => {
    expect(normalizeLoginCode(` ${'1'.repeat(500)} `)).toBeNull();
  });
});
