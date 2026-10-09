# DECISIONS.md

Confirmed, documented tradeoffs — not speculation.

## Cutover to `nest-backend`/`frontend-next` as the only active stack

The legacy `backend/` (Google Apps Script) + `frontend/` (static site) stack was fully deleted
from the working tree in commit `4b483ed` (2026-10-08). This lines up with the user's explicit,
separately-stated instruction that all work should target `frontend-next`/`nest-backend` only
("yar km sorf next js or nest js ma krna ha") and with `final_changes_plan.md`'s description of
`nest-backend`/`frontend-next` already carrying real client ("Evan") production data. Treat the
legacy stack as gone, not paused — recoverable from git history (`git show 4b483ed~1:backend/...`
etc.) if ever needed, but not something to keep in parity going forward. See `KNOWN_ISSUES.md`
item 1 for the stale docs this leaves behind.

## Prisma schema is a deliberate 1:1 port of the Google Sheet, not a redesign

`snake_case` field names and plain-`String` enum-like columns (instead of Prisma's camelCase
convention and compile-time enums) are intentional, stated directly in `schema.prisma`'s header
comment — so the API returns rows in the exact shape the frontend and the old DAL contract
already expected, with zero translation layer. A future schema cleanup pass should treat this as
a conscious tradeoff (less idiomatic Prisma, zero migration risk for existing consumers) rather
than an oversight to "fix."

## `PrismaService` holds a long-lived `pg.Pool` with `idleTimeoutMillis: 0`

Deliberate: avoids paying Neon's compute-suspend wake latency between requests. Do not revert
this to a bare connection string as a "simplification" — it was chosen specifically to counter
Neon's serverless cold-start behavior (stated directly in the code).

## Secrets encryption key defaults to a derivation of `SESSION_JWT_SECRET`, not a separate key

Chosen so every deployment already has a usable key with zero extra setup, at the documented
cost that rotating `SESSION_JWT_SECRET` without also setting `SECRETS_ENCRYPTION_KEY` makes
previously saved secrets unreadable until re-entered. See `AUTH.md`.

## Invoice AI extraction runs its network call before the DB transaction opens

`invoice-ai.service.ts`'s `extract()`/`persist()` split exists because Prisma's interactive
transactions expire after 5s and a 10-40s vision API call inside one would kill the submission.
See `BUSINESS_LOGIC.md`/`INTEGRATIONS.md`.
