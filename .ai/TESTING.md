# TESTING.md

## Legacy stack

None. No package.json, no test framework, no build step — per `CLAUDE.md`. Verification is
manual (open the HTML directly, or push to Vercel and look).

## New stack

### `nest-backend` — Vitest, unit + e2e, confirmed real coverage

- `npm test` → `vitest run` (config: `vitest.config.ts`, includes `**/*.spec.ts`).
- `npm run test:e2e` → separate config (`vitest.config.e2e.ts`, includes `**/*.e2e-spec.ts`,
  `test/` dir).
- `npm run test:cov` — coverage via `@vitest/coverage-v8`.
- `npm run test:debug` — `vitest --inspect-brk --no-file-parallelism`.
- Single file: `npx vitest run src/path/to/file.spec.ts` (add `-t "test name"` for one test).
- **Verified count (2026-10-08): 47 `*.spec.ts` files.** This is real, substantive coverage, not
  token — most service classes have a matching spec.
- `npm run lint` → `oxlint src/ test/`.
- `npx tsc --noEmit` for a standalone typecheck (not wired into `npm test`, run separately).

### Unit test convention — hand-constructed mocks, no DI container, no test DB

Every `*.spec.ts` seen follows the same shape: a local `build(opts)` helper that constructs a
plain-object mock for each injected dependency (`prisma`, `tableCache`, `ownerActionState`,
etc.) with just the methods the test needs, `as never`-cast past TypeScript, then
`new RealService(...mocks)`. No `@nestjs/testing`'s `Test.createTestingModule` pattern was
observed in the specs inspected this pass (though `@nestjs/testing` is a declared dev
dependency) — UNKNOWN whether any spec uses it; if writing a new spec, match the prevailing
hand-constructed-mock style already established in the file you're adding tests near, not a
module-based style introduced fresh.

**Consequence worth remembering**: when a service's constructor gains a new dependency, every
existing spec's `build()` helper that constructs that service breaks with "Expected N arguments,
but got M" — this is expected, not a sign something else is wrong; update each affected mock.

### e2e

`test/*.e2e-spec.ts` — a real `supertest`-driven HTTP test against a running Nest app instance
(not just unit-level). Only a small number of these exist (one was mentioned as "thin coverage"
in project history) — treat e2e coverage as much lighter than unit coverage.

### Live-data verification — the pattern actually used for destructive/mutating changes

Not an automated test, but the established verification method before calling a risky change
done, seen repeatedly in session history:
1. Mint a short-lived session JWT (`SESSION_JWT_SECRET`, see `API.md`/`AUTH.md`).
2. Create throwaway rows, always prefixed `ZTEST` (e.g. `staff_invoice_number: "ZTEST-CORRECT-1"`)
   so they're unambiguously identifiable as test data if something goes wrong.
3. Call the real endpoint against the real live database via `curl`.
4. Query the database directly afterward to confirm the exact expected state (not just that the
   HTTP call returned `ok: true`).
5. **Always clean up** — delete the throwaway rows and re-query to confirm they're actually
   gone.
See `TASK_PROTOCOL.md` for the full workflow this fits into.

### `frontend-next`

**No test runner configured** — confirmed, no `test` script in `package.json`, no testing
library in `devDependencies`. `npm run lint` → `next lint` is the only automated check.
Verification in practice: start the dev server, `curl` the page and grep its HTML for
`"Failed to compile"`/`"SyntaxError"` (a compile-error smoke check, not a correctness check),
and — per `UI_RULES.md` — a real visual check at both desktop and mobile viewports before
calling a UI task done (via `claude-in-chrome` browser automation when the extension is
connected; explicitly flag to the user when it isn't, rather than claiming visual verification
that didn't happen).
