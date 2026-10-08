# FILE_STRUCTURE.md

Verified against the actual working tree on 2026-10-08. For narrative description of what each
piece does, see `CLAUDE.md` (legacy stack, authoritative) and `BACKEND.md`/`FRONTEND.md` (new
stack, this doc set).

```text
sushi-management-app-main/
├── CLAUDE.md                 Primary architecture doc — read first
├── UI_RULES.md                Mandatory desktop+mobile verification rules for UI work
├── README.md                  UNKNOWN — needs inspection: brief repo README, not read in full this pass
├── final_changes_plan.md      Dated client-specific planning doc (not living docs)
├── How the System Works.docx  UNKNOWN content — binary, not inspected this pass
├── deploy.sh                  Legacy-stack deploy script (clasp push + Vercel auto-deploy)
├── skills-lock.json           UNKNOWN purpose — not inspected this pass
├── .agents/skills/            UNKNOWN purpose — not inspected this pass
├── .claude/                   Claude Code project-local settings/config
├── .ai/                       This knowledge base
│
├── backend/                   LEGACY — Google Apps Script. Tracked in git HEAD but currently
│                               ABSENT from this working directory (60 files locally deleted,
│                               uncommitted — see KNOWN_ISSUES.md). Structure per CLAUDE.md:
│                               core/ (Config, DAL, Util, Auth, Upload), api/ (Api, Deploy,
│                               Pipeline), forms/ (11 staff forms), engine/ (production plan +
│                               email), dashboard/ (DataTables.js grid engine, etc.)
│
├── frontend/                   LEGACY — static site. Same absent-from-disk caveat as backend/.
│                               Structure per CLAUDE.md: vercel.json, api/process-now.js,
│                               assets/ (common.js, dashboard-common.js), pages/{auth,kiosk,
│                               dashboard}/
│
├── nest-backend/               NEW — NestJS + Prisma + Postgres. Present and active.
│   ├── src/
│   │   ├── main.ts             Bootstrap: CORS, 25mb body limit, global ValidationPipe
│   │   ├── app.module.ts       Root module — registers global guards/interceptor/filter
│   │   ├── app.controller.ts
│   │   ├── auth/                Login (Google ID token exchange), session JWT mint/verify
│   │   ├── common/               decorators/, guards/, filters/, interceptors/, shared utils
│   │   │                         (stock-balance.util.ts, prisma-delegate.util.ts, date.util.ts,
│   │   │                         product.util.ts, write-error.ts, purchasing-trigger.util.ts)
│   │   ├── prisma/                PrismaService, PrismaModule
│   │   ├── secrets/                UNKNOWN — needs inspection: likely encrypted-secret storage
│   │   │                          (SecretsModule referenced in app.module.ts)
│   │   ├── reference-data/         TableCacheService, EnumOptionService
│   │   ├── mailer/                  Email sending
│   │   ├── upload/                   File upload handling, serves /uploads/:id
│   │   ├── kiosk/                     Kiosk identity/info resolution
│   │   ├── pipeline/                   Async submission queue + processors/ (one per form type)
│   │   ├── forms/                       One subfolder per staff-facing form (see below) + dto/
│   │   ├── production-engine/            Production plan computation, invoice AI, email render
│   │   ├── purchasing/                    Purchasing scan / recommendation logic
│   │   ├── dashboard/                      One subfolder per dashboard area (see below)
│   │   └── import/                          One-off Excel/DB bulk import tooling
│   ├── prisma/
│   │   ├── schema.prisma         49 models, 0 enums — see DATABASE.md
│   │   └── migrations/            Hand-written + prisma-generated migration history
│   ├── test/                       e2e specs (*.e2e-spec.ts)
│   ├── vitest.config.ts            Unit test config (**/*.spec.ts)
│   ├── vitest.config.e2e.ts        e2e test config
│   └── package.json
│
├── frontend-next/               NEW — Next.js App Router. Present and active.
│   ├── app/
│   │   ├── [slug]/                Kiosk routes — one dir per staff form (food-waste,
│   │   │                          fridge-count, move-stock, morning-waste, damaged-product,
│   │   │                          staff-food, weekly-stocktake, monthly-audit,
│   │   │                          audit-corrections, delivery-invoices, help-issues, home)
│   │   ├── dashboard/              Owner dashboard pages — one dir per area (inbox, invoices,
│   │   │                           tables, kpi-ish pages: stock-usage, stock-variances, profit,
│   │   │                           reports, product-prices, staff-food, kiosk-comparison,
│   │   │                           submissions, issues, audits, settings, site-config,
│   │   │                           upload-data)
│   │   ├── api/process-now/        Next.js equivalent of legacy frontend/api/process-now.js
│   │   ├── enter/, login/, forbidden/   Auth-adjacent pages
│   │   └── layout.js, globals.css, etc.
│   ├── components/
│   │   ├── kiosk/                  Shared kiosk-form building blocks (LineCard, PhotoBox,
│   │   │                           KioskTopbar, Wrap, StickyActionBar, FormBits)
│   │   ├── dashboard/               Dashboard building blocks, incl. dashboard/tables/
│   │   │                            DataTablesController.js (vanilla-DOM Tabulator grid, not
│   │   │                            React — see FRONTEND.md)
│   │   ├── SearchPick.js, PageTitle.js, ConfirmModal.js, EvidencePreview.js, etc.
│   ├── lib/
│   │   ├── api.js                   apiCall(), BACKEND_URL, upload compression, kiosk-token
│   │   │                            helpers
│   │   ├── store/useAuthStore.js    Zustand auth state (session token, per-kiosk tokens,
│   │   │                            allowed-slug cache), persisted to localStorage
│   │   ├── queries.js                TanStack Query hooks (useBootstrap, useApiMutation)
│   │   └── help/content.js            In-app help text content
│   ├── proxy.js                       Next.js middleware-equivalent — lowercases kiosk slugs,
│   │                                   RESERVED_SEGMENTS = {api, dashboard, enter, forbidden,
│   │                                   login} (add any new top-level route name here)
│   ├── AGENTS.md / CLAUDE.md           Auto-generated Next.js boilerplate notice only — no
│   │                                   project-specific content (regenerated by `next dev`)
│   └── package.json
```

## Dashboard submodules (`nest-backend/src/dashboard/`)

`action-inbox/`, `audit-log/`, `audit-result/`, `bulk-import/`, `data-tables/`,
`invoices-list/`, `issues/`, `kiosk-task-status/`, `kpi/`, `product-prices/`, `profit/`,
`reports/`, `settings/`, `site-config/`, `staff-food-report/`, `stock-variances/`,
`submissions-monitor/`.

## Form submodules (`nest-backend/src/forms/`)

`audit-correction/`, `damaged-product/`, `delivery-invoice/`, `food-waste/`, `fridge-count/`,
`help-issue/`, `monthly-audit/`, `morning-waste/`, `move-stock/`, `staff-food/`,
`weekly-stocktake/`, plus a shared `dto/`. (11 form areas — matches the legacy stack's "11
staff-facing forms" count per `CLAUDE.md`.)
