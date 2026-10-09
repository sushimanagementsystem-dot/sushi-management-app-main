# SECURITY.md

Confirmed from code, not a generic checklist.

## CORS is fully open

`src/main.ts` calls `app.enableCors()` with no options — Nest/Express default is to allow any
origin. The app relies entirely on the session-token/kiosk-token model (see `AUTH.md`) rather
than CORS for access control, which is a reasonable choice *if* intentional (the frontend is a
separate deployed origin by design), but it means any site can issue cross-origin requests to
this API; nothing but the token checks stops them. Worth a deliberate decision note if this
wasn't already one — currently undocumented either way.

## No rate limiting or request-throttling found

No `@nestjs/throttler` (or equivalent) in `package.json`, no custom throttling guard found.
`login` (Google-token exchange) and the 11 kiosk-token-gated `submit`/bootstrap routes are
`@Public()`/token-gated rather than session-gated, making them the most exposed to abuse (e.g.
repeated submit floods) with nothing in-app to slow that down.

## Request body size raised to 25mb

`main.ts` raises both JSON and urlencoded body limits to 25mb specifically to allow base64
photo/video uploads inside form-submit payloads (Damaged Product, Help/Issues, Delivery
Invoices, Monthly Audit, Audit Corrections). This is a deliberate, documented tradeoff (see
`DECISIONS.md`-style reasoning in the code itself) but is also a larger-than-default attack
surface for a memory-exhaustion-style request against a public/token-gated route — no evidence
of additional per-route limits scoping this down for non-upload routes.

## Secrets at rest

Covered in depth in `AUTH.md`. Summary: API keys saved via the dashboard are AES-256-GCM
encrypted before being written to Postgres; the encryption key is env-derived, never stored in
the DB itself.

## Secrets in env

`.env` (gitignored, confirmed via `nest-backend/.gitignore`) holds `DATABASE_URL`,
`SESSION_JWT_SECRET`, `GOOGLE_CLIENT_ID`, `ANTHROPIC_API_KEY`, `PROCESS_SECRET`. No
`.env.example` exists (see `KNOWN_ISSUES.md`), and no secret-scanning/pre-commit hook was found
in the repo to catch an accidental commit of real values.

## Auth auto-registration surface

An unrecognized login email is auto-registered as an inactive STAFF user rather than rejected
(see `AUTH.md`). This is intentional legacy-parity behavior, not a bug, but means **any** Google
account can create a (dormant) user row by attempting to log in — low risk since the account
stays inactive until an owner activates it, but worth knowing if auditing for unexpected `User`
rows.
