# Every app image from one build graph: the shared build stage runs once.
#   TAG=<commit> docker buildx bake --push
variable "TAG" {
  default = "dev"
}

variable "REGISTRY" {
  default = "ghcr.io/outegro-dev"
}

group "default" {
  targets = ["landing-web", "id-web", "auth-backend", "notifications-backend"]
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/outegro-dev/platform"
  }
}

target "landing-web" {
  inherits = ["_common"]
  target   = "landing-web"
  tags     = ["${REGISTRY}/landing-web:${TAG}"]
}

target "id-web" {
  inherits = ["_common"]
  target   = "id-web"
  tags     = ["${REGISTRY}/id-web:${TAG}"]
}

target "auth-backend" {
  inherits = ["_common"]
  target   = "auth-backend"
  tags     = ["${REGISTRY}/auth-backend:${TAG}"]
}

target "notifications-backend" {
  inherits = ["_common"]
  target   = "notifications-backend"
  tags     = ["${REGISTRY}/notifications-backend:${TAG}"]
}
