#!/bin/sh
# entrypoint.sh — self-update, build, and start the SWAG Config GUI
#
# On every container start this script:
#   1. Pulls the latest application code from GitHub
#   2. Reinstalls npm dependencies only if package-lock.json changed
#   3. Rebuilds the React frontend
#   4. Starts the Express backend
#
# If git pull fails (network outage, GitHub down), it falls back to the
# last successfully cloned version cached on the persistent volume.
set -e

APP_DIR="/app/repo"
CACHE_DIR="/app/cache"
HASH_CACHE="$CACHE_DIR/.lock_hash"

# REPO_URL must be set — fail fast if missing
: "${REPO_URL:?REPO_URL is required. Set it in your .env file.}"

log() { echo "[swag-gui] $*"; }

mkdir -p "$CACHE_DIR"

# ── Step 1: Clone or pull ─────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  log "Pulling latest code..."
  cd "$APP_DIR"
  git pull origin main || log "WARNING: git pull failed — starting from cached version"
else
  log "No cached repo found — cloning $REPO_URL..."
  # If clone fails with no cache, we cannot start
  git clone "$REPO_URL" "$APP_DIR" || {
    log "ERROR: git clone failed and no cached version exists. Cannot start."
    exit 1
  }
  cd "$APP_DIR"
fi

cd "$APP_DIR"

# ── Step 2: Conditional dependency install ────────────────────────────────────
# Compare package-lock.json hash to avoid running npm ci on every restart.
# --ignore-scripts blocks postinstall supply chain vectors.
if [ -f "package-lock.json" ]; then
  CURRENT_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
  CACHED_HASH=$(cat "$HASH_CACHE" 2>/dev/null || echo "none")

  if [ "$CURRENT_HASH" != "$CACHED_HASH" ]; then
    log "Dependencies changed — running npm ci..."
    npm ci --ignore-scripts
    echo "$CURRENT_HASH" > "$HASH_CACHE"
  else
    log "Dependencies unchanged — skipping npm ci"
  fi
else
  log "WARNING: package-lock.json not found — falling back to npm install"
  npm install --ignore-scripts
fi

# ── Step 3: Build frontend ────────────────────────────────────────────────────
log "Building frontend..."
npm run build --workspace=frontend

# ── Step 4: Start server ──────────────────────────────────────────────────────
log "Starting server..."
exec node backend/src/server.js
