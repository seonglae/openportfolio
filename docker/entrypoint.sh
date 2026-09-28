#!/bin/sh
# One image, three jobs. `init` pushes the functions and creates the first
# book, then exits; `web` and `sync` wait for it. The admin key is written by
# the admin-key service from the backend's own credentials, so no secret is
# fixed in this repository.
set -eu

KEY_FILE=/keys/admin_key
if [ ! -s "$KEY_FILE" ]; then
  echo "no admin key at $KEY_FILE; the admin-key service writes it" >&2
  exit 1
fi
CONVEX_SELF_HOSTED_ADMIN_KEY="$(cat "$KEY_FILE")"
export CONVEX_SELF_HOSTED_ADMIN_KEY

TENANT="${OPENPORTFOLIO_DEV_TENANT:-home}"
BASE_CURRENCY="${OPENPORTFOLIO_BASE_CURRENCY:-GBP}"

case "${1:-}" in
  init)
    npx convex deploy -y
    npx convex env set OPENPORTFOLIO_DEV_TENANT "$TENANT"
    # A second `up` finds the book already there, which is the normal case.
    if ! out=$(npx convex run tenants:create "{\"slug\":\"$TENANT\",\"name\":\"Home\",\"baseCurrency\":\"$BASE_CURRENCY\"}" 2>&1); then
      case "$out" in
        *"already exists"*) echo "book \"$TENANT\" already exists" ;;
        *) echo "$out" >&2; exit 1 ;;
      esac
    fi
    ;;
  web)
    cd browser
    exec npx vite preview --host 0.0.0.0 --port 6101 --strictPort
    ;;
  sync)
    exec npx tsx sync-worker.mts
    ;;
  *)
    echo "usage: entrypoint.sh init|web|sync" >&2
    exit 2
    ;;
esac
