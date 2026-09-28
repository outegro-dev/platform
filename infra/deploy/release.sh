#!/usr/bin/env bash
# Release until CI and Argo CD take over: build the images here (never on the
# server), load them into the node's containerd, migrate, then roll out.
# From the repo root, on a clean commit:
#   infra/deploy/release.sh [ssh-host]
set -euo pipefail
HOST=${1:-outegro-prod}
cd "$(dirname "$0")/../.."
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit first: the image tag must name the exact code." >&2
  exit 1
fi
TAG=$(git rev-parse --short=12 HEAD)
APPS=(landing-web id-web auth-backend notifications-backend)
kubectl() { ssh -o BatchMode=yes "$HOST" sudo k3s kubectl "$@"; }
render() { sed "s/\${TAG}/$TAG/g" "$1"; }

images=()
for app in "${APPS[@]}"; do
  docker build --target "$app" -t "outegro/$app:$TAG" .
  images+=("outegro/$app:$TAG")
done
echo "loading ${images[*]} into $HOST"
docker save "${images[@]}" | gzip -1 | ssh -o BatchMode=yes "$HOST" 'gunzip | sudo k3s ctr -n k8s.io images import -'

render infra/k8s/outegro/migrate.yaml | kubectl apply -f -
kubectl -n outegro wait --for=condition=complete --timeout=300s \
  "job/auth-migrate-$TAG" "job/notifications-migrate-$TAG"

render infra/k8s/outegro/apps.yaml | kubectl apply -f -
for app in "${APPS[@]}"; do
  kubectl -n outegro rollout status "deploy/$app" --timeout=300s
done
echo "released $TAG"
