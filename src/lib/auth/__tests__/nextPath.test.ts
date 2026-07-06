import { describe, it, expect } from 'vitest';
import { safeNextPath } from '../nextPath';

describe('safeNextPath', () => {
  it('accepts a same-origin relative path', () => {
    expect(safeNextPath('/join/abc')).toBe('/join/abc');
  });

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.com')).toBe('/l');
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeNextPath('//evil.com')).toBe('/l');
  });

  it('rejects a backslash escape', () => {
    expect(safeNextPath('/\\evil.com')).toBe('/l');
  });

  it('rejects a javascript: scheme', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/l');
  });

  it('rejects a scheme smuggled after the leading slash', () => {
    expect(safeNextPath('/redirect?url=https://evil.com')).toBe('/l');
  });

  it('falls back for empty string', () => {
    expect(safeNextPath('')).toBe('/l');
  });

  it('falls back for undefined and null', () => {
    expect(safeNextPath(undefined)).toBe('/l');
    expect(safeNextPath(null)).toBe('/l');
  });

  it('rejects paths longer than the cap', () => {
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBe('/l');
  });
});
