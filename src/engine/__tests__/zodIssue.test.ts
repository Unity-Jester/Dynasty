import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { firstZodIssueMessage } from '../zodIssue';

describe('firstZodIssueMessage', () => {
  it("returns the first issue's message", () => {
    const schema = z.object({ n: z.number().int().min(4, 'too few teams') });
    const result = schema.safeParse({ n: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstZodIssueMessage(result.error)).toBe('too few teams');
    }
  });

  it('reports the first of several issues', () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    const result = schema.safeParse({ a: 1, b: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
      expect(firstZodIssueMessage(result.error)).toBe(result.error.issues[0].message);
    }
  });
});
