# TASK_PROTOCOL.md

How to approach a new task in this repo, based on how work has actually been done here
successfully. Not a rigid checklist to recite — a default sequence to deviate from deliberately,
not by accident.

## 0. Figure out which stack

Confirm the task targets `nest-backend`/`frontend-next` (the default — see `PROJECT.md`'s scope
convention) before writing any code. If a request seems to need the legacy stack, confirm that
explicitly rather than assuming — and remember the legacy stack's source is currently absent
from the working directory (`git show HEAD:backend/...` to read it; see `KNOWN_ISSUES.md`).

## 1. Read before writing

`.ai/README.md`'s table points at the right doc for the task shape. Read the specific doc(s),
then open the actual relevant source file(s) — treat `.ai/` as a map, not a substitute for
reading the code you're about to change. If `.ai/` and the code disagree, the code wins; fix the
doc (see `README.md`'s freshness rule).

## 2. When asked to "check first, don't fix yet"

A real, recurring instruction shape in this project. When given it:
- Investigate the actual code and, where relevant, the **live database** (read-only queries) —
  not assumptions, not pattern-matching to "how this usually works" in other NestJS/Next.js
  apps.
- Explain the finding in plain, concrete terms (what's actually happening, why, whether it's a
  bug or deliberate design) before proposing or making any change.
- Wait for explicit go-ahead before implementing.

## 3. Implementing

- Prefer the narrowest fix that respects the "don't rewrite posted history" boundary (see
  `CONVENTIONS.md`) where money/stock data is involved — check whether a real `stock_movement`
  has already posted before deciding whether in-place editing is safe or a new correcting entry
  is needed.
- Match existing patterns exactly (DTO shape, controller route naming, service/DTO file layout,
  comment style — see `CONVENTIONS.md`) rather than introducing a new shape for the same kind of
  thing.
- For any UI change: `UI_RULES.md` applies, no exceptions — desktop AND mobile, every time.

## 4. Verifying (new stack)

In order of cost/thoroughness, all of which have been used together on real changes here:
1. `npx tsc --noEmit` (nest-backend) — typecheck. Known pre-existing failures exist in
   unrelated files (e.g. a `supertest/types` resolution issue in `test/app.e2e-spec.ts`) — don't
   treat those as caused by your change; confirm by checking whether they existed before your
   edit.
2. `npm test` (nest-backend) — full Vitest suite. As of 2026-10-08, 47 spec files, real
   coverage. Add a spec for new service logic, following the hand-constructed-mock `build()`
   pattern already used in neighboring spec files (see `TESTING.md`).
3. Live-data verification for anything that writes to the real database or calls a real
   endpoint: mint a short-lived session JWT, use `ZTEST`-prefixed throwaway rows, call the real
   endpoint, **query the database directly afterward** to confirm the exact resulting state (not
   just `ok: true`), then delete the throwaway rows and confirm they're gone. See `TESTING.md`/
   `API.md` for the exact commands.
4. For `frontend-next`: start the dev server, `curl` the affected page and grep for
   `"Failed to compile"`/`SyntaxError` as a cheap compile-smoke-check, then — if browser
   automation is available — a real visual check at desktop and mobile viewports. If it isn't
   available, say so explicitly rather than claiming visual verification happened.

## 5. Reporting back

Concise, outcome-focused, no filler — this is an explicit standing preference for this project
(see the maintainer's session memory: `feedback_concise_replies`). State what changed, how it
was verified, and anything still open or unverified — don't pad with restated context the
reader already has.

## 6. Keep `.ai/` current

If the task surfaced a new gotcha, resolved a known issue, or made a decision worth remembering,
update the relevant `.ai/` file (`KNOWN_ISSUES.md`, `DECISIONS.md`, `CHANGELOG.md` are the most
common targets) in the same pass, not as a separate follow-up that may never happen.
