# PROJECT.md

## What this is

A sushi-kiosk management system. Staff at individual kiosks submit operational forms (waste
logs, stocktakes, deliveries, stock moves, audits, etc.); an owner/dashboard side reviews,
approves, and manages that data, and drives downstream production planning, purchasing
recommendations, and KPI/profit reporting.

Client context (from in-repo planning docs, e.g. `final_changes_plan.md` at the repo root): the
client is referred to as "Evan" in session/planning notes; kiosks include at least "Limerick",
"Loughrea", "Headford Road" (seen in live Action Inbox data), and a "Sushi Circle"/"YO!" product
brand line. Treat these as real, not placeholder, names.

## Two parallel implementations — read this before touching anything

The repo holds two builds of the same product:

1. **Legacy** (`backend/` + `frontend/`): Google Apps Script backend (`doPost`-only, no
   page-serving code) + a static Vercel-hosted frontend (plain HTML/CSS/JS, no framework), data
   stored in a Google Sheet. This is the stack described in detail in the root `CLAUDE.md`.
2. **Rewrite** (`nest-backend/` + `frontend-next/`): NestJS + Prisma + Postgres (Neon) backend,
   Next.js (App Router) frontend. A route-for-route / table-for-tab port of the legacy stack,
   added in bulk with thin git history and no in-repo migration/cutover doc.

**Important, verified-live caveat (2026-10-08):** `git ls-tree HEAD` shows `backend/` and
`frontend/` as tracked directories, but `git status` in this working copy shows all ~60 files
under `backend/` as locally **deleted, uncommitted** — the files exist in git history but not on
disk right now. This was not something this documentation pass investigated further (out of
scope — docs only) or fixed. See `KNOWN_ISSUES.md`. **Do not assume this means the legacy stack
is being decommissioned** — nothing in the repo says that — and do not stage/commit this
deletion without asking the project owner first.

## Scope convention

Per standing instruction from the project owner: **new work (features, bug fixes) targets
`nest-backend/` + `frontend-next/` only**, unless explicitly asked otherwise. The legacy stack is
treated as the live production system (per `CLAUDE.md`, `deploy.sh` only knows how to deploy it)
but frozen from a "build new things here" perspective. This doc set reflects that priority:
`BACKEND.md`/`FRONTEND.md`/`API.md`/`ENDPOINTS.md` are about the new stack; the legacy stack gets
pointers back to `CLAUDE.md` rather than re-documentation.

## Major technologies

**New stack:**
- Backend: NestJS 12 (Express platform), Prisma 7 (`@prisma/adapter-pg` driver adapter over a
  long-lived `pg.Pool`), Postgres (Neon, serverless — see `ARCHITECTURE.md` for why the pool is
  kept long-lived), TypeScript, Vitest (unit + e2e), oxlint.
- Frontend: Next.js 16.3.3 (App Router), React 19, Zustand (auth state), TanStack Query (data
  fetching), Tailwind CSS, Tabulator (vanilla-DOM data grid for the dashboard's generic tables),
  lucide-react icons.
- AI: Anthropic SDK (`@anthropic-ai/sdk`) — invoice line-item extraction (see
  `INTEGRATIONS.md`).

**Legacy stack:** Google Apps Script (V8 runtime), a Google Sheet as the datastore, Vercel
static hosting + one Vercel serverless function. No package.json, no build step, no test
framework in this half of the repo (per `CLAUDE.md`).

## Package managers / runtimes

- `nest-backend`: npm, Node (uses native `fetch`/ESM — `"type": "module"` in `package.json`).
  TypeScript ^6.0.2 (note: a very new/unusual major — verify this is intentional, not a typo, if
  it ever blocks an install).
- `frontend-next`: npm, Next.js 16.3.3 / React 19.2.0.
- Legacy: no package manager; `clasp` CLI pushes `backend/` to Apps Script directly.

## Entry points

| Stack | Entry point |
|---|---|
| nest-backend | `nest-backend/src/main.ts` (`NestFactory.create(AppModule)`, listens on `PORT` or 3000) |
| frontend-next | Next.js App Router — `frontend-next/app/**/page.js`; kiosk routes are `app/[slug]/...`, dashboard routes are `app/dashboard/...` |
| legacy backend | `backend/api/Api.js`'s `doPost` (per `CLAUDE.md`; file currently absent from working tree, see caveat above) |
| legacy frontend | Static HTML under `frontend/pages/`, routed via `frontend/vercel.json` (per `CLAUDE.md`; also currently absent from working tree) |

## Deployment targets

- New stack: no deploy tooling exists in the repo yet (confirmed — no CI workflows, no
  `vercel.json` found under `frontend-next/`, no deploy script). See `DEPLOYMENT.md`.
- Legacy stack: `./deploy.sh [patch|minor|major] ["msg"]` at repo root — pushes to Apps Script
  via `clasp` and triggers a self-redeploy API call; Vercel auto-deploys the frontend on push.
  Requires an untracked `.deploy.env`. Fully documented in `CLAUDE.md`; see `DEPLOYMENT.md` for
  the terse version.

## In-repo planning artifacts (not part of `.ai/`, but worth knowing about)

- `final_changes_plan.md` (repo root) — a dated, client-specific requirements/gap-analysis doc
  for the new stack's purchasing/food-waste pipeline. Point-in-time, not living documentation.
- `How the System Works.docx` (repo root) — UNKNOWN content (binary, not read during this pass;
  inspect with the repo's own `.docx`-handling tooling if its content becomes relevant).
- `.agents/skills/` — UNKNOWN purpose beyond the directory name; not inspected this pass.
