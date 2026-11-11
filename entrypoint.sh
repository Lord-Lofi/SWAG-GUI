#!/bin/sh
# entrypoint.sh - fetch, verify, build, and start the SWAG Config GUI
#
# On every container start this script:
#   1. Fetches the app from GitHub (REPO_URL)
#   2. Picks the version named by REPO_REF: a release tag (recommended) or a branch
#   3. Optionally checks the release tag's GPG signature (VERIFY_SIGNATURES)
#   4. Reinstalls npm dependencies only if package-lock.json changed
#   5. Rebuilds the React frontend and starts the Express backend
#
# If GitHub can't be reached, or the requested version fails the signature
# check, the last version that passed is started again from the persistent
# /app/repo volume. Unverified code is never checked out.
set -eu

APP_DIR="/app/repo"
CACHE_DIR="/app/cache"
HASH_CACHE="$CACHE_DIR/.lock_hash"

: "${REPO_URL:?REPO_URL is required. Set it in your .env file.}"
REPO_REF="${REPO_REF:-main}"
VERIFY_SIGNATURES="${VERIFY_SIGNATURES:-false}"
SIGNING_KEY_FILE="${SIGNING_KEY_FILE:-/app/trusted-signing-key.asc}"

log() { echo "[swag-gui] $*"; }

mkdir -p "$CACHE_DIR"

# A usable version is already checked out from an earlier start
has_previous_version() { [ -f "$APP_DIR/package.json" ]; }

# Stop here: start the last good version if there is one, otherwise exit.
keep_previous_version() {
  log "WARNING: $1"
  if has_previous_version; then
    log "Starting the previously verified version instead: $(git -C "$APP_DIR" rev-parse --short HEAD)"
    UPDATE=false
  else
    log "ERROR: no previous version to fall back to. Cannot start."
    exit 1
  fi
}

UPDATE=true

# -- Step 1: Fetch ------------------------------------------------------------
# Tags are fetched without --force: if a release tag on GitHub were ever moved
# to different code, the fetch fails and the old version keeps running.
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL"
  log "Fetching $REPO_URL..."
  git fetch --quiet --tags --prune origin "+refs/heads/*:refs/remotes/origin/*" \
    || keep_previous_version "git fetch failed (GitHub unreachable, or a tag changed)"
else
  log "No cached repo found - cloning $REPO_URL..."
  git clone --quiet --no-checkout "$REPO_URL" "$APP_DIR" \
    || keep_previous_version "git clone failed"
  cd "$APP_DIR"
fi

# -- Step 2: Pick the version -------------------------------------------------
if [ "$UPDATE" = true ]; then
  if git rev-parse --quiet --verify "refs/tags/$REPO_REF" >/dev/null; then
    REF_KIND=tag
    TARGET="refs/tags/$REPO_REF"
  elif git rev-parse --quiet --verify "refs/remotes/origin/$REPO_REF" >/dev/null; then
    REF_KIND=branch
    TARGET="refs/remotes/origin/$REPO_REF"
  else
    keep_previous_version "REPO_REF '$REPO_REF' is not a tag or branch in $REPO_URL"
  fi
fi

# -- Step 3: Check the signature (optional) -----------------------------------
# Verifies the release tag against the public key you mounted. Only tags you
# signed yourself can pass; branch commits merged on GitHub are signed by
# GitHub's key, not yours, so they can't be verified this way.
if [ "$UPDATE" = true ] && [ "$VERIFY_SIGNATURES" = true ]; then
  if [ "$REF_KIND" != tag ]; then
    keep_previous_version "VERIFY_SIGNATURES=true needs REPO_REF to be a signed release tag, not the branch '$REPO_REF'"
  elif [ ! -r "$SIGNING_KEY_FILE" ]; then
    keep_previous_version "VERIFY_SIGNATURES=true but the public key file $SIGNING_KEY_FILE is missing"
  else
    GNUPGHOME="$(mktemp -d)"
    export GNUPGHOME
    if gpg --batch --quiet --import "$SIGNING_KEY_FILE" 2>/dev/null \
      && git verify-tag "$REPO_REF" 2>/dev/null; then
      log "Signature OK: tag $REPO_REF is signed by your key"
    else
      keep_previous_version "tag '$REPO_REF' does not have a valid signature from your key"
    fi
    rm -rf "$GNUPGHOME"
    unset GNUPGHOME
  fi
fi

if [ "$UPDATE" = true ]; then
  if [ "$REF_KIND" = branch ] && [ "$VERIFY_SIGNATURES" != true ]; then
    log "NOTE: following branch '$REPO_REF'. Set REPO_REF to a release tag to pin a version."
  fi
  git checkout --quiet --force --detach "$TARGET^{commit}"
  git clean --quiet -fd
fi

if [ "$UPDATE" = true ]; then
  log "Running $REPO_REF at commit $(git rev-parse --short HEAD)"
fi

# -- Step 4: Conditional dependency install -----------------------------------
# Compare package-lock.json's hash to skip npm ci on unchanged restarts.
# --ignore-scripts blocks install-script supply-chain attacks.
if [ ! -f "package-lock.json" ]; then
  log "ERROR: package-lock.json not found. Refusing to install unpinned dependencies."
  exit 1
fi
CURRENT_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
CACHED_HASH=$(cat "$HASH_CACHE" 2>/dev/null || echo "none")

if [ "$CURRENT_HASH" != "$CACHED_HASH" ] || [ ! -d node_modules ]; then
  log "Installing dependencies (npm ci)..."
  npm ci --ignore-scripts --no-audit --no-fund
  echo "$CURRENT_HASH" > "$HASH_CACHE"
else
  log "Dependencies unchanged - skipping npm ci"
fi

# -- Step 5: Build and start --------------------------------------------------
log "Building frontend..."
npm run build --workspace=frontend

log "Starting server..."
NODE_ENV=production exec node backend/src/server.js
