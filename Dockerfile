# Studio UI image: builds packages/playground and serves the static files with nginx.
#
# Needs BuildKit (the default since Docker 23). The builder stage runs on the build machine's own
# platform; only the nginx stage follows --platform, because the build output is plain static files.
# A Mac building for amd64 servers therefore runs pnpm natively instead of under emulation.
FROM --platform=$BUILDPLATFORM node:24-slim AS builder

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Install the pnpm version pinned in package.json#packageManager, so upstream syncs need no bump here.
COPY package.json ./
RUN corepack install

# Copy the workspace sources (filtered by .dockerignore)
COPY . .

# Install only Studio, its workspace dependencies and the root tooling (turbo), not the whole monorepo.
# @mastra/server is listed on its own: client-js's turbo.json builds after @mastra/server#generate:route-types,
# a task-level link that pnpm's package graph doesn't see. If a later upstream sync adds another such link,
# the turbo build below fails with "command not found" for a tool of the missing package; add it here.
RUN pnpm install --frozen-lockfile --filter "@internal/playground..." --filter "@mastra/server..." --filter mastra-turbo

# Server Studio talks to on startup, before the admin panel's iframe message sets its own baseUrl.
# Studio calls `${MASTRA_SERVER_PROTOCOL}://${MASTRA_SERVER_HOST}:${MASTRA_SERVER_PORT}${MASTRA_API_PREFIX}/...`,
# so MASTRA_SERVER_HOST is a bare hostname (no protocol, no path) and any path goes in MASTRA_API_PREFIX,
# e.g. HOST=chatdev.adex.network PORT=443 PROTOCOL=https API_PREFIX=/mastra/api.
# Left empty, Studio falls back to http://localhost:4111/api and waits for the iframe message.
ARG MASTRA_SERVER_HOST=""
ARG MASTRA_SERVER_PORT=""
ARG MASTRA_SERVER_PROTOCOL=""
ARG MASTRA_API_PREFIX=""
ARG MASTRA_STUDIO_BASE_PATH=""

ENV MASTRA_SERVER_HOST=${MASTRA_SERVER_HOST} \
    MASTRA_SERVER_PORT=${MASTRA_SERVER_PORT} \
    MASTRA_SERVER_PROTOCOL=${MASTRA_SERVER_PROTOCOL} \
    MASTRA_API_PREFIX=${MASTRA_API_PREFIX} \
    MASTRA_STUDIO_BASE_PATH=${MASTRA_STUDIO_BASE_PATH}

# --env-mode=loose: Turbo's default strict mode hides the variables above from the Vite build.
RUN pnpm turbo build --env-mode=loose --filter ./packages/playground

# Final stage: serve the static output
FROM nginx:alpine AS serve

COPY docker/studio/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/playground/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
