/**
 * Runtime assertion for states that should be impossible (CODING_STANDARDS.md Rule 5).
 * Trust-boundary validation belongs to zod schemas, not this helper.
 */
export class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant violated: ${message}`);
    this.name = "InvariantError";
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new InvariantError(message);
  }
}
