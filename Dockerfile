# Pinned to the Node.js Active LTS line (26 "Lithium", supported to April 2029).
# Dependabot opens a pull request when a newer image is published; rebuild
# with "docker compose build --pull" to pick up Alpine and Node security fixes.
FROM node:26-alpine

# git: the entrypoint fetches the app from GitHub
# gnupg: optional signature check of release tags (VERIFY_SIGNATURES)
RUN apk add --no-cache git gnupg

# The container runs as your SWAG PUID/PGID instead of root, so the conf files
# it writes are already owned by SWAG's user (no chown needed). Set FILE_UID
# and FILE_GID in .env; docker-compose passes them in as build arguments.
ARG FILE_UID=1000
ARG FILE_GID=1000

# Persistent directories (named volumes in docker-compose):
#   /app/repo  - the app's git checkout, so restarts work even if GitHub is down
#   /app/cache - package-lock.json hash and the npm download cache
#   /app/home  - home directory for git and gpg
RUN mkdir -p /app/repo /app/cache /app/home \
 && chown "$FILE_UID:$FILE_GID" /app/repo /app/cache /app/home

ENV HOME=/app/home \
    npm_config_cache=/app/cache/npm \
    npm_config_update_notifier=false

# Owned by root and read-only, so the app user cannot change its own startup script
COPY --chmod=0755 entrypoint.sh /entrypoint.sh

USER ${FILE_UID}:${FILE_GID}
WORKDIR /app/repo

ENTRYPOINT ["/entrypoint.sh"]
