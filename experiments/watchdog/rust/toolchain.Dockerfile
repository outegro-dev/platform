# Development toolchain for the Makefile's docker-* targets: the official Rust
# image plus rustfmt, clippy and coverage tooling, so nothing is installed on
# the host. Not used by the production image (see Dockerfile).
#
#   docker build -f toolchain.Dockerfile -t outegro/watchdog-rs-toolchain:1.99.0 .
ARG RUST_IMAGE=rust:1.99.0-slim-bookworm
FROM ${RUST_IMAGE}

ARG CARGO_LLVM_COV_VERSION=0.9.1
RUN rustup component add rustfmt clippy llvm-tools-preview \
 && cargo install cargo-llvm-cov --locked --version "${CARGO_LLVM_COV_VERSION}" \
 && rm -rf /usr/local/cargo/registry /usr/local/cargo/git
