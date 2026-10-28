# syntax=docker/dockerfile:1.7
# atelier-tex: renders CvDocument JSON with XeLaTeX ("Minimal violet") and
# measures the PDF with poppler. Self-contained (not a stage of the root
# Dockerfile: the TeX layer alone is ~1.5 GB). Build from the repository root:
#   docker build -f apps/atelier-tex/Dockerfile -t outegro/atelier-tex:dev .
#
# Debian, not Alpine: the template, its overfull/line thresholds and the
# bbox measurements were validated on Debian's TeX Live (work-finder's
# tex-system stage, same package set). Alpine splits TeX Live differently
# (texmf-dist-* packages, another TeX Live year) and ships another poppler,
# so line breaks and pdftotext word boxes could drift; it would also save
# little, since TeX Live is almost the whole image.

FROM node:24-bookworm-slim AS base
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Only the workspace manifests and the packages this app is built from.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/db ./packages/db
COPY packages/nest-common ./packages/nest-common
COPY apps/atelier-tex ./apps/atelier-tex
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@outegro/atelier-tex..."
# contracts, db, nest-common, then the app (topological order).
RUN pnpm --filter "@outegro/atelier-tex..." run build
RUN pnpm --filter @outegro/atelier-tex deploy --prod /out/atelier-tex && \
    cp -r apps/atelier-tex/dist apps/atelier-tex/templates apps/atelier-tex/fonts /out/atelier-tex/
# nest-common's error filter imports @nestjs/throttler, a peer dependency the
# app itself does not list yet (adding it needs a lockfile change); until it
# does, the runtime gets the build's copy of it.
RUN if [ ! -e /out/atelier-tex/node_modules/@nestjs/throttler ]; then \
      cp -rL packages/nest-common/node_modules/@nestjs/throttler /out/atelier-tex/node_modules/@nestjs/; \
    fi && \
    cd /out/atelier-tex && node --input-type=module -e "await import('@outegro/nest-common')"

FROM node:24-bookworm-slim AS tex-system
RUN apt-get update -qq && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      texlive-xetex texlive-latex-extra texlive-fonts-recommended \
      texlive-lang-cyrillic poppler-utils fontconfig && \
    rm -rf /var/lib/apt/lists/*

FROM tex-system AS atelier-tex
ENV NODE_ENV=production \
    PORT=4010 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    TEXMFVAR=/tmp/texmf-var
WORKDIR /app
COPY --from=build --chown=node:node /out/atelier-tex ./
# Fail the build, not the first render, when the toolchain is incomplete.
RUN xelatex -version >/dev/null && command -v pdftotext pdfinfo pdffonts >/dev/null
# Numeric, so Kubernetes can verify runAsNonRoot.
USER 1000:1000
EXPOSE 4010
CMD ["node", "dist/main.js"]
