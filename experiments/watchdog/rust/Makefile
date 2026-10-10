# Native targets need a Rust toolchain. Every target also has a docker-*
# twin (docker-test, docker-lint, docker-check, ...) that runs the same
# command in the toolchain image, so the host needs only Docker. Caches live
# in named Docker volumes; no target/ directory appears here.

IMAGE     ?= outegro/watchdog-rs:dev
TOOLCHAIN ?= outegro/watchdog-rs-toolchain:1.99.0
CARGO     ?= cargo

DOCKER_RUN = docker run --rm \
	-v "$(CURDIR):/src" -w /src \
	-v outegro-cargo-registry:/usr/local/cargo/registry \
	-v outegro-cargo-git:/usr/local/cargo/git \
	-v outegro-rust-target:/target -e CARGO_TARGET_DIR=/target \
	$(TOOLCHAIN)

.PHONY: all check fmt fmt-check lint test cover build docker toolchain

all: check

## check: everything CI runs (format, lints, tests)
check: fmt-check lint test

fmt:
	$(CARGO) fmt

fmt-check:
	$(CARGO) fmt --check

lint:
	$(CARGO) clippy --all-targets -- -D warnings

test:
	$(CARGO) test

## cover: line/region coverage per file (needs cargo-llvm-cov)
cover:
	$(CARGO) llvm-cov --summary-only

build:
	$(CARGO) build --release --locked

## docker: the production image (distroless, nonroot)
docker:
	docker build -t $(IMAGE) .

## toolchain: the image used by the docker-* targets
toolchain:
	docker build -f toolchain.Dockerfile -t $(TOOLCHAIN) .

docker-%:
	$(MAKE) $* CARGO="$(DOCKER_RUN) cargo"
