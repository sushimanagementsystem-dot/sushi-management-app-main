# ARCHITECTURE.md

## Shape

Two deployable apps, no shared package, talking over HTTP:

```
frontend-next (Next.js, browser)  --fetch-->  nest-backend (NestJS, HTTP API)  --Prisma-->  Postgres (Neon)
                                                      |
                                                      +--> Anthropic API (invoice line-item extraction)
                                                      +--> Google OAuth token verification (login)
                                                      +--> nodemailer (production-plan / purchasing / audit emails)
```

`frontend-next`'s `lib/api.js` posts to `${NEXT_PUBLIC_BACKEND_URL}/${action}` — **one HTTP
route per action** (e.g. `POST /submit`, `POST /login`), not a single dispatch endpoint. This
mirrors nest-backend's actual routing: confirmed from `src/app.module.ts`'s module list and the
33 `*.controller.ts` files under `nest-backend/src/` (see `API.md` for the full list).

## Backend module boundaries (`nest-backend/src/`)

One module per concern, each owning its own controller(s)/service(s)/DTOs:

- `auth/` — login (Google ID token → session JWT), session verification.
- `kiosk/` — kiosk-token-gated bootstrap data.
- `reference-data/` — shared lookup data (enum options, etc.) for forms/dashboard.
- `forms/` — shared `submit` route (`forms.controller.ts`) + one subfolder per staff form
  (`food-waste/`, `fridge-count/`, `weekly-stocktake/`, `monthly-audit/`, `morning-waste/`,
  `move-stock/`, `staff-food/`, `help-issue/`, `damaged-product/`, `delivery-invoice/`,
  `audit-correction/` — 11 forms, matching the 11 legacy `FormXxx.js` files that used to exist).
- `pipeline/` — the async submission queue (`submission.service.ts`) + one processor per form
  type under `pipeline/processors/` (mirrors the legacy `api/Pipeline.js` sweep model).
- `production-engine/` — production-plan computation, secondary-item allocation, invoice AI
  (`anthropic-config.service.ts`, `invoice-ai.service.ts`), production-plan email.
- `purchasing/` — `purchasing-scan.service.ts` (triggers itself after stocktake confirmation,
  builds supplier order `.xlsx`, emails the owner), order email.
- `dashboard/` — one subfolder per dashboard area: `data-tables/` (generic CRUD grid engine,
  config-driven via `TableSchema`/`FieldSchema`), `action-inbox/`, `kpi/`, `settings/`,
  `site-config/` (AI key/model config, encrypted secrets), `bulk-import/`, `audit-log/`,
  `audit-result/`, `invoices-list/`, `issues/`, `kiosk-task-status/`, `product-prices/`,
  `profit/`, `reports/`, `staff-food-report/`, `stock-variances/`, `submissions-monitor/`.
- `upload/` — file upload handling (photos/videos from kiosk forms).
- `import/` — one-off Excel/Sheet import tooling (`import-database.controller.ts`,
  `import.controller.ts`) — used for the original data migration and Evan's data reconciliation
  (see `final_changes_plan.md`), not part of normal runtime traffic.
- `secrets/` — `SecretsService`: AES-256-GCM encryption for secrets stored in the DB (API keys),
  keyed from `SECRETS_ENCRYPTION_KEY` or derived from `SESSION_JWT_SECRET`.
- `mailer/` — nodemailer wrapper used by production-engine/purchasing/dashboard email features.
- `prisma/` — `PrismaService`, wraps a long-lived `pg.Pool` (`idleTimeoutMillis: 0`) specifically
  to avoid Neon's compute-suspend wake latency between requests — do not simplify to a bare
  connection string (this is called out directly in the code).
- `common/` — guards (`SessionAuthGuard`, `RolesGuard`, `KioskTokenGuard`), decorators
  (`@Public()`, `@Roles()`, `@CurrentUser()`, `@CurrentKiosk()`), the global response-envelope
  interceptor, and the global HTTP exception filter.

Cross-cutting: `ResponseEnvelopeInterceptor` and `HttpExceptionFilter` are registered globally in
`app.module.ts` (`APP_INTERCEPTOR`/`APP_FILTER`) — every response is normalized there, not by
individual handlers.

## Frontend structure (`frontend-next/`)

- `app/[slug]/...` — kiosk-facing pages, one route per form, dynamic `[slug]` segment carries
  kiosk identity (same URL-is-identity model the old static site used).
- `app/dashboard/...` — one route per dashboard area, mirroring the backend's `dashboard/`
  subfolders (e.g. `app/dashboard/stock-variances` ↔ `dashboard/stock-variances/`).
- `app/login`, `app/enter`, `app/forbidden` — auth flow pages.
- `app/api/process-now/` — Next.js route handler equivalent of the old Vercel serverless
  relay; fires after a kiosk form submit so processing continues even if the tab closes.
- `lib/api.js` — `apiCall()`: posts to the backend, auto-attaches/re-stores the session token.
- `lib/store/useAuthStore.js` — Zustand store: session token, per-kiosk tokens, allowed-slug
  cache. Components that need to re-render on auth changes use this hook directly rather than
  calling `lib/api.js`'s imperative helpers.
- `lib/queries.js` — TanStack Query hooks for data fetching.
- `proxy.js` — Next middleware-equivalent; lowercases kiosk slugs before routing (tokens are
  stored under `kiosk_id.toLowerCase()`); `RESERVED_SEGMENTS` is the literal-before-catch-all
  guard against a new top-level route name being misread as a kiosk slug.

## Request flow: kiosk form submit

1. Staff fills a form at `/[slug]/<form>` → `apiCall("submit", payload)`.
2. `nest-backend`'s `KioskTokenGuard` validates the kiosk token (no session required at this
   point — staff haven't logged in as a user for kiosk-only actions).
3. `forms.controller.ts`'s `submit` route writes a row to the `Submission` queue table
   (`pipeline/submission.service.ts`) rather than processing inline.
4. The frontend also calls `app/api/process-now` right after a successful submit — a
   fire-and-forget nudge that hits the backend server-side so processing starts immediately
   instead of waiting for the scheduled sweep (`@nestjs/schedule` — confirmed import in
   `app.module.ts`). The sweep is always the fallback if the nudge fails.
5. The matching processor in `pipeline/processors/` runs, writing the real domain rows
   (`StocktakeHeader`/`StocktakeLine`, `FridgeCount`, `StaffFood`, etc.) and, for stocktake,
   triggering `purchasing-scan.service.ts`.

## Request flow: owner dashboard action

1. Dashboard page calls an action (e.g. `data_tables` CRUD, `action_inbox` review).
2. `SessionAuthGuard` verifies the session JWT and re-checks the user is still active (global
   guard — every route is session-gated by default; opt out with `@Public()`).
3. `RolesGuard` checks `@Roles(...)` metadata if the route declares it; routes with none are
   accessible to any authenticated user regardless of role.
4. Handler reads/writes via Prisma; `ResponseEnvelopeInterceptor` shapes the response.
