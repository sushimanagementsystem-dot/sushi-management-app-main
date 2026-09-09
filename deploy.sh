#!/usr/bin/env bash
# Single-repo deploy (monorepo: backend/ + frontend/, merged 2026-07-28).
# Always commits + pushes the whole repo in one commit. Only pushes to
# Apps Script via clasp and redeploys if backend/ actually has tracked
# changes — a frontend-only change never touches that path, both because
# there's nothing to push and because the redeploy API call can leave the
# live /exec URL briefly flaky right after (see DECISIONS.md). Vercel
# deploys the frontend on push by itself, no script step needed for that.
#
# Usage: ./deploy.sh [patch|minor|major] ["commit message"]
#   patch: V1.2.3 -> V1.2.4 | minor: V1.2.3 -> V1.3.0 | major: V1.2.3 -> V2.0.0
#   Commit message is always "Deploy V<version>" — a given message is
#   appended (": <message>"), never replaces the version label.
set -euo pipefail
cd "$(dirname "$0")"

# Backend /exec URL and API secret, read from an untracked config file:
#   .deploy.env with two lines:
#     BACKEND_URL="https://script.google.com/macros/s/.../exec"
#     API_SECRET="..."
source .deploy.env

echo "== deploy.sh starting"

BUMP="patch"
MSG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        patch|minor|major) BUMP="$1"; shift ;;
        *) MSG="$1"; shift ;;
    esac
done

if [[ -z "$(git status --porcelain)" ]]; then
    echo "Nothing to commit."
    exit 0
fi

# .version holds the full current version, e.g. "0.0.27"
VERSION_FILE=".version"
# `|| true`: read exits non-zero when the file lacks a trailing newline,
# which would silently kill the script under `set -e`.
IFS=. read -r MAJ MIN PAT < <(cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0") || true
MAJ=${MAJ:-0}; MIN=${MIN:-0}; PAT=${PAT:-0}
case "$BUMP" in
    major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
    minor) MIN=$((MIN + 1)); PAT=0 ;;
    patch) PAT=$((PAT + 1)) ;;
esac
NEW_VERSION="$MAJ.$MIN.$PAT"
LABEL="V$NEW_VERSION"

COMMIT_MSG="Deploy $LABEL"
[[ -n "$MSG" ]] && COMMIT_MSG="Deploy $LABEL: $MSG"

# Checked before staging — whether any *tracked* file under backend/
# changed (backend/.clasp.json is gitignored, never shows up in plain
# `git status` at all).
BACKEND_CHANGED=false
[[ -n "$(git status --porcelain -- backend)" ]] && BACKEND_CHANGED=true

echo "== git commit + push"
git add -A
git commit -m "$COMMIT_MSG"
git push

if $BACKEND_CHANGED; then
    echo "== clasp push (backend)"
    (cd backend && clasp push -f)

    echo "== redeploy as $LABEL (via backend API, owner identity)"
    RESPONSE=$(curl -sL "$BACKEND_URL" \
        -H "Content-Type: application/json" \
        -d "{\"secret\":\"$API_SECRET\",\"action\":\"redeploy\",\"label\":\"$LABEL\"}")
    echo "$RESPONSE"

    if [[ "$RESPONSE" == *'"ok":true'* ]]; then
        echo "$NEW_VERSION" > "$VERSION_FILE"
        echo "Done: $LABEL"
    else
        echo "Redeploy FAILED — version counter not advanced." >&2
        exit 1
    fi
else
    echo "$NEW_VERSION" > "$VERSION_FILE"
    echo "Done: $LABEL (frontend only, no backend redeploy)"
fi
