# syntax=docker/dockerfile:1.7
# One build for every app; each target copies only what its runtime needs.
#   docker build --target landing-web -t outegro/landing-web:<tag> .
# Targets: landing-web, id-web, pay-web, admin-web, battleship-web,
#          auth-backend, notifications-backend, payments-backend,
#          battleship-backend.

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
# Git keeps no empty folders; the runtime stages copy public/ unconditionally.
RUN mkdir -p apps/landing-web/public
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# CI builds only the apps a change affects (docker-bake BUILD_APPS); a plain
# build still builds all of them.
ARG BUILD_APPS="landing-web id-web pay-web admin-web battleship-web auth-backend notifications-backend payments-backend battleship-backend"
RUN pnpm turbo run build $(for app in $BUILD_APPS; do printf -- '--filter=@outegro/%s ' "$app"; done)
# Backends: production dependencies only, plus build output and migrations.
RUN for app in auth-backend notifications-backend payments-backend battleship-backend; do \
      case " $BUILD_APPS " in *" $app "*) ;; *) continue ;; esac; \
      pnpm --filter "@outegro/$app" deploy --prod "/out/$app" && \
      cp -r "apps/$app/dist" "apps/$app/drizzle" "/out/$app/"; \
    done

FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Numeric, so Kubernetes can verify runAsNonRoot.
USER 1000:1000

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

FROM web AS pay-web
COPY --from=build --chown=node:node /repo/apps/pay-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/pay-web/.next/static ./apps/pay-web/.next/static
ENV PORT=3003
EXPOSE 3003
CMD ["node", "apps/pay-web/server.js"]

FROM web AS admin-web
COPY --from=build --chown=node:node /repo/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin-web/.next/static ./apps/admin-web/.next/static
ENV PORT=3004
EXPOSE 3004
CMD ["node", "apps/admin-web/server.js"]

FROM web AS battleship-web
COPY --from=build --chown=node:node /repo/apps/battleship-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/battleship-web/.next/static ./apps/battleship-web/.next/static
ENV PORT=3005
EXPOSE 3005
CMD ["node", "apps/battleship-web/server.js"]

FROM node:24-bookworm-slim AS service
ENV NODE_ENV=production
WORKDIR /app
USER 1000:1000

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

FROM service AS payments-backend
COPY --from=build --chown=node:node /out/payments-backend ./
ENV PORT=4003
EXPOSE 4003
CMD ["node", "dist/main.js"]

FROM service AS battleship-backend
COPY --from=build --chown=node:node /out/battleship-backend ./
ENV PORT=4004
EXPOSE 4004
CMD ["node", "dist/main.js"]
