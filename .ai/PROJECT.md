# PROJECT.md

## What this is

A sushi kiosk management system for a real client ("Evan" — see `final_changes_plan.md` at
repo root). Kiosk staff submit forms (waste, stocktake, deliveries, audits, fridge counts, etc.);
an owner/admin dashboard reviews and manages that data, and a production-planning engine +
purchasing-automation pipeline run off it.

**Classification: Complex/enterprise.** Not because of multiple parallel stacks (the legacy one
is gone, see `.ai/README.md`), but because of domain richness within the one active stack: 49
Prisma models, ~15 backend modules, a non-trivial global-guard auth model, an external LLM
integration (invoice line-item extraction), scheduled/async submission processing, and real
production data already flowing through it for a paying client.

## Active stack

- `nest-backend/` — NestJS 12 + Prisma 7 + Postgres (Neon), ESM (`"type": "module"`), TypeScript.
- `frontend-next/` — Next.js 16 (App Router) + React 19, Zustand for auth state, TanStack Query
  for data fetching, Tailwind for styling.

## How to run it

```bash
cd nest-backend
npm install          # postinstall runs `prisma generate`
npm run start:dev    # needs DATABASE_URL in .env (gitignored, not committed, not in repo)
```

```bash
cd frontend-next
npm install
npm run dev          # needs NEXT_PUBLIC_BACKEND_URL, defaults to http://localhost:3000
```

No root-level script ties the two together, and no `.env.example` exists in `nest-backend/` —
the required env vars (confirmed from the local `.env` and `ConfigService.get(...)` call sites)
are: `DATABASE_URL`, `PORT` (optional, defaults 3000), `SESSION_JWT_SECRET`, `GOOGLE_CLIENT_ID`,
`ANTHROPIC_API_KEY` (optional — can also be set per-deployment from the dashboard, see
`INTEGRATIONS.md`), `PROCESS_SECRET`, and optionally `SECRETS_ENCRYPTION_KEY` (see `AUTH.md`'s
secrets-encryption note). See `KNOWN_ISSUES.md` — the lack of `.env.example` is a confirmed gap.

## Entry points

- Backend: `nest-backend/src/main.ts` — boots Nest, enables CORS, raises the JSON/urlencoded body
  limit to 25mb specifically for base64 photo/video uploads in form submissions.
- Frontend: Next.js App Router — `frontend-next/app/[slug]/...` (kiosk pages, identity via URL
  slug) and `frontend-next/app/dashboard/...` (owner dashboard). `frontend-next/proxy.js`
  lowercases kiosk slugs before routing.

## Repo root (outside both app directories)

- `CLAUDE.md`, `README.md` — stale in places; see `KNOWN_ISSUES.md`.
- `UI_RULES.md` — mandatory desktop+mobile responsive-testing rule for every UI task.
- `deploy.sh` — deploy script for the **deleted** legacy stack only; dead code against the
  current tree (see `KNOWN_ISSUES.md`). No deploy tooling exists yet for the active stack.
- `final_changes_plan.md` — a dated work-item log (client "Evan"'s stock/ordering review) against
  `nest-backend`/`frontend-next`. Confirms this stack already carries real production data and
  is the one being actively built out for the client, not a prototype.
- `How the System Works.docx` — not read as part of this audit (binary doc); worth a human
  skim if it documents business rules not otherwise visible in code comments.
- `.agents/skills/` — present but not inspected for this pass; UNKNOWN — needs inspection if a
  future task touches project-level skills.
