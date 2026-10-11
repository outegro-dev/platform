# syntax=docker/dockerfile:1
#
# Multi-stage build with cargo-chef: dependencies compile in their own layer,
# which is reused until Cargo.toml or Cargo.lock change. The final image is
# distroless (no shell, no package manager) and runs as nonroot.
#
#   docker build -t outegro/watchdog-rs:dev .

ARG RUST_IMAGE=rust:1.99.0-slim-bookworm
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:nonroot

FROM ${RUST_IMAGE} AS chef
ARG CARGO_CHEF_VERSION=0.1.78
RUN cargo install cargo-chef --locked --version "${CARGO_CHEF_VERSION}"
WORKDIR /app

# A "recipe" of the dependency graph, without the application code.
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --bin watchdog

# glibc from bookworm matches cc-debian12; the binary also needs libgcc_s,
# which "cc" provides and "static" does not.
FROM ${RUNTIME_IMAGE}
LABEL org.opencontainers.image.title="outegro-watchdog" \
      org.opencontainers.image.description="outegro.dev watchdog (Rust): cluster checks with Telegram alerts" \
      org.opencontainers.image.source="https://github.com/outegro-dev/watchdog-lab"
COPY --from=builder /app/target/release/watchdog /usr/local/bin/watchdog
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/watchdog"]
