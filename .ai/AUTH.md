# AUTH.md

## Model: global guards, opt-out per route

`AppModule` registers `SessionAuthGuard` then `RolesGuard` as `APP_GUARD`s — applied to every
route by default (the inverse of the legacy backend, where each handler called `isOwnerRole_()`
itself). Order matters: session auth resolves `request.user` first, roles guard reads it second
(stated directly in `app.module.ts`'s own comment).

- **`@Public()`** (`src/common/decorators/public.decorator.ts`) opts a route out of session auth
  entirely. Confirmed used in: `app.controller.ts`, `auth.controller.ts`,
  `dashboard-settings.controller.ts`, `forms.controller.ts`, `import.controller.ts`/
  `import-database.controller.ts`, `kiosk.controller.ts`, `pipeline.controller.ts`,
  `upload.controller.ts`. (Re-check with `grep -rln "@Public()" nest-backend/src` before relying
  on this list — it will drift as routes are added.)
- **`@Roles(...)`** (`src/common/decorators/roles.decorator.ts`) opts a route into role
  restriction; a route with no `@Roles()` metadata is open to any authenticated user regardless
  of role (`RolesGuard.canActivate` returns `true` when `requiredRoles` is empty/undefined).
- **`KioskTokenGuard`** + **`@CurrentKiosk()`** gate kiosk-identity routes separately — confirmed
  applied across all 11 form controllers plus `kiosk.controller.ts` and the shared
  `forms.controller.ts`. This is the kiosk-link-token credential, independent of user session
  auth (staff haven't signed in as a *user* yet at kiosk-bootstrap/submit time).

## Session auth (`SessionAuthGuard` + `AuthService`)

- Reads `request.body.sessionToken` (not a header) — throws `UnauthorizedException` if missing.
- `AuthService.verifySession()` re-verifies the token *and* re-checks the user is still active on
  every call, not just at login — matching the legacy backend's behavior.
- Session TTL is 30 days, **sliding**: reissued on every successful verify
  (`SESSION_TTL = "30d"` in `auth.service.ts`). The guard stores `request.refreshedSessionToken`;
  `frontend-next/lib/api.js`'s `apiCall()` re-stores whatever refreshed token comes back on every
  response, so pages never manage this themselves.

## Login flow

1. Frontend gets a short-lived Google ID token (Google Sign-In) and calls `login`.
2. `AuthService.login()` verifies it against Google (`google-auth-library`'s `OAuth2Client`,
   keyed by `GOOGLE_CLIENT_ID`), lowercases/trims the email.
3. Looks up a matching `User` row **case-insensitively** — guards against a duplicate row being
   created if an owner typed an email with different casing before Data Tables started
   lowercasing them.
4. **Unknown email → auto-registered as an inactive STAFF row**, not rejected outright. An owner
   must flip the user active from the Settings/Users dashboard page before they can do anything.
   This mirrors the legacy `backend/core/Auth.js` behavior (per the code's own comment) and is
   worth knowing before assuming a "can't log in" report is a bug rather than an un-activated
   account.
5. Issues a signed session JWT (`@nestjs/jwt`), 30-day sliding TTL as above.

## Role gating

`RolesGuard` reads `request.user?.role` and checks it against `@Roles(...)` metadata. Role
values are confirmed `String` in the DB (`User.role`), not a compile-time Prisma enum — see
`DATABASE.md`. A signed-in STAFF session token is otherwise structurally identical to an owner's;
**every new dashboard-only route must declare `@Roles(...)` itself** or it defaults to open.

## Secrets encryption (`src/secrets/secrets.service.ts`)

API keys/credentials saved to the DB (e.g. the Anthropic key via Site Configuration) are
encrypted at rest with AES-256-GCM before being written, so a DB dump/read-only SQL access never
sees plaintext. The encryption key comes from `SECRETS_ENCRYPTION_KEY` if set, otherwise is
derived (HKDF) from `SESSION_JWT_SECRET` — meaning **rotating `SESSION_JWT_SECRET` without also
setting `SECRETS_ENCRYPTION_KEY` makes previously saved secrets unreadable** until re-entered.
`decrypt()` passes already-plaintext legacy values through unchanged, so secrets saved before
encryption existed keep working and are upgraded the next time their category is saved.
