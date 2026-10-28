# syntax=docker/dockerfile:1.7
# atelier-browser: the Nest service plus headless Chromium from Playwright.
# Built from the monorepo root (pnpm workspace):
#   docker build -f apps/atelier-browser/Dockerfile -t outegro/atelier-browser:<tag> .
# Debian, not Alpine: Playwright's Chromium needs glibc.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# The service and the workspace packages it imports (contracts, nest-common, db).
RUN pnpm turbo run build --filter=@outegro/atelier-browser...
# Production dependencies only, plus the build output.
RUN pnpm --filter @outegro/atelier-browser deploy --prod /out/atelier-browser && \
    cp -r apps/atelier-browser/dist /out/atelier-browser/

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=4011
WORKDIR /app
COPY --from=build --chown=1000:1000 /out/atelier-browser ./
# Chromium of exactly the Playwright version in node_modules (headless shell
# only: the service never opens a window), its system libraries and fonts;
# tini reaps Chromium's child processes.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    node node_modules/playwright/cli.js install --with-deps --only-shell chromium && \
    chmod -R a+rX /ms-playwright && \
    rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*
# Numeric, so Kubernetes can verify runAsNonRoot (the image's "node" user).
USER 1000:1000
EXPOSE 4011
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
