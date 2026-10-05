# Every app image from one build graph: the shared build stage runs once.
#   TAG=<commit> docker buildx bake --push
# CI passes only the affected targets and the same list as
# *.args.BUILD_APPS, so the build stage compiles just those apps.
variable "TAG" {
  default = "dev"
}

variable "REGISTRY" {
  default = "ghcr.io/outegro-dev"
}

variable "APPS" {
  default = [
    "landing-web",
    "id-web",
    "pay-web",
    "admin-web",
    "battleship-web",
    "edu-web",
    "auth-backend",
    "notifications-backend",
    "payments-backend",
    "battleship-backend",
    "edu-backend",
  ]
}

group "default" {
  targets = APPS
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/outegro-dev/platform"
  }
}

# One target per app, named like its Dockerfile stage and image.
target "app" {
  name     = app
  matrix   = { app = APPS }
  inherits = ["_common"]
  target   = app
  tags     = ["${REGISTRY}/${app}:${TAG}"]
}
