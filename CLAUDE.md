# Dynasty — dynasty-only fantasy football hosting platform

Next.js 14 (App Router) / TypeScript / Tailwind. Evolving from a read-only Sleeper
analytics hub into a full league hosting platform. Requirements spec:
`.ouroboros/seed-dynasty-platform.yaml`. Remote: `Unity-Jester/Dynasty` (branch `master`).

## Commands

- `npm run dev` — dev server
- `npm run check` — tsc + eslint (zero warnings) + tests; **must pass before every commit**
- `npm test` — vitest only

## Coding rules — the Power of Ten, adapted (full text: CODING_STANDARDS.md)

These are mandatory. ESLint enforces what it can; you enforce the rest.

1. **Simple control flow, no recursion.** Complexity ≤ 10, nesting ≤ 3. Rewrite
   recursion as a bounded loop.
2. **Every loop has a fixed upper bound.** Loops over external data get a named `MAX_*`
   cap; exceeding it is an error path. No `while (true)`.
3. **Bounded memory.** Every DB query has a LIMIT; caches have max size + TTL; no
   module-level mutable state; no unbounded accumulation per request.
4. **Small units.** Functions ≤ 60 lines, React components ≤ 150, files ≤ 400. Outgrowing
   a cap means split by responsibility.
5. **Assert what should be impossible.** ≥ 2 runtime checks per non-trivial engine
   function. zod-parse at trust boundaries (never cast external data); `invariant()`
   from `src/lib/invariant.ts` for impossible states.
6. **Smallest scope.** `const` by default, declare at first use, export the minimum.
7. **Check every return.** No floating promises. Engine code returns typed results
   (`ok/err`), callers must branch. Ignoring a value = `void expr` + why-comment.
8. **No metaprogramming.** No eval/codegen; minimal env-flag branching.
9. **Restrict indirection.** No `any`, no `Function` type; prefer `switch` over
   discriminated unions to string-keyed dispatch in engine code.
10. **Zero warnings.** All warnings build-breaking. Rewrite confusing code instead of
    suppressing. `eslint-disable` needs a same-line justification.

Legacy analytics files grandfathered from structural rules are listed in
`.eslintrc.json` overrides — shrink that list when touching those files, never grow it.
