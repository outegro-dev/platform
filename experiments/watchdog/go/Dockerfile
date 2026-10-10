# syntax=docker/dockerfile:1.7
#
# Build:  docker build -t outegro/watchdog-go:dev --build-arg VERSION=$(git describe --always) go
#
# Base images are pinned by tag and digest, so a rebuild gives the same
# result until the pin is bumped on purpose.

ARG GO_IMAGE=golang:1.27.2-alpine3.24@sha256:85dc1069ac644ea3c527b177303a406eb3358192816cd7f9e5848eb658851673
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS build
WORKDIR /src

# Dependencies first: this layer is reused until go.mod or go.sum change.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download -x

COPY cmd ./cmd
COPY internal ./internal

ARG VERSION=dev
ARG TARGETOS=linux
ARG TARGETARCH=amd64
# CGO_ENABLED=0: a static binary that needs no libc, so it runs on
# distroless/static. -trimpath drops local paths; -s -w drop debug symbols.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/watchdog ./cmd/watchdog

FROM ${RUNTIME_IMAGE}
ARG VERSION=dev
LABEL org.opencontainers.image.title="outegro watchdog (Go)" \
      org.opencontainers.image.source="https://github.com/outegro-dev/platform" \
      org.opencontainers.image.version="${VERSION}"
COPY --from=build /out/watchdog /watchdog
# distroless :nonroot already runs as uid 65532; stated for clarity and for
# runAsNonRoot checks that need a numeric user.
USER 65532:65532
ENTRYPOINT ["/watchdog"]
