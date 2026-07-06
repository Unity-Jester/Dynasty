import type { z } from 'zod';

/**
 * The message of a ZodError's first issue, for surfacing a single friendly
 * hint at the trust boundary. Falls back to a generic string when the error
 * carries no issues (should be impossible, but never index into an empty list).
 */
export function firstZodIssueMessage(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? first.message : 'Invalid input';
}
