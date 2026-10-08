# N8N.md

**There is no N8N integration in this repository.**

Verified by repo-wide search (`grep -ri n8n`, excluding `node_modules` and `.git`) on
2026-10-08. The only matches were inside `frontend-next/.next/cache/turbopack/.../*.sst` and
`*.meta` files — Turbopack's compiled build-cache artifacts, where "n8n" appears coincidentally
as part of a content hash, not as a real string reference. No `n8n` workflow files, no n8n SDK
dependency in either `package.json`, no n8n-related environment variable, no n8n webhook
endpoint.

The async submission/processing pipeline that might otherwise be built with a tool like n8n is
instead hand-rolled in `nest-backend/src/pipeline/` (a `Submission` queue table + processors +
a scheduled sweep + an immediate-nudge call) — see `ARCHITECTURE.md`.

If n8n is introduced to this project in the future, update this file with what it's used for and
how it connects (webhook direction, credentials, which workflows exist) rather than leaving this
stale "no integration" note in place.
