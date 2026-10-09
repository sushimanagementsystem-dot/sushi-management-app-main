# INTEGRATIONS.md

Only integrations with confirmed evidence in the repo (an import, a client library, a config
key) — nothing assumed because it's common for this kind of stack.

## Anthropic Claude API (`@anthropic-ai/sdk` in `nest-backend/package.json`)

Used for one thing: extracting + matching invoice line items from uploaded delivery-invoice
files/photos (`src/production-engine/invoice-ai.service.ts`), a port of the legacy backend's
`forms/InvoiceAI.js`. Key details:

- Key resolution order (`anthropic-config.service.ts`): (1) a key saved by an owner on
  Dashboard → Site Configuration → AI (Claude), stored **encrypted** in `SiteConfig` (see
  `AUTH.md`'s `SecretsService`); (2) the `ANTHROPIC_API_KEY` env var as a fallback. Model
  likewise: dashboard choice → `INVOICE_AI_MODEL` → default (`claude-sonnet-5`, confirmed in
  `DEFAULT_AI_MODEL`). Resolution is cached 60s and invalidated on Site Configuration writes.
- `extract()` is pure network I/O (can take 10-40s), deliberately run **before** the pipeline's
  DB transaction opens — Prisma interactive transactions expire after 5s, so a vision call
  inside one would kill the submission. `persist()` is the quick-write half.
- Images: JPEG/PNG/GIF/WebP only, 5MB/image cap (Claude's own per-image limit).
- `EXTRACT_MAX_TOKENS = 16000` (non-streaming) — raised from an earlier 4096 because adaptive
  thinking shares the same token budget as the JSON answer and could exhaust it before a long
  invoice's JSON finished (confirmed in the code's own comment).
- Graceful degradation: if no key is configured, the owner sees a specific message
  (`NOT_SET_UP` constant) telling them where to add one and that the invoice can be entered
  manually + re-run later — not a generic failure.

## Google OAuth (`google-auth-library`)

Login exchanges a short-lived Google ID token for the app's own session JWT —
`AuthService.login()` verifies it via `OAuth2Client` keyed by `GOOGLE_CLIENT_ID`. No other
Google integration found (no Sheets/Drive API calls in the active stack — that was the *legacy*
stack's storage layer, now deleted; see `.ai/README.md`).

## Neon Postgres

`DATABASE_URL` points at a Neon Postgres instance. `PrismaService` holds a long-lived `pg.Pool`
(`idleTimeoutMillis: 0`) specifically to dodge Neon's compute-suspend wake latency — see
`DATABASE.md`.

## Email (`nodemailer`)

`src/mailer/` wraps `nodemailer` for: production-plan emails (`production-email.service.ts`),
purchasing order emails (`purchasing-order-email.ts`), audit report emails
(`audit-report-email.service.ts`). SMTP credentials/config: UNKNOWN — needs inspection of
`mailer/` + env vars actually read there (not confirmed during this pass; the local `.env` file
checked for this audit did not show SMTP-specific keys, which may mean they're set elsewhere,
e.g. a different environment's `.env`, or mailer config comes from `SiteConfig` like the
Anthropic key does — worth checking `mailer.service.ts` directly before relying on either guess).
