# syntax=docker/dockerfile:1.7
# One build for every app; each target copies only what its runtime needs.
#   docker build --target landing-web -t outegro/landing-web:<tag> .
# Targets: landing-web, id-web, auth-backend, notifications-backend.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build \
      --filter=@outegro/landing-web --filter=@outegro/id-web \
      --filter=@outegro/auth-backend --filter=@outegro/notifications-backend
# Backends: production dependencies only, plus build output and migrations.
RUN for app in auth-backend notifications-backend; do \
      pnpm --filter "@outegro/$app" deploy --prod "/out/$app" && \
      cp -r "apps/$app/dist" "apps/$app/drizzle" "/out/$app/"; \
    done

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
USER node

FROM web AS landing-web
COPY --from=build --chown=node:node /repo/apps/landing-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/landing-web/.next/static ./apps/landing-web/.next/static
COPY --from=build --chown=node:node /repo/apps/landing-web/public ./apps/landing-web/public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/landing-web/server.js"]

FROM web AS id-web
COPY --from=build --chown=node:node /repo/apps/id-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/id-web/.next/static ./apps/id-web/.next/static
ENV PORT=3002
EXPOSE 3002
CMD ["node", "apps/id-web/server.js"]

FROM node:24-bookworm-slim AS service
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM service AS auth-backend
COPY --from=build --chown=node:node /out/auth-backend ./
ENV PORT=4001
EXPOSE 4001
CMD ["node", "dist/main.js"]

FROM service AS notifications-backend
COPY --from=build --chown=node:node /out/notifications-backend ./
ENV PORT=4002
EXPOSE 4002
CMD ["node", "dist/main.js"]
