# Dynasty Coding Standards — The Power of Ten, Adapted

These rules adapt NASA/JPL's "Power of Ten" (Holzmann) for safety-critical C to this
TypeScript/Next.js codebase. The goal is the same one the originals serve: every unit of
code should be small, bounded, and verifiable in isolation — by a human, a static
analyzer, or an AI assistant reading it without the rest of the repo in context.

Rules marked **[enforced]** are checked mechanically (ESLint/tsc — see Rule 10).
Rules marked **[review]** rely on code review and AI-session discipline.

---

## 1. Simple control flow; no recursion

No labeled statements or labeled breaks **[enforced]**. No direct or indirect recursion
**[review]** — rewrite as an explicit loop with a bound (Rule 2). Cyclomatic complexity
≤ 10 and nesting depth ≤ 3 per function **[enforced]**. Early returns for error cases are
encouraged.

*Why:* An acyclic call graph plus bounded loops means termination is provable and any
function can be understood top-to-bottom in one pass.

## 2. All loops have a fixed upper bound

Every loop whose iteration count depends on external data (API responses, DB rows,
league history walks, linked structures) must have an explicit numeric cap, declared as
a named `MAX_*` constant, and hitting the cap is an error path — not silent truncation.
`while (true)` and other constant-condition loops are banned **[enforced]**; there are no
legitimately non-terminating loops in a serverless request lifecycle.

```ts
const MAX_LEAGUE_HISTORY_DEPTH = 25; // seasons
for (let i = 0; i < MAX_LEAGUE_HISTORY_DEPTH && cursor; i++) { ... }
if (cursor) return err("league history exceeded MAX_LEAGUE_HISTORY_DEPTH");
```

## 3. Bounded memory: no unbounded accumulation

The GC replaces `malloc`, so the adapted rule is about *growth*: no request may buffer
an unbounded amount of data. Every DB query has a `LIMIT`/pagination. Every in-memory
cache has a max entry count and TTL. External API reads are paginated or capped. Module
scope holds no mutable state (`let`/`var` at module top level is banned **[enforced]**);
per-request state lives on the stack of the request handler.

## 4. Small units: functions ≤ 60 lines, files ≤ 400 lines

Pure logic functions: ≤ 60 lines. React components (JSX is line-hungry): ≤ 150 lines.
Files: ≤ 400 lines. All **[enforced]** (blank lines and comments don't count). If a unit
outgrows the cap, that is a design signal — split by responsibility, don't compress
formatting to sneak under.

*Why:* This is the rule that most directly fights AI code sprawl: every unit stays small
enough to be read, verified, and safely edited within a limited context window.

## 5. Assertion density: validate what should be impossible

Non-trivial engine functions (scoring, waivers, trades, roster legality, draft logic)
average ≥ 2 runtime checks: preconditions, postconditions, and invariants. **[review]**

- **Trust boundaries** (API route inputs, external API responses, anything crossing into
  the engine): validate with `zod` schemas — parse, don't cast.
- **Impossible states** inside the engine: `invariant(cond, msg)` from
  `src/lib/invariant.ts`, which throws `InvariantError`. Route handlers catch it and
  convert to a 500 with the message logged — that is the "explicit recovery action."
- Checks must be side-effect free. The TypeScript type system does not count as a
  runtime check at a trust boundary: external data is `unknown` until parsed.

## 6. Smallest possible scope

`const` by default; `no-var`; no parameter reassignment; no shadowing **[enforced]**.
Declare variables at first use, not at the top of the function. No module-level mutable
state (see Rule 3). Export the minimum surface: if only one file uses it, don't export it.

## 7. Check every return value; validate every input

Promises may not float — every async result is awaited and its failure path handled
**[enforced]**. Engine functions that can fail in expected ways return a typed result
(`{ ok: true, value } | { ok: false, error }`) rather than throwing; callers must branch
on it. Exceptions are reserved for invariant violations (Rule 5). Intentionally ignoring
a value requires the `void` operator plus a comment saying why. Every exported function
validates its parameters (zod at trust boundaries, `invariant` for internal contracts).

## 8. No metaprogramming (the preprocessor rule)

No `eval`, `new Function`, or implied eval **[enforced]**. No runtime code generation.
Environment-variable branching is the moral equivalent of `#ifdef`: keep the total
number of behavior-changing env flags to a handful, document each in `.env.example`,
and never nest them. Type-level programming stays at the level of standard utility
types — no recursive conditional-type puzzles.

## 9. Restrict indirection (the pointer rule)

No `any` — use `unknown` and narrow **[enforced]**. No bare `Function` type
**[enforced]**. React callbacks and array HOFs (`map`/`filter`/`reduce`) are idiomatic
and allowed, but in engine code avoid dynamic dispatch through string-keyed function
tables unless the key type is exhaustively checked; prefer a `switch` over a
discriminated union so control flow is statically traceable. One level of abstraction
over data access (a repository/query layer) — no towers of factories-of-factories.

## 10. Zero warnings, every day

`npm run check` = `tsc --noEmit` + `eslint --max-warnings 0` + `vitest run`, and it must
pass clean before every commit. All warnings are build-breaking. If the compiler or
linter is confused by valid code, rewrite the code to be more trivially valid — do not
suppress. Any `eslint-disable` requires a same-line justification comment and should be
rare enough to enumerate.

---

## Legacy ratchet

The pre-existing analytics code (imported from AGS_Sleeper_Site) predates these rules.
Files listed in the `overrides` block of `.eslintrc.json` are grandfathered for the
*structural* rules (4, and complexity limits of 1) only — correctness rules apply
everywhere. When you touch a grandfathered file, bring it into compliance and remove it
from the list. The list may only shrink.
