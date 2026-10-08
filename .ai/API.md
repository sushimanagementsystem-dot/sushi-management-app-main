# API.md

Covers the **new stack's** HTTP API (`nest-backend`). For the full route list, see
`ENDPOINTS.md`. For the legacy stack's single-dispatch `doPost` API, see `CLAUDE.md`.

## Shape — one route per action

Every action is its own `POST` route (`POST /submit`, `POST /confirm_invoice_review`, ...), not
a single endpoint with an `action` field in the body. `frontend-next/lib/api.js`:

```js
apiCall(action, data) // -> POST ${BACKEND_URL}/${action}, body = { sessionToken, ...data }
```

## Request body

Always JSON. The session token travels **inside the JSON body** as `sessionToken`, not as an
`Authorization` header (`SessionAuthGuard` reads `request.body?.sessionToken` — verified in
`src/common/guards/session-auth.guard.ts`). A request with no `sessionToken` on a non-`@Public()`
route gets `401 { ok: false, error: "Missing session token." }`.

Body size limit: 25 MB (raised from Express's 100kb default specifically because kiosk forms
send photo/video uploads as base64 inside the JSON payload — see `main.ts`'s comment).

## Response envelope — always this shape

**Success** (any 2xx), from `ResponseEnvelopeInterceptor`:
```json
{ "ok": true, "sessionToken": "<refreshed, only if present>", "...controller's return fields": "..." }
```

**Failure**, from `HttpExceptionFilter` — a real HTTP status code (not always 200, unlike the
legacy backend's always-200 convention):
```json
{ "ok": false, "error": "<plain-language message>" }
```
A raw, unexpected error is translated via `friendlyDbError()` (Prisma/Postgres error codes →
plain language) rather than ever reaching the client verbatim — a deliberate fix after a real
raw `fridge_count_product_id_fkey` Postgres error was once shown to a non-technical owner (see
`DECISIONS.md`). Frontend callers only ever read the parsed JSON body (`res.ok`, `res.error`),
never the HTTP status code, for error UX.

## Validation

Global `ValidationPipe({ whitelist: true, transform: true })` (`main.ts`) — every DTO class
under `src/**/dto/*.dto.ts` using `class-validator` decorators is enforced; unlisted body fields
are stripped (`whitelist: true`), not rejected.

## Auth gating per route

See `AUTH.md` for the full guard chain. Short version: every route is session-gated and
role-gated by default (global `APP_GUARD`s); a route opts out with `@Public()` and/or declares
required roles with `@Roles(...)`. Kiosk-facing routes (`bootstrap_*`, `submit`) additionally
require `KioskTokenGuard`.

## Calling conventions seen in the frontend

- `useBootstrap(action, params, options)` (`frontend-next/lib/queries.js`) — TanStack Query
  wrapper for a `bootstrap_*` GET-like read, auto-disabled when `params` is falsy/null.
- `useApiMutation(action, { onSuccess, onError })` — TanStack Query wrapper for a write action.
- Dashboard's Data Tables grid (`DataTablesController.js`) calls `apiCall()` directly (it's
  vanilla DOM, not a React component) rather than through the React Query hooks.

## Verifying a route live (established pattern this session, not yet scripted)

Mint a short-lived session JWT directly (bypassing the Google login flow) for a known
`User.user_id`:
```js
require('dotenv').config();
const jwt = require('jsonwebtoken');
jwt.sign({ sub: userId }, process.env.SESSION_JWT_SECRET, { expiresIn: '5m' });
```
then `curl -X POST $BACKEND_URL/<action> -d '{"sessionToken":"...", ...}'`. Useful for
verifying a change against the real live database without going through the browser UI. See
`TASK_PROTOCOL.md` and `TESTING.md` for the full workflow, including throwaway `ZTEST`-prefixed
rows and cleanup.
