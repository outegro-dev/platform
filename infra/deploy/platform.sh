#!/usr/bin/env bash
# Platform layer: certificate issuer, origin certificate, PostgreSQL, Valkey,
# RabbitMQ. Changes rarely; safe to re-run. From the repo root:
#   infra/deploy/platform.sh [ssh-host]
set -euo pipefail
HOST=${1:-outegro-prod}
cd "$(dirname "$0")/../.."
kubectl() { ssh -o BatchMode=yes "$HOST" sudo k3s kubectl "$@"; }

kubectl apply -f - < infra/k8s/platform/cluster-issuer.yaml
kubectl apply -f - < infra/k8s/outegro/certificate.yaml
kubectl apply -f - < infra/k8s/outegro/valkey.yaml
kubectl apply -f - < infra/k8s/outegro/rabbitmq.yaml
# The R2 endpoint carries the account id: it stays in the Secret, not in git.
endpoint=$(kubectl -n outegro get secret r2-backups -o 'jsonpath={.data.ENDPOINT}' | base64 -d)
sed "s|\${R2_ENDPOINT}|$endpoint|" infra/k8s/outegro/postgres.yaml | kubectl apply -f -
