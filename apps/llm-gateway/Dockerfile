# syntax=docker/dockerfile:1.7
# llm-gateway: the Nest service plus the Codex and Claude Code CLIs it runs.
# Build from the repository root (the build needs the workspace packages):
#   docker build -f apps/llm-gateway/Dockerfile -t outegro/llm-gateway:dev .
#
# Alpine (musl) works for both CLIs: Codex ships a static musl binary and
# Claude Code a musl build that needs libgcc and libstdc++ (plus ripgrep,
# USE_BUILTIN_RIPGREP=0). The build checks both with --version below.

FROM node:24-alpine AS build
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the gateway and the workspace packages it depends on.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@outegro/llm-gateway..."
RUN pnpm --filter "@outegro/llm-gateway..." run build
# Production dependencies only, plus the build output and the profiles file.
# @nestjs/throttler is a peer of nest-common (its error filter) that the
# gateway does not list yet; it has no dependencies of its own, so its files
# are copied in. Drop the copy once package.json lists "@nestjs/throttler".
RUN pnpm --filter @outegro/llm-gateway deploy --prod /out && \
    cp -r apps/llm-gateway/dist apps/llm-gateway/config /out/ && \
    if [ ! -e /out/node_modules/@nestjs/throttler ]; then \
      cp -rL packages/nest-common/node_modules/@nestjs/throttler /out/node_modules/@nestjs/throttler; \
    fi

FROM node:24-alpine AS runtime
RUN apk add --no-cache libgcc libstdc++ ripgrep ca-certificates
# Pinned CLI versions; self-updates and non-essential traffic stay off.
ENV DISABLE_UPDATES=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    USE_BUILTIN_RIPGREP=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm install -g @openai/codex@0.159.1 @anthropic-ai/claude-code@2.1.304 && \
    npm cache clean --force && \
    codex --version && claude --version
# The node user (1000) owns HOME (Claude Code writes ~/.claude*) and the
# default CODEX_HOME; a mounted CODEX_HOME must be writable by 1000 too.
ENV NODE_ENV=production \
    HOME=/home/node \
    CODEX_HOME=/home/node/.codex \
    PORT=4009 \
    METRICS_PORT=9464
RUN mkdir -p /home/node/.codex && chown -R node:node /home/node
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Numeric, so Kubernetes can verify runAsNonRoot.
USER 1000:1000
EXPOSE 4009 9464
CMD ["node", "dist/main.js"]
