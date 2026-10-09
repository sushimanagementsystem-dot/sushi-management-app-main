# TESTING.md

## `nest-backend/` — vitest + oxlint

- Unit tests: `npm test` (vitest, `src/**/*.spec.ts`). **45 spec files** confirmed present as of
  this audit (`find src -name "*.spec.ts" | wc -l`), spread across almost every module:
  `common/`, `dashboard/*` (action-inbox, audit-log, audit-result, bulk-import, data-tables,
  help-content, invoices-list, issues, kpi, product-prices, profit, reports, staff-food-report,
  stock-variances, submissions-monitor), `forms/food-waste`, `forms/fridge-count`,
  `pipeline/processors/monthly-audit`, `production-engine/*` (anthropic-config, invoice-ai,
  production-email, production-engine), `purchasing/*`, `secrets/`, `upload/`.
- E2E: `npm run test:e2e` (separate vitest config, `vitest.config.e2e.ts`) — **one** spec file,
  `test/app.e2e-spec.ts`.
- Lint: `npm run lint` (`oxlint src/ test/`).
- Single-file/single-test runs: `npx vitest run src/<path>.spec.ts` (add `-t "name"` for one
  test) — per root `CLAUDE.md`, confirmed consistent with the `vitest` tooling present.

Root `CLAUDE.md`'s claim that coverage is "currently thin (one `.spec.ts`, one `.e2e-spec.ts`)"
is **stale** — see `KNOWN_ISSUES.md`. Actual unit coverage is broad (45 files) relative to the
module count, though no code-coverage percentage was measured in this pass (`test:cov` exists —
`vitest run --coverage` — but wasn't run read-only here since it executes the suite).

## `frontend-next/` — no test runner configured

`package.json` has no `test` script and no test framework in `dependencies`/`devDependencies`.
`npm run lint` (`next lint`) is the only automated check available for this half. This matches
root `CLAUDE.md`'s statement and was independently confirmed from `package.json`.
