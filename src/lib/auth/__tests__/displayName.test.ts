import { describe, it, expect } from 'vitest';
import { displayNameFromEmail } from '../displayName';

describe('displayNameFromEmail', () => {
  it('returns the local part of a normal email', () => {
    expect(displayNameFromEmail('jtyree2@gmail.com')).toBe('jtyree2');
  });

  it('falls back to Manager when the local part is empty', () => {
    expect(displayNameFromEmail('@x.com')).toBe('Manager');
  });

  it('falls back to Manager when there is no @ sign', () => {
    expect(displayNameFromEmail('no-at-sign')).toBe('Manager');
  });

  it('truncates a long local part to 32 characters', () => {
    const local = 'a'.repeat(40);
    const result = displayNameFromEmail(`${local}@example.com`);
    expect(result).toBe('a'.repeat(32));
    expect(result.length).toBe(32);
  });

  it('trims surrounding whitespace from the local part', () => {
    expect(displayNameFromEmail(' spaced @x.com')).toBe('spaced');
  });

  it('falls back to Manager when the local part is only whitespace', () => {
    expect(displayNameFromEmail('   @x.com')).toBe('Manager');
  });
});
