# .ai/ — project knowledge base

This directory is a persistent knowledge base for AI assistants (and humans) working in this
repo, built by reading the actual code, config, and git history — not by assuming how a
NestJS/Next.js/Prisma project "usually" works.

## Freshness rule

> Code > .ai/ docs > assumptions. If a doc conflicts with the actual code: trust the code,
> investigate why, then update the doc. Docs here are a map, not the territory.

## Scope note — read this first

This repo's root `CLAUDE.md` and `README.md` describe **two parallel stacks**: a legacy
Google-Apps-Script + static-site stack (`backend/` + `frontend/`) and a NestJS/Next.js rewrite
(`nest-backend/` + `frontend-next/`). As of commit `4b483ed` (2026-10-08), **the legacy
`backend/` and `frontend/` directories have been deleted from the working tree** — they only
exist in git history now (`git show 4b483ed~1:backend/...` etc. to recover them). The user has
also separately confirmed (see project memory) that all active work is scoped to
`frontend-next/` + `nest-backend/` only.

Root `CLAUDE.md` and root `README.md` have **not** been updated to reflect this — both still
describe `backend/`/`frontend/` as present and `deploy.sh` still contains logic that references
`backend/` paths that no longer exist. See `KNOWN_ISSUES.md` for details. Every doc in this
`.ai/` directory therefore documents **the active stack only**
(`nest-backend/` + `frontend-next/`), not the deleted legacy stack.

## Files in this knowledge base

- `PROJECT.md` — what this is, stack, how to run it, entry points.
- `ARCHITECTURE.md` — module boundaries and request-flow between frontend-next and nest-backend.
- `DATABASE.md` — Prisma/Postgres schema, key models, migrations.
- `API.md` — route surface (one controller/route per action) and the controller list.
- `AUTH.md` — session/kiosk-token/role guard model.
- `BUSINESS_LOGIC.md` — production engine, purchasing automation, invoice AI.
- `INTEGRATIONS.md` — Anthropic Claude API, Google OAuth, Neon Postgres, nodemailer.
- `SECURITY.md` — CORS, rate limiting, body-size limits, secrets handling.
- `DEPLOYMENT.md` — deploy tooling status for the active stack (there isn't much yet).
- `TESTING.md` — vitest/oxlint setup and coverage.
- `CONVENTIONS.md` — coding conventions confirmed from the actual code.
- `KNOWN_ISSUES.md` — confirmed drift/risks found during this audit.
- `DECISIONS.md` — confirmed, documented tradeoffs (e.g. the legacy-stack cutover).

No file exists here for a concern this repo doesn't actually have (no CI config, no `N8N.md`,
no payment integration, etc.) — see `KNOWN_ISSUES.md` for the ones worth flagging as *absent*.
