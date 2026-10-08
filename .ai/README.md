# `.ai/` — AI Knowledge Base

This directory is the persistent, structured source of truth for AI agents (and humans) working
on this repository across sessions. It exists so a new agent doesn't have to re-derive the
architecture from scratch every time, and so hard-won findings (live data quirks, deliberate
design decisions, open issues) survive past a single conversation.

## Documentation freshness — the one rule that matters

**Code > `.ai/` docs > assumptions.**

These docs were accurate when written (each file notes when it was last verified against the
repo, where relevant). The code changes faster than anyone updates documentation. If something
in here conflicts with what you read in the actual source:

1. Trust the code.
2. Investigate *why* the doc is wrong — was it ever right, or did behavior change since?
3. Update the relevant `.ai/` file so the next agent isn't misled the same way.

Never act on a claim here that you haven't spot-checked against the real file/route/table it
describes, if the task depends on it being correct.

## How this relates to `CLAUDE.md`

The repo root already has a `CLAUDE.md` (Claude Code's own project-instructions file) that is
itself an accurate, well-maintained architecture overview — directory layout, both stacks' auth
models, routing schemes, data access patterns, and dev commands. **`.ai/` does not duplicate
it.** Where `CLAUDE.md` already covers something well, these docs link to it instead of
restating it. `.ai/` goes *deeper* than `CLAUDE.md` in the places `CLAUDE.md` is intentionally
thin: the actual Prisma model list, the real HTTP route table, test conventions as practiced,
live/known issues, a decisions log, and a repeatable task-execution protocol.

There is also a root `UI_RULES.md` (mandatory desktop+mobile verification for UI work) and a
`final_changes_plan.md` (a specific, dated client-requirements planning doc, not general
architecture) — both referenced from here rather than duplicated.

## Which doc to read for which task

| Task | Read |
|---|---|
| "What is this project, who's the client, what stacks exist?" | `PROJECT.md` |
| "How do the pieces talk to each other?" | `ARCHITECTURE.md`, and `CLAUDE.md` |
| "Where do I find X in the repo?" | `FILE_STRUCTURE.md` |
| "What does the database actually look like?" | `DATABASE.md` |
| "What API routes exist, what do they take?" | `API.md`, `ENDPOINTS.md` |
| "How does login/session/kiosk-token auth work?" | `AUTH.md` |
| "What third-party services does this call?" | `INTEGRATIONS.md` |
| "Working in `frontend-next`" | `FRONTEND.md` |
| "Working in `nest-backend`" | `BACKEND.md` |
| "Is there an n8n workflow here?" | `N8N.md` (short answer: no) |
| "How do I deploy this?" | `DEPLOYMENT.md`, and `CLAUDE.md` |
| "How are things tested, and how well?" | `TESTING.md` |
| "What patterns/conventions does this codebase expect?" | `CONVENTIONS.md` |
| "Why does the code do *that*? (business rules)" | `BUSINESS_LOGIC.md` |
| "What env vars / secrets does this need?" | `ENVIRONMENT.md` |
| "Auth/security posture, anything concerning?" | `SECURITY.md` |
| "What's currently broken or weird?" | `KNOWN_ISSUES.md` |
| "Why was X built the way it was?" | `DECISIONS.md` |
| "What's changed recently?" | `CHANGELOG.md` |
| "How should an agent approach a new task here?" | `TASK_PROTOCOL.md` |

## Scope note

Per standing project convention (confirmed with the project owner), **active development work
targets `nest-backend/` + `frontend-next/` only.** The legacy `backend/` + `frontend/` stack is
still the live production system today, but is not where new work happens unless explicitly
asked. See `PROJECT.md` and `KNOWN_ISSUES.md` for an important caveat: as of this writing, the
legacy stack's files are tracked in git history but **absent from the working directory**
(uncommitted deletion, not yet explained — see `KNOWN_ISSUES.md`).

## Maintenance

When you learn something during a task that belongs here (a new gotcha, a resolved issue, a
decision made), update the relevant file in the same session rather than leaving it to a future
pass. Keep entries dated so staleness is visible at a glance.
