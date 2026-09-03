#!/usr/bin/env bash
# Deploy the Kigali Keys frontend to the PRODUCTION Netlify site.
#
# Staging is deployed straight from src/frontend/public/ (its _redirects points
# at kigali-keys-staging.fly.dev). Production needs the exact same static files
# but with the /api/* proxy pointed at the production Fly backend. The Netlify
# CLI has no --config flag, so we build a throwaway copy with only that one line
# changed and deploy that. Nothing in the repo tree is modified.
#
# Usage:
#   scripts/deploy-frontend-prod.sh            # draft deploy (preview URL)
#   scripts/deploy-frontend-prod.sh --prod     # publish to production
#
# Env:
#   BACKEND_ORIGIN   default https://kigali-keys.fly.dev
#   NETLIFY_SITE     default kigali-keys
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/src/frontend/public"
BACKEND_ORIGIN="${BACKEND_ORIGIN:-https://kigali-keys.fly.dev}"
NETLIFY_SITE="${NETLIFY_SITE:-kigali-keys}"

DIST="$(mktemp -d)"
trap 'rm -rf "$DIST"' EXIT

cp -r "$SRC"/. "$DIST"/

# Rewrite ONLY the /api/* proxy line in the deployed _redirects.
python3 - "$DIST/_redirects" "$BACKEND_ORIGIN" <<'PY'
import sys, re
path, origin = sys.argv[1], sys.argv[2]
with open(path) as f:
    lines = f.readlines()
out = []
for ln in lines:
    if re.match(r'\s*/api/\*', ln):
        out.append(f"/api/*                    {origin}/api/:splat   200\n")
    else:
        out.append(ln)
with open(path, "w") as f:
    f.writelines(out)
PY

echo "== prod _redirects /api rule =="
grep '/api/' "$DIST/_redirects"

# Point the <link rel="preconnect"> / <link rel="dns-prefetch"> in every HTML
# head at the production backend origin (committed value is the staging origin,
# to match the committed _redirects). Same idea as the /api/* rewrite above.
STAGING_ORIGIN="https://kigali-keys-staging.fly.dev"
find "$DIST" -name '*.html' -type f -exec \
  sed -i "s#${STAGING_ORIGIN}#${BACKEND_ORIGIN}#g" {} +
echo "== prod preconnect origin =="
grep -rh 'rel="preconnect"' "$DIST"/index.html

MODE=(--dir "$DIST" --site "$NETLIFY_SITE" --no-build --message "production frontend")
if [ "${1:-}" = "--prod" ]; then
  MODE+=(--prod)
fi

( cd "$DIST" && netlify deploy "${MODE[@]}" )
