# Every target runs in the official Docker images by default, so the host
# needs only Docker. With a local Go toolchain use `make test DOCKER=0`.
# Caches live in named Docker volumes, never in the repository.

GO_IMAGE      ?= golang:1.27.2-alpine3.24
# -race needs cgo; the Debian image ships gcc, the Alpine one does not.
GO_RACE_IMAGE ?= golang:1.27.2-trixie
LINT_IMAGE    ?= golangci/golangci-lint:v2.14.0
IMAGE         ?= outegro/watchdog-go:dev
VERSION       ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS       := -s -w -X main.version=$(VERSION)

DOCKER ?= 1
ifeq ($(DOCKER),1)
VOLUMES   := -v "$(CURDIR):/src" -w /src -v outegro-go-mod:/go/pkg/mod -v outegro-go-build:/root/.cache/go-build
GO_RUN    := docker run --rm $(VOLUMES) $(GO_IMAGE)
RACE_RUN  := docker run --rm $(VOLUMES) $(GO_RACE_IMAGE)
LINT_RUN  := docker run --rm $(VOLUMES) -v outegro-golangci-cache:/root/.cache/golangci-lint $(LINT_IMAGE)
else
GO_RUN    :=
RACE_RUN  :=
LINT_RUN  :=
endif

.DEFAULT_GOAL := help
.PHONY: help test vet cover lint fmt tidy build docker check clean

help: ## list targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'

test: ## go vet, then all tests with the race detector and coverage
	$(RACE_RUN) sh -c 'go vet ./... && go test -race -cover ./...'

vet: ## go vet only
	$(GO_RUN) go vet ./...

cover: ## coverage profile of the internal packages (coverage.out, gitignored)
	$(GO_RUN) sh -c 'go test -coverpkg=./internal/... -coverprofile=coverage.out ./... && go tool cover -func=coverage.out | tail -1'

lint: ## golangci-lint with .golangci.yml
	$(LINT_RUN) golangci-lint run ./...

fmt: ## apply gofmt and goimports
	$(LINT_RUN) golangci-lint fmt ./...

tidy: ## go mod tidy
	$(GO_RUN) go mod tidy

build: ## static linux binary in bin/ (gitignored)
	$(GO_RUN) sh -c 'CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags "$(LDFLAGS)" -o bin/watchdog ./cmd/watchdog'

docker: ## container image $(IMAGE)
	docker build -t $(IMAGE) --build-arg VERSION=$(VERSION) .

check: lint test docker ## everything CI would run

clean: ## remove build outputs
	rm -rf bin coverage.out
