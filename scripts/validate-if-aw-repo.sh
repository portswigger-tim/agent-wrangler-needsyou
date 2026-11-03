#!/bin/sh
# pre-push hook: run the real Agent Wrangler loader when a checkout is available.
# CI always sets AW_REPO, so a local skip never bypasses the gate for main.
if [ -z "$AW_REPO" ]; then
  echo "AW_REPO is not set, so validate-manifest is skipped here. CI runs it."
  exit 0
fi
exec node scripts/validate-manifest.mjs
