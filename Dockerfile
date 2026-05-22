FROM node:lts-alpine

# git is required by the entrypoint self-update mechanism
RUN apk add --no-cache git

# Persistent directories:
#   /app/repo  — cloned/pulled application source (mount as named volume for warm restarts)
#   /app/cache — lock file hash + node_modules cache marker
RUN mkdir -p /app/repo /app/cache

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/repo

ENTRYPOINT ["/entrypoint.sh"]
