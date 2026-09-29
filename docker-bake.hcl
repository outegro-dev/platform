# Every app image from one build graph: the shared build stage runs once.
#   TAG=<commit> docker buildx bake --push
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
    "battleship-web",
    "auth-backend",
    "notifications-backend",
    "payments-backend",
    "battleship-backend",
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
